// Guards the decision to SKIP a calendar write.
//
// The asymmetry that matters: a false negative costs one unnecessary API call,
// a false positive means an edit Jon made in Notion silently never reaches his
// calendar. Every case below is written from that standpoint — when in doubt,
// the expected answer is "write".

const { assert, assertEqual } = require("./helpers");
const {
  eventMatchesExisting,
  fieldMatches,
  getChangeDetectionMode,
} = require("../src/workflows/notion-databases-to-calendar");

// Shaped exactly as the Events/Trips transformers emit.
function transformed(overrides = {}) {
  return {
    summary: "🎸 Radiohead at MSG",
    description: "Doors 7pm\nCategory: Music\nType: 🎸 Concerts",
    start: { date: "2026-09-14" },
    end: { date: "2026-09-15" },
    colorId: "5",
    ...overrides,
  };
}

// Shaped as Google returns it, server fields included.
function fromGoogle(overrides = {}) {
  return {
    id: "abc123",
    etag: '"3475"',
    status: "confirmed",
    htmlLink: "https://www.google.com/calendar/event?eid=x",
    created: "2026-08-01T12:00:00.000Z",
    updated: "2026-08-12T13:09:14.000Z",
    iCalUID: "abc123@google.com",
    sequence: 4,
    organizer: { email: "x@example.com", self: true },
    reminders: { useDefault: true },
    summary: "🎸 Radiohead at MSG",
    description: "Doors 7pm\nCategory: Music\nType: 🎸 Concerts",
    start: { date: "2026-09-14" },
    end: { date: "2026-09-15" },
    colorId: "5",
    ...overrides,
  };
}

const skips = (existing, event, msg) =>
  assert(eventMatchesExisting(existing, event) === true, msg || "should have matched (skip)");
const writes = (existing, event, msg) =>
  assert(eventMatchesExisting(existing, event) === false, msg || "should NOT have matched (write)");

