// Guards the decision to REWRITE an Oura record that Notion already holds.
//
// The asymmetry that matters, and it runs the opposite way from the calendar's
// change detection: a false negative here is the 2026-09-22 bug — Notion keeps
// Oura's provisional 4.1h version of a night forever and no later run can fix
// it. A false positive rewrites a record with data that didn't actually change,
// costing one API call. So when the numbers differ at all, the answer is
// "rewrite" — but only for a night Oura might still be revising.

const { assert, assertEqual } = require("./helpers");
const {
  describeSleepRevision,
  isWithinRevisionWindow,
  REVISION_WINDOW_DAYS,
} = require("../src/workflows/oura-to-notion-oura");
const {
  findStaleSleepEvent,
} = require("../src/workflows/helpers/oura-stale-calendar-event");

// The finalized session, shaped as collect-oura.js emits it.
function session(overrides = {}) {
  return {
    sleepId: "420e29ac-50e9-48b4-95ce-a980aff37d5b",
    bedtimeStart: "2026-09-22T23:28:27.000-04:00",
    bedtimeEnd: "2026-09-23T08:24:33.000-04:00",
    sleepDuration: 29220,
    type: "long_sleep",
    ...overrides,
  };
}

// What Notion held after the 07:00 run wrote Oura's provisional version.
function provisional(overrides = {}) {
  return {
    bedtime: "2026-09-22T23:28:27.000-04:00",
    wakeTime: "2026-09-23T04:04:51.000-04:00",
    sleepDuration: 4.1,
    ...overrides,
  };
}

// What Notion holds once the finalized version has landed.
function finalized(overrides = {}) {
  return {
    bedtime: "2026-09-22T23:28:27.000-04:00",
    wakeTime: "2026-09-23T08:24:33.000-04:00",
    sleepDuration: 8.1,
    ...overrides,
  };
}

const rewrites = (stored, fresh, msg) =>
  assert(
    describeSleepRevision(fresh || session(), stored) !== null,
    msg || "should have been detected as a revision"
  );
const leaves = (stored, fresh, msg) =>
  assertEqual(
    describeSleepRevision(fresh || session(), stored),
    null,
    msg || "should have been left alone"
  );

const wokeAt = (iso) => new Date(Date.parse(iso));

module.exports = {
  // --- THE regression guard: the night that started this ---
  "the 2026-09-22 provisional record is rewritten"() {
    const summary = describeSleepRevision(session(), provisional());
    assert(summary !== null, "a 4h→8h revision must be caught");
    assert(
      summary.includes("04:04:51 → 08:24:33"),
      `summary should name the wake-time move, got: ${summary}`
    );
    assert(
      summary.includes("4.1h → 8.1h"),
      `summary should name the duration move, got: ${summary}`
    );
  },
  "a record already holding the finalized session is left alone"() {
    leaves(finalized(), session(), "steady state must not rewrite every run");
  },

  // --- each field Oura can move on its own ---
  "a moved wake time alone rewrites"() {
    rewrites(finalized({ wakeTime: "2026-09-23T07:50:00.000-04:00" }));
  },
  "a re-anchored sleep onset alone rewrites"() {
    rewrites(finalized({ bedtime: "2026-09-22T23:55:00.000-04:00" }));
  },
  "a rescored duration alone rewrites"() {
    rewrites(finalized({ sleepDuration: 7.6 }));
  },

  // --- representation differences are not revisions ---
  // Oura's offsets and Notion's round-trip don't always agree character for
  // character. Treating that as a change would rewrite the same record on
  // every one of the nine daily runs.
  "the same instant in UTC form is not a revision"() {
    leaves(
      finalized({
        bedtime: "2026-09-23T03:28:27.000Z",
        wakeTime: "2026-09-23T12:24:33.000Z",
      })
    );
  },
  "duration is compared at the precision Notion stores"() {
    // 29220s is 8.1166…h; the transformer stores 8.1. Comparing raw hours
    // against the stored figure would differ forever.
    leaves(finalized(), session({ sleepDuration: 29220 }));
  },

  // --- missing or malformed stored values must never silently skip ---
  "an empty record rewrites"() {
    rewrites({ bedtime: "", wakeTime: "", sleepDuration: null });
  },
  "a record missing its wake time rewrites"() {
    rewrites(finalized({ wakeTime: null }));
  },
  "an unparseable stored timestamp falls back to text comparison"() {
    rewrites(finalized({ wakeTime: "not a timestamp" }));
  },

  // --- the window: recent nights are writable, settled history is frozen ---
  "the morning's session is inside the window"() {
    assert(
      isWithinRevisionWindow(session(), wokeAt("2026-09-23T11:00:00.000-04:00")),
      "the 09:00 and 11:00 runs must still be able to fix the 07:00 write"
    );
  },
  "a night from last week is frozen"() {
    assert(
      !isWithinRevisionWindow(session(), wokeAt("2026-09-30T09:00:00.000-04:00")),
      "a retro'd week must not be rewritten underneath Jon"
    );
  },
  "the window boundary is inclusive"() {
    const boundary = new Date(
      Date.parse("2026-09-23T08:24:33.000-04:00") +
        REVISION_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
    assert(isWithinRevisionWindow(session(), boundary), "exactly N days still writes");
    assert(
      !isWithinRevisionWindow(session(), new Date(boundary.getTime() + 1000)),
      "one second past N days does not"
    );
  },
  "a session dated in the future stays eligible"() {
    assert(
      isWithinRevisionWindow(session(), wokeAt("2026-09-23T06:00:00.000-04:00")),
      "clock skew must not freeze a record"
    );
  },
  "a session with no wake time is never rewritten"() {
    assert(
      !isWithinRevisionWindow(session({ bedtimeEnd: null })),
      "no wake time means no basis for judging the window"
    );
  },

  // --- the stale calendar event: exact match only ---
  "the old event is matched on both edges"() {
    const stale = {
      id: "evt-stale",
      start: { dateTime: "2026-09-22T23:28:27-04:00" },
      end: { dateTime: "2026-09-23T04:04:51-04:00" },
    };
    const found = findStaleSleepEvent([stale], provisional());
    assertEqual(found && found.id, "evt-stale");
  },
  "an event sharing only the start is left alone"() {
    const overlapping = {
      id: "evt-other",
      start: { dateTime: "2026-09-22T23:28:27-04:00" },
      end: { dateTime: "2026-09-23T02:00:00-04:00" },
    };
    assertEqual(findStaleSleepEvent([overlapping], provisional()), null);
  },
  "a nap inside the same night is left alone"() {
    const nap = {
      id: "evt-nap",
      start: { dateTime: "2026-09-23T01:00:00-04:00" },
      end: { dateTime: "2026-09-23T02:00:00-04:00" },
    };
    assertEqual(findStaleSleepEvent([nap], provisional()), null);
  },
  "an all-day event is never matched"() {
    const allDay = { id: "evt-allday", start: { date: "2026-09-22" }, end: { date: "2026-09-23" } };
    assertEqual(findStaleSleepEvent([allDay], provisional()), null);
  },
  "no events, or no old window, matches nothing"() {
    assertEqual(findStaleSleepEvent([], provisional()), null);
    assertEqual(findStaleSleepEvent(null, provisional()), null);
    assertEqual(
      findStaleSleepEvent([{ id: "x", start: { dateTime: "2026-09-22T23:28:27-04:00" }, end: { dateTime: "2026-09-23T04:04:51-04:00" } }], {
        bedtime: null,
        wakeTime: null,
      }),
      null
    );
  },
};
