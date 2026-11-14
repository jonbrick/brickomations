// Guards the World of Warcraft session tracker. Battle.net has no playtime
// API, so scripts/wow-tracker.js polls for the game process every 5 minutes;
// these cases pin how a poll advances state (including sleep gaps) and how
// closed sessions become Steam-shaped rows in the shared video games DB.

const { assert, assertEqual } = require("./helpers");
const {
  tickSession,
  toEasternISO,
  sessionsToActivities,
} = require("../src/utils/wow-sessions");

const T = (hhmm, day = "2026-11-15") => `${day}T${hhmm}:00.000Z`;

module.exports = {
  "idle poll with no open session stays closed"() {
    const r = tickSession({ open: null }, false, T("01:00"));
    assertEqual(r.state.open, null, "open");
    assertEqual(r.closed, null, "closed");
  },

  "first sighting opens a session"() {
    const r = tickSession({ open: null }, true, T("01:00"));
    assertEqual(r.state.open.start, T("01:00"), "start");
    assertEqual(r.closed, null, "closed");
  },

  "consecutive sightings extend lastSeen"() {
    const r = tickSession({ open: { start: T("01:00"), lastSeen: T("01:05") } }, true, T("01:10"));
    assertEqual(r.state.open.start, T("01:00"), "start kept");
    assertEqual(r.state.open.lastSeen, T("01:10"), "lastSeen");
  },

  "quitting between polls closes at the next poll"() {
    const r = tickSession({ open: { start: T("01:00"), lastSeen: T("01:30") } }, false, T("01:35"));
    assertEqual(r.state.open, null, "open");
    assertEqual(r.closed.end, T("01:35"), "end");
  },

  "a sleep gap closes at last sighting and reopens"() {
    const r = tickSession({ open: { start: T("01:00"), lastSeen: T("01:30") } }, true, T("03:00"));
    assertEqual(r.closed.end, T("01:30"), "closed at lastSeen");
    assertEqual(r.state.open.start, T("03:00"), "new session");
  },

  "a sleep gap with the game gone closes at last sighting"() {
    const r = tickSession({ open: { start: T("01:00"), lastSeen: T("01:30") } }, false, T("03:00"));
    assertEqual(r.closed.end, T("01:30"), "end");
  },

  "Eastern ISO carries the EST offset in November"() {
    assertEqual(toEasternISO(new Date("2026-11-15T02:30:00Z")), "2026-11-14T21:30:00-05:00");
  },

  "Eastern ISO carries the EDT offset in July"() {
    assertEqual(toEasternISO(new Date("2026-07-15T01:30:00Z")), "2026-07-14T21:30:00-04:00");
  },

  "sessions become Steam-shaped rows numbered per Eastern day"() {
    const sessions = [
      { start: "2026-11-15T02:30:20Z", end: "2026-11-15T04:00:40Z" }, // 9:30–11 PM ET on 11-14
      { start: "2026-11-14T18:00:00Z", end: "2026-11-14T19:00:00Z" }, // 1–2 PM ET on 11-14
      { start: "2026-11-15T20:00:00Z", end: "2026-11-15T20:45:00Z" }, // 3–3:45 PM ET on 11-15
    ];
    const rows = sessionsToActivities(sessions, "2026-11-14", "2026-11-15");
    assertEqual(rows.length, 3, "count");
    assertEqual(rows[0].activityId, "World-of-Warcraft-2026-11-14-P1", "P1 is earliest");
    assertEqual(rows[1].activityId, "World-of-Warcraft-2026-11-14-P2", "evening is P2");
    assertEqual(rows[1].dateStr, "2026-11-14", "evening session dated by Eastern start");
    assertEqual(rows[1].minutesPlayed, 90, "minutes truncated to whole minutes");
    assertEqual(rows[1].startTimeDisplay, "9:30 PM", "display start");
    assertEqual(rows[1].endTimeDisplay, "11:00 PM", "display end");
    assertEqual(rows[1].startTimeUTC, "2026-11-15T02:30:00.000Z", "UTC start");
    assertEqual(rows[2].activityId, "World-of-Warcraft-2026-11-15-P1", "next day restarts at P1");
  },

  "period numbers stay stable when the range excludes earlier sessions"() {
    const sessions = [
      { start: "2026-11-14T18:00:00Z", end: "2026-11-14T19:00:00Z" },
      { start: "2026-11-15T02:30:00Z", end: "2026-11-15T04:00:00Z" },
    ];
    const rows = sessionsToActivities(sessions, "2026-11-14", "2026-11-14");
    assertEqual(rows[1].activityId, "World-of-Warcraft-2026-11-14-P2", "id unchanged");
    const none = sessionsToActivities(sessions, "2026-11-15", "2026-11-15");
    assertEqual(none.length, 0, "out of range dropped");
  },

  "sub-minute sessions are dropped"() {
    const rows = sessionsToActivities(
      [{ start: "2026-11-14T18:00:00Z", end: "2026-11-14T18:00:30Z" }],
      "2026-11-14",
      "2026-11-14"
    );
    assert(rows.length === 0, "dropped");
  },
};