module.exports = {
  "identical event matches, Google server fields ignored"() {
    skips(fromGoogle(), transformed());
  },

  // --- real edits must always reach the calendar ---
  "edited summary writes"() {
    writes(fromGoogle({ summary: "Radiohead" }), transformed());
  },
  "edited description writes"() {
    writes(fromGoogle({ description: "Doors 8pm" }), transformed());
  },
  "moved start date writes"() {
    writes(fromGoogle({ start: { date: "2026-09-15" } }), transformed());
  },
  "moved end date writes"() {
    writes(fromGoogle({ end: { date: "2026-09-16" } }), transformed());
  },
  "changed colorId writes"() {
    writes(fromGoogle({ colorId: "9" }), transformed());
  },
  "colorId removed on the calendar writes"() {
    writes(fromGoogle({ colorId: undefined }), transformed());
  },
  // Deriving compared fields purely from the transformer's output goes blind
  // exactly when a transformer STOPS setting a field — the key disappears and
  // the stale value survives on the calendar. Hence MANAGED_EVENT_FIELDS.
  "colorId newly unmapped in Notion writes"() {
    const noColor = transformed();
    delete noColor.colorId;
    writes(fromGoogle(), noColor);
  },
  "a description that emptied out still clears on the calendar"() {
    const noDesc = transformed();
    delete noDesc.description;
    writes(fromGoogle({ description: "stale text" }), noDesc);
  },
  "a location removed from the transform still clears"() {
    writes(fromGoogle({ location: "Old Venue" }), transformed());
  },
  "managed fields absent from both sides still match"() {
    // location/transparency/visibility set by neither — must not block the skip.
    skips(fromGoogle(), transformed());
  },

  // --- THE regression guard for the hardcoded-field-list bug ---
  // The comparison derives its fields from the transformer's output. If someone
  // adds a field to a transformer, it must be compared automatically. A hardcoded
  // list would silently ignore it and that edit would never propagate.
  "a transformer field the comparison never heard of is still compared"() {
    const withLocation = transformed({ location: "Madison Square Garden" });
    writes(
      fromGoogle({ location: "Barclays Center" }),
      withLocation,
      "a differing unknown field must force a write"
    );
    skips(
      fromGoogle({ location: "Madison Square Garden" }),
      withLocation,
      "a matching unknown field should still allow the skip"
    );
  },
  "a transformer field absent from the calendar writes"() {
    writes(fromGoogle(), transformed({ location: "Madison Square Garden" }));
  },
  "array-valued fields are never treated as matching"() {
    const recurring = transformed({ recurrence: ["RRULE:FREQ=WEEKLY"] });
    writes(
      fromGoogle({ recurrence: ["RRULE:FREQ=WEEKLY"] }),
      recurring,
      "arrays are not compared, so the record must take the write path"
    );
  },
  "nested objects recurse over transformer keys only"() {
    const nested = transformed({ extendedProperties: { private: { src: "notion" } } });
    skips(fromGoogle({ extendedProperties: { private: { src: "notion", extra: "ignored" } } }), nested);
    writes(fromGoogle({ extendedProperties: { private: { src: "other" } } }), nested);
  },

  // --- benign representation differences should still skip, or savings vanish ---
  'empty "" description vs omitted on Google matches'() {
    const g = fromGoogle();
    delete g.description;
    skips(g, transformed({ description: "" }));
  },
  "CRLF vs LF description matches"() {
    skips(
      fromGoogle({ description: "Doors 7pm\r\nCategory: Music\r\nType: 🎸 Concerts" }),
      transformed()
    );
  },
  "colorId absent on both sides matches"() {
    const g = fromGoogle();
    delete g.colorId;
    const t = transformed();
    delete t.colorId;
    skips(g, t);
  },

  // --- unexpected shapes must never skip ---
  "missing calendar event writes"() {
    writes(null, transformed());
    writes(undefined, transformed());
  },
  "cancelled event writes"() {
    writes(fromGoogle({ status: "cancelled" }), transformed());
  },
  "timed event on the calendar writes"() {
    writes(fromGoogle({ start: { dateTime: "2026-09-14T19:00:00-04:00" } }), transformed());
  },
  "timed event from the transformer writes"() {
    writes(fromGoogle(), transformed({ start: { dateTime: "2026-09-14T19:00:00-04:00" } }));
  },
  "dateless calendar event writes"() {
    writes(fromGoogle({ start: {}, end: {} }), transformed());
  },
  "empty calendar event writes"() {
    writes({}, transformed());
  },

  // --- fieldMatches directly ---
  "fieldMatches treats null, undefined and empty string alike"() {
    assert(fieldMatches(undefined, ""), "undefined vs empty");
    assert(fieldMatches(null, ""), "null vs empty");
    assert(fieldMatches("", undefined), "empty vs undefined");
  },
  "fieldMatches compares numbers and booleans by value"() {
    assert(fieldMatches(5, 5), "5 vs 5");
    assert(fieldMatches("5", 5), "string 5 vs number 5 normalize alike");
    assert(!fieldMatches(5, 6), "5 vs 6");
    assert(fieldMatches(true, true), "true vs true");
  },
  "fieldMatches refuses Date objects"() {
    const d = new Date("2026-09-14T00:00:00Z");
    assert(!fieldMatches(d, d), "Dates are not a compared shape");
  },
  "fieldMatches requires an object on both sides"() {
    assert(!fieldMatches("2026-09-14", { date: "2026-09-14" }), "scalar vs object");
  },

  // --- mode resolution ---
  "mode defaults to on"() {
    const prior = process.env.SYNC_CHANGE_DETECTION;
    delete process.env.SYNC_CHANGE_DETECTION;
    try {
      assertEqual(getChangeDetectionMode(), "on");
    } finally {
      if (prior !== undefined) process.env.SYNC_CHANGE_DETECTION = prior;
    }
  },
  "mode honors explicit values"() {
    const prior = process.env.SYNC_CHANGE_DETECTION;
    try {
      for (const value of ["on", "shadow", "off"]) {
        process.env.SYNC_CHANGE_DETECTION = value;
        assertEqual(getChangeDetectionMode(), value);
      }
      process.env.SYNC_CHANGE_DETECTION = "OFF";
      assertEqual(getChangeDetectionMode(), "off", "case insensitive");
    } finally {
      if (prior === undefined) delete process.env.SYNC_CHANGE_DETECTION;
      else process.env.SYNC_CHANGE_DETECTION = prior;
    }
  },
  "an unrecognized mode falls back to on, not off"() {
    const prior = process.env.SYNC_CHANGE_DETECTION;
    process.env.SYNC_CHANGE_DETECTION = "enabled";
    try {
      assertEqual(getChangeDetectionMode(), "on");
    } finally {
      if (prior === undefined) delete process.env.SYNC_CHANGE_DETECTION;
      else process.env.SYNC_CHANGE_DETECTION = prior;
    }
  },
};
