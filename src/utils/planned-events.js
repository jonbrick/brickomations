/**
 * @layer 2 - Domain
 *
 * Shared helpers for `/plan-week`'s `Planned:` placeholder events on the main
 * personal calendar: recognize them, classify the habit behind each one, and
 * find the actual that proves it happened.
 *
 * Used by scripts/reconcile-planned-events.js (retro cleanup, a calendar Week)
 * and the reset:view / reset:apply CLIs (a rolling 7-day window).
 */

const PLANNED_PREFIX = "Planned:";

// Manual-habit target calendars: callers carry a key, the id is resolved from
// .env at write time so calendar ids never leave it.
const TARGET_CALENDARS = {
  cooking: "COOKING_CALENDAR_ID",
  reading: "READING_CALENDAR_ID",
  music: "MUSIC_CALENDAR_ID",
  art: "ART_CALENDAR_ID",
  meditation: "MEDITATION_CALENDAR_ID",
};

// Where a habit's actual lands in data/calendar.json, by habit type.
const ACTUAL_KEYS = {
  workout: ["workout"],
  wakeup: ["normalWakeUp", "sleepIn"],
  videogames: ["videoGames"],
  coding: ["coding", "personalPRs"],
  cooking: ["cooking"],
  reading: ["reading"],
  music: ["music"],
  art: ["art"],
  meditation: ["meditation"],
};

function isPlanned(summary) {
  return typeof summary === "string" && summary.trim().startsWith(PLANNED_PREFIX);
}

/** Strip the leading "Planned:" (and any single following space). */
function stripPlanned(summary) {
  return String(summary || "").trim().replace(/^Planned:\s*/, "");
}

/**
 * Best-guess habit classification from the summary. `auto` habits are captured
 * elsewhere (Strava/Oura/Steam/GitHub) so their placeholder is always
 * deletable; manual habits get a target calendar.
 */
function classify(summary) {
  const body = stripPlanned(summary).toLowerCase();
  if (/^cook\b|^cook\s*—/.test(body)) return { habitType: "cooking", auto: false, targetKey: "cooking" };
  if (/^lunch\b/.test(body)) return { habitType: "meal-lunch", auto: false, targetKey: null };
  if (/^dinner\b/.test(body)) return { habitType: "meal-dinner", auto: false, targetKey: null };
  if (/early\s*wake/.test(body)) return { habitType: "wakeup", auto: true, targetKey: null };
  if (/personal training|randy|workout|lift|run\b|stairmaster|skierg|row\b|padel|gym|boxing/.test(body))
    return { habitType: "workout", auto: true, targetKey: null };
  if (/video\s*game|gaming|steam/.test(body)) return { habitType: "videogames", auto: true, targetKey: null };
  if (/cod(e|ing)|brickomations|github/.test(body)) return { habitType: "coding", auto: true, targetKey: null };
  if (/read/.test(body)) return { habitType: "reading", auto: false, targetKey: "reading" };
  if (/music|guitar/.test(body)) return { habitType: "music", auto: false, targetKey: "music" };
  if (/meditat/.test(body)) return { habitType: "meditation", auto: false, targetKey: "meditation" };
  if (/\bart\b|draw|paint|sketch/.test(body)) return { habitType: "art", auto: false, targetKey: "art" };
  return { habitType: "unknown", auto: false, targetKey: null };
}

/** Start of a Google Calendar API event (dateTime or all-day date). */
function eventStart(ev) {
  return ev.start && (ev.start.dateTime || ev.start.date);
}

/** Local calendar date (YYYY-MM-DD) of a start string — offsets are local. */
function localDate(start) {
  return String(start || "").slice(0, 10);
}

/**
 * First actual for a habit on a date, from data/calendar.json's per-calendar
 * arrays. Returns { key, summary, start } or null.
 */
function findActual(calendarData, habitType, date) {
  for (const key of ACTUAL_KEYS[habitType] || []) {
    const events = (calendarData && calendarData[key]) || [];
    const hit = events.find((e) => localDate(e.start) === date);
    if (hit) return { key, summary: hit.summary, start: hit.start };
  }
  return null;
}

module.exports = {
  PLANNED_PREFIX,
  TARGET_CALENDARS,
  ACTUAL_KEYS,
  isPlanned,
  stripPlanned,
  classify,
  eventStart,
  localDate,
  findActual,
};
