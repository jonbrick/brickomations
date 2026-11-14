// World of Warcraft session logic — pure functions shared by the launchd
// tracker (scripts/wow-tracker.js) and the collector (collect-wow.js).
//
// Battle.net has no playtime or session API, so the Mac mini polls for the
// game process every 5 minutes and records sessions locally. This module owns
// the two pure steps: advancing the tracker state on each poll, and turning
// closed sessions into activities shaped like Steam's (same Notion DB).
//
// Deliberately free of src/config so the tracker runs without .env.

const WOW_GAME_NAME = "World of Warcraft";

// A gap longer than this between polls means the mini slept or the job
// stalled — close the open session at its last sighting instead of
// stretching it across the gap.
const DEFAULT_MAX_GAP_MS = 15 * 60 * 1000;

/**
 * Advance tracker state by one poll.
 *
 * state: { open: { start, lastSeen } | null } — ISO UTC strings
 * Returns { state, closed } where closed is a finished session
 * ({ start, end }) or null.
 *
 * - Running, no open session → open one at now.
 * - Running, open, normal gap → extend lastSeen.
 * - Running, open, gap too large → close at lastSeen, open a new one at now.
 * - Not running, open, normal gap → close at now (quit since the last poll).
 * - Not running, open, gap too large → close at lastSeen.
 */
function tickSession(state, running, nowISO, opts = {}) {
  const maxGapMs = opts.maxGapMs ?? DEFAULT_MAX_GAP_MS;
  const open = state?.open || null;
  const nowMs = Date.parse(nowISO);

  if (!open) {
    if (!running) return { state: { open: null }, closed: null };
    return { state: { open: { start: nowISO, lastSeen: nowISO } }, closed: null };
  }

  const gapMs = nowMs - Date.parse(open.lastSeen);
  const stale = gapMs > maxGapMs;

  if (running) {
    if (!stale) {
      return { state: { open: { start: open.start, lastSeen: nowISO } }, closed: null };
    }
    return {
      state: { open: { start: nowISO, lastSeen: nowISO } },
      closed: { start: open.start, end: open.lastSeen },
    };
  }

  return {
    state: { open: null },
    closed: { start: open.start, end: stale ? open.lastSeen : nowISO },
  };
}

/** Eastern wall-clock parts for a Date. */
function easternParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Eastern date (YYYY-MM-DD) for a Date. */
function easternDate(date) {
  const p = easternParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Eastern ISO with offset, e.g. "2026-11-14T21:30:00-05:00" (EST/EDT aware). */
function toEasternISO(date) {
  const p = easternParts(date);
  const wallMs = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMin = Math.round((wallMs - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${oh}:${om}`;
}

/** "9:30 PM" from an Eastern ISO string (parsed from the string, not getHours). */
function formatDisplay(easternISO) {
  const [hoursStr, minutesStr] = easternISO.split("T")[1].split(":");
  const hours = parseInt(hoursStr, 10);
  const ampm = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${minutesStr} ${ampm}`;
}

/** Truncate an ISO timestamp to the whole minute. */
function toMinute(iso) {
  const d = new Date(iso);
  d.setUTCSeconds(0, 0);
  return d;
}

/**
 * Turn closed sessions into Steam-shaped activities for Eastern dates in
 * [startDay, endDay] (YYYY-MM-DD strings, inclusive).
 *
 * A session belongs to the Eastern date it started on. Periods are numbered
 * per day in start order, so Activity IDs stay stable as the log grows
 * (append-only, chronological). Sub-minute sessions are dropped.
 */
function sessionsToActivities(sessions, startDay, endDay) {
  const rows = sessions
    .map((s) => {
      const start = toMinute(s.start);
      const end = toMinute(s.end);
      return { start, end, minutes: Math.round((end - start) / 60000) };
    })
    .filter((r) => r.minutes >= 1)
    .sort((a, b) => a.start - b.start);

  const perDay = {};
  const activities = [];

  for (const r of rows) {
    const date = easternDate(r.start);
    perDay[date] = (perDay[date] || 0) + 1;
    if (date < startDay || date > endDay) continue;

    const startTime = toEasternISO(r.start);
    const endTime = toEasternISO(r.end);
    activities.push({
      activityId: `${WOW_GAME_NAME.replace(/[^a-zA-Z0-9]/g, "-")}-${date}-P${perDay[date]}`,
      gameName: WOW_GAME_NAME,
      dateStr: date,
      minutesPlayed: r.minutes,
      startTime,
      endTime,
      startTimeDisplay: formatDisplay(startTime),
      endTimeDisplay: formatDisplay(endTime),
      startTimeUTC: r.start.toISOString(),
      endTimeUTC: r.end.toISOString(),
    });
  }

  return activities;
}

module.exports = {
  WOW_GAME_NAME,
  DEFAULT_MAX_GAP_MS,
  tickSession,
  easternDate,
  toEasternISO,
  formatDisplay,
  sessionsToActivities,
};
