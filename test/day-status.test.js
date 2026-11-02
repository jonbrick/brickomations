// Guards the Status-formula contract between the 💊 2026 Medication / 🍬 2026
// Supplements DBs and their calendar transformers (Sun 2026-11-01). The
// formula's strings are matched on words so the emoji can be restyled in
// Notion; anything the classifier has never seen must skip loudly, by name.
//
// Requires the repo's .env (src/config validates env on load), same as the
// transformers themselves.

const { assert, assertEqual } = require("./helpers");
const { classifyDayStatus, normalizeStatus } = require("../src/utils/day-status");
const {
  transformMedicationToCalendarEvent,
} = require("../src/transformers/notion-medications-to-calendar");
const {
  transformSupplementToCalendarEvent,
} = require("../src/transformers/notion-supplements-to-calendar");

const repo = {
  extractProperty: (rec, name) => (rec.props[name] === undefined ? null : rec.props[name]),
};
const rec = (props) => ({ props });

// The exact strings both DBs' Status formulas emit (read via the Notion API;
// the two formulas were made identical Sun 2026-11-01). The decoration test
// below guards the un-styled spellings too, so a restyle can't break the sync.
const STATUS = {
  conflict: "⚠️ Conflict",
  skipped: "⏭️ Skipped",
  taken: "✅ Taken",
  morningOnly: "Morning only",
  eveningOnly: "Evening only",
  amPending: "Morning ✅ · evening pending",
  amSkipPending: "Morning ❌ · evening pending",
  pmPending: "Evening ✅ · morning pending",
  pmSkipPending: "Evening ❌ · morning pending",
  notLogged: "❌ Not logged",
};

const meds = (status, extra = {}) =>
  transformMedicationToCalendarEvent(
    rec({
      Date: "2026-11-01",
      Status: status,
      "AM Medication List": "Sertraline, Enalapril maleate",
      "PM Medication List": "Gabapentin, Hydroxyzine",
      ...extra,
    }),
    repo
  );

const supps = (status, extra = {}) =>
  transformSupplementToCalendarEvent(
    rec({ Date: "2026-11-01", Status: status, "AM Skipped": [], "PM Skipped": [], ...extra }),
    repo
  );

