// Guards the named-skip contract between the Events/Trips transformers and the
// calendar workflow. A skip must carry its own reason — otherwise the sync log
// collapses every drop into the source's one generic skipReason and prints
// "Unknown - Missing date or trip name" for a Won't Do trip (Fri 2026-10-16).
//
// Requires the repo's .env (src/config validates env on load), same as the
// transformers themselves.

const { assert, assertEqual } = require("./helpers");
const {
  transformEventToCalendarEvent,
} = require("../src/transformers/notion-events-to-calendar-events");
const {
  transformTripToCalendarEvent,
} = require("../src/transformers/notion-trips-to-calendar-trips");

const DATED = { start: "2026-10-03", end: "2026-10-03" };
const repo = (range) => ({
  extractProperty: (rec, name) => (rec.props[name] === undefined ? null : rec.props[name]),
  extractDateRange: () => range,
});
const rec = (props) => ({ props });

module.exports = {
  "a Won't Do event is skipped with its status as the reason"() {
    const out = transformEventToCalendarEvent(
      rec({ "Event Name": "Mercury", Status: "🛑 Won't Do", Category: "🫥 N/A" }),
      repo(DATED)
    );
    assertEqual(out.skipped, true);
    assertEqual(out.reason, "Status 🛑 Won't Do");
  },
  "every calendar skip status names itself"() {
    for (const status of ["🧊 Ice Box", "↗️ Next Year", "🛑 Won't Do", "🫥 N/A"]) {
      const out = transformTripToCalendarEvent(
        rec({ "Trip Name": "x", Status: status, Category: "🌱 Personal" }),
        repo(DATED)
      );
      assertEqual(out.reason, `Status ${status}`, status);
    }
    assert(true);
  },
  "an undated trip is skipped as missing its date"() {
    const out = transformTripToCalendarEvent(
      rec({ "Trip Name": "2026 Italy", Status: "🟣 Considering", Category: "🌱 Personal" }),
      repo(null)
    );
    assertEqual(out.skipped, true);
    assertEqual(out.reason, "Missing date");
  },
  "a dated event with no name is skipped as missing its name"() {
    const out = transformEventToCalendarEvent(
      rec({ "Event Name": "", Status: "🟢 Done", Category: "🌱 Personal" }),
      repo(DATED)
    );
    assertEqual(out.skipped, true);
    assertEqual(out.reason, "Missing event name");
  },
  "the skip object is never mistaken for a calendar event"() {
    const out = transformTripToCalendarEvent(
      rec({ "Trip Name": "x", Status: "🛑 Won't Do" }),
      repo(DATED)
    );
    assertEqual(out.event, undefined);
    assertEqual(out.calendarId, undefined);
  },
};