module.exports = {
  "normalize strips emoji and punctuation, keeps words"() {
    assertEqual(normalizeStatus("✅ Taken"), "taken");
    assertEqual(normalizeStatus("⏭️ Skipped"), "skipped");
    assertEqual(normalizeStatus("Morning ✅ · evening pending"), "morning evening pending");
    assertEqual(normalizeStatus(null), "");
  },
  "every Status string the formulas emit classifies"() {
    const want = {
      conflict: "conflict",
      skipped: "skipped",
      taken: "taken",
      morningOnly: "morning-only",
      eveningOnly: "evening-only",
      amPending: "pending",
      amSkipPending: "pending",
      pmPending: "pending",
      pmSkipPending: "pending",
      notLogged: "not-logged",
    };
    for (const [key, raw] of Object.entries(STATUS)) {
      assertEqual(classifyDayStatus(raw).kind, want[key], raw);
    }
  },
  "decoration is ignored: Taken and ✅ Taken are the same day"() {
    assertEqual(classifyDayStatus("Taken").kind, "taken");
    assertEqual(classifyDayStatus("✅ Taken").kind, "taken");
    assertEqual(classifyDayStatus("🎉  taken ").kind, "taken");
    assertEqual(classifyDayStatus("Not logged").kind, "not-logged");
    assertEqual(classifyDayStatus("❌ Not logged").kind, "not-logged");
  },
  "am/pm flags follow the resolved day"() {
    const t = classifyDayStatus(STATUS.taken);
    assert(t.am && t.pm, "taken is both");
    const m = classifyDayStatus(STATUS.morningOnly);
    assert(m.am && !m.pm, "morning only is AM");
    const e = classifyDayStatus(STATUS.eveningOnly);
    assert(!e.am && e.pm, "evening only is PM");
    const p = classifyDayStatus(STATUS.amPending);
    assert(!p.am && !p.pm, "pending resolves nothing yet");
  },
  "a string the formula grew since is unknown, never guessed"() {
    assertEqual(classifyDayStatus("🌙 Nightcap").kind, "unknown");
    assertEqual(classifyDayStatus("Morning").kind, "unknown");
  },
  "no Status value at all is missing"() {
    assertEqual(classifyDayStatus(null).kind, "missing");
    assertEqual(classifyDayStatus("").kind, "missing");
    assertEqual(classifyDayStatus(undefined).kind, "missing");
  },

  // ---- medications transformer ------------------------------------------
  "meds: a taken day is an AM + PM event listing both batches"() {
    const out = meds(STATUS.taken);
    assertEqual(out.skipped, undefined);
    assertEqual(out.event.summary, "💊 Medications (AM + PM)");
    assertEqual(
      out.event.description,
      "AM: ✅ Sertraline, ✅ Enalapril maleate\nPM: ✅ Gabapentin, ✅ Hydroxyzine"
    );
    assertEqual(out.event.start.date, "2026-11-01");
  },
  "meds: morning only is an AM event with the evening marked skipped"() {
    const out = meds(STATUS.morningOnly);
    assertEqual(out.event.summary, "💊 Medications (AM)");
    assertEqual(out.event.description, "AM: ✅ Sertraline, ✅ Enalapril maleate\nPM: ❌ skipped");
  },
  "meds: evening only is a PM event with the morning marked skipped"() {
    const out = meds(STATUS.eveningOnly);
    assertEqual(out.event.summary, "💊 Medications (PM)");
    assertEqual(out.event.description, "AM: ❌ skipped\nPM: ✅ Gabapentin, ✅ Hydroxyzine");
  },
  "meds: a pending day gets no event yet, named by its status"() {
    for (const raw of [STATUS.amPending, STATUS.amSkipPending, STATUS.pmPending, STATUS.pmSkipPending]) {
      const out = meds(raw);
      assertEqual(out.skipped, true, raw);
      assertEqual(out.reason, `Status ${raw}`);
    }
  },
  "meds: skipped and not-logged days get no event"() {
    assertEqual(meds(STATUS.skipped).reason, `Status ${STATUS.skipped}`);
    assertEqual(meds(STATUS.notLogged).reason, `Status ${STATUS.notLogged}`);
  },
  "meds: a conflict skips and says so"() {
    const out = meds(STATUS.conflict);
    assertEqual(out.skipped, true);
    assert(out.reason.startsWith(`Status ${STATUS.conflict}`), out.reason);
  },
  "meds: an unknown status skips loudly, quoting the string"() {
    const out = meds("🌙 Nightcap");
    assertEqual(out.skipped, true);
    assert(out.reason.includes('"🌙 Nightcap"'), out.reason);
    assert(out.reason.includes("day-status.js"), out.reason);
  },
  "meds: a missing Status value throws — the formula is the contract"() {
    let threw = false;
    try {
      meds(null);
    } catch (e) {
      threw = /Status/.test(e.message);
    }
    assert(threw, "expected a Status error");
  },
  "meds: a missing date skips as missing its date"() {
    const out = transformMedicationToCalendarEvent(rec({ Status: STATUS.taken }), repo);
    assertEqual(out.reason, "Missing date");
  },
  "meds: the skip object is never mistaken for a calendar event"() {
    const out = meds(STATUS.notLogged);
    assertEqual(out.event, undefined);
    assertEqual(out.calendarId, undefined);
  },

  // ---- supplements transformer ------------------------------------------
  "supps: a taken day lists the routine, with item skips flipped and titled"() {
    const out = supps(STATUS.taken, { "AM Skipped": ["CoQ10"] });
    assertEqual(out.event.summary, "🍬 Supplements (AM + PM · skipped CoQ10)");
    const [am, pm] = out.event.description.split("\n");
    assert(am.startsWith("AM: ✅ B-Complex, ✅ Vitamin D3, ❌ CoQ10, ✅ Creatine"), am);
    assertEqual(pm, "PM: ✅ Creatine, ✅ Magnesium Glycinate, ✅ Kyolic AGE, ✅ Omega-3");
  },
  "supps: three or more item skips become a count"() {
    const out = supps(STATUS.taken, { "AM Skipped": ["CoQ10", "Creatine", "Omega-3"] });
    assertEqual(out.event.summary, "🍬 Supplements (AM + PM · 3 skipped)");
  },
  "supps: evening only is a PM event with the morning marked skipped"() {
    const out = supps(STATUS.eveningOnly, { "AM Skipped": ["CoQ10"] });
    assertEqual(out.event.summary, "🍬 Supplements (PM)", "AM item skips don't count on a skipped AM");
    assertEqual(
      out.event.description,
      "AM: ❌ skipped\nPM: ✅ Creatine, ✅ Magnesium Glycinate, ✅ Kyolic AGE, ✅ Omega-3"
    );
  },
  "supps: pending, skipped, not-logged, conflict and unknown all skip by name"() {
    assertEqual(supps(STATUS.amPending).reason, `Status ${STATUS.amPending}`);
    assertEqual(supps(STATUS.skipped).reason, `Status ${STATUS.skipped}`);
    assertEqual(supps(STATUS.notLogged).reason, `Status ${STATUS.notLogged}`);
    assert(supps(STATUS.conflict).reason.startsWith(`Status ${STATUS.conflict}`));
    assert(supps("Brunch").reason.includes('"Brunch"'));
  },
  "supps: a missing Status value throws"() {
    let threw = false;
    try {
      supps(null);
    } catch (e) {
      threw = /Status/.test(e.message);
    }
    assert(threw, "expected a Status error");
  },
};
