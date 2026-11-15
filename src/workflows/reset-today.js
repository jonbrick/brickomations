/**
 * @layer 2 - Domain
 *
 * `/reset-today` — get back to neutral today without touching the plan.
 *
 * The window is a rolling 7 days: the past 7 days through yesterday, across
 * any week boundary. Two inputs: 2026 Tasks rows due in the window that aren't
 * Done, and `Planned:` placeholders on the main personal calendar in the
 * window — plus Events and Trips rows whose last day fell in the window but
 * are still open (Scheduled, To Book, …). Pure functions — the reset:view /
 * reset:apply CLIs do the I/O.
 *
 * Task writes land in data/life.json (Notion-native rows only, Due Date and
 * Status only); `yarn push --only=tasks` carries them to Notion. Linear-born
 * rows are never edited locally — the next pull:linear would overwrite them —
 * so their moves are reported for the skill to make in Linear. Event and
 * trip writes land in data/plan.json (Date / Status); `yarn push
 * --only=events,trips` carries them to Notion.
 */

const { classify, findActual, localDate } = require("../utils/planned-events");
const { CALENDAR_SKIP_STATUSES } = require("../config/notion/task-categories");

const DONE_STATUS = "🟢 Done";
const WONT_DO_STATUS = "🛑 Won't Do";
// Settled events/trips — anything else past its date is still open.
const SETTLED_STATUSES = new Set([DONE_STATUS, ...CALENDAR_SKIP_STATUSES]);
const WINDOW_DAYS = 7;

/** YYYY-MM-DD in New York for a Date (defaults to now). */
function todayString(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

function shiftDate(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The past 7 days through yesterday. */
function resetWindow(today) {
  return { start: shiftDate(today, -WINDOW_DAYS), end: shiftDate(today, -1) };
}

function inWindow(date, window) {
  return !!date && date >= window.start && date <= window.end;
}

function isLinearBorn(task) {
  return !!(task["Linear ID"] || task["Linear URL"]);
}

/** Open tasks due in the window, oldest first. */
function openTasks(tasks, window) {
  return (tasks || [])
    .filter((t) => inWindow(localDate(t["Due Date"]), window))
    .filter((t) => t.Status !== DONE_STATUS)
    .filter((t) => !String(t[t._titleKey || "Task"] || "").startsWith("[DELETE]"))
    .map((t) => ({
      kind: "task",
      notionId: t._notionId,
      title: t[t._titleKey || "Task"],
      due: localDate(t["Due Date"]),
      status: t.Status,
      source: isLinearBorn(t) ? t["Linear ID"] || "Linear" : "Notion",
      linearUrl: t["Linear URL"] || null,
    }))
    .sort((a, b) => a.due.localeCompare(b.due) || String(a.title).localeCompare(String(b.title)));
}

/**
 * Verdict for a placeholder: "done" when a matching actual exists that day,
 * "ask" for manual or unrecognized habits with no actual, "open" otherwise.
 */
function verdictFor(cls, actual) {
  if (actual) return "done";
  if (!cls.auto) return "ask";
  return "open";
}

/** `Planned:` events (Google Calendar API shape) in the window, with verdicts. */
function plannedBlocks(events, calendarData, window) {
  return (events || [])
    .map((e) => ({ e, start: (e.start && (e.start.dateTime || e.start.date)) || "" }))
    .filter(({ start }) => inWindow(localDate(start), window))
    .map(({ e, start }) => {
      const cls = classify(e.summary);
      const actual = findActual(calendarData, cls.habitType, localDate(start));
      return {
        kind: "block",
        id: e.id,
        summary: e.summary,
        start,
        end: (e.end && (e.end.dateTime || e.end.date)) || null,
        habitType: cls.habitType,
        targetKey: cls.targetKey,
        verdict: verdictFor(cls, actual),
        actual,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Events and trips whose last day fell in the window but aren't settled,
 * oldest first. A trip still under way (ends today or later) isn't stale yet.
 */
function openEntries(events, trips, window) {
  const pick = (records, kind) =>
    (records || [])
      .filter((r) => !SETTLED_STATUSES.has(r.Status))
      .map((r) => {
        const start = localDate(r.Date);
        const last = localDate(r["Date End"]) || start;
        return { r, start, last };
      })
      .filter(({ last }) => inWindow(last, window))
      .map(({ r, start, last }) => ({
        kind,
        notionId: r._notionId,
        title: r[r._titleKey || (kind === "trip" ? "Trip Name" : "Event Name")],
        date: start,
        dateEnd: last !== start ? last : null,
        status: r.Status,
      }));

  return [...pick(events, "event"), ...pick(trips, "trip")].sort(
    (a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(String(b.title))
  );
}

/** Tasks numbered 1..n; blocks and entries each numbered fresh from 1. */
function numberItems(tasks, blocks, entries = []) {
  return {
    tasks: tasks.map((t, i) => ({ n: i + 1, ...t })),
    blocks: blocks.map((b, i) => ({ n: i + 1, ...b })),
    entries: entries.map((e, i) => ({ n: i + 1, ...e })),
  };
}

/**
 * Re-date a Notion date value to a new day, keeping its time and offset; a
 * range's End moves by the same number of days.
 */
function redate(value, newDay) {
  return String(value).includes("T") ? `${newDay}${String(value).slice(10)}` : newDay;
}

function dayDelta(from, to) {
  return Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000);
}

/**
 * Apply answered task items to life.json task records, in place.
 * Item actions: "done" → Status Done; "date" → Due Date = item.date.
 * @returns {{changes: Array, skipped: Array}} one line of data per item
 */
function applyTaskAnswers(lifeTasks, items) {
  const byId = new Map((lifeTasks || []).map((t) => [t._notionId, t]));
  const changes = [];
  const skipped = [];

  for (const item of items || []) {
    if (!item.action || item.applied) continue;
    const rec = byId.get(item.notionId);
    if (!rec) {
      skipped.push({ n: item.n, title: item.title, reason: "not in data/life.json (pull first)" });
      continue;
    }
    if (isLinearBorn(rec)) {
      skipped.push({ n: item.n, title: item.title, reason: `Linear-born (${rec["Linear ID"] || "Linear"}) — move it in Linear` });
      continue;
    }
    if (item.action === "done") {
      changes.push({ n: item.n, title: item.title, field: "Status", from: rec.Status, to: DONE_STATUS });
      rec.Status = DONE_STATUS;
    } else if (item.action === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || "")) {
        skipped.push({ n: item.n, title: item.title, reason: `date must be YYYY-MM-DD (got ${JSON.stringify(item.date)})` });
        continue;
      }
      changes.push({ n: item.n, title: item.title, field: "Due Date", from: rec["Due Date"], to: item.date });
      rec["Due Date"] = item.date;
    } else {
      skipped.push({ n: item.n, title: item.title, reason: `unknown action "${item.action}"` });
    }
  }

  return { changes, skipped };
}

/**
 * Apply answered event/trip items to plan.json records, in place.
 * Item actions: "done" → Done; "wontdo" → Won't Do; "date" → Date moves to
 * item.date (time and range length kept).
 * @returns {{changes: Array, skipped: Array}}
 */
function applyEntryAnswers(planEvents, planTrips, items) {
  const byId = new Map([...(planEvents || []), ...(planTrips || [])].map((r) => [r._notionId, r]));
  const changes = [];
  const skipped = [];

  for (const item of items || []) {
    if (!item.action || item.applied) continue;
    const rec = byId.get(item.notionId);
    if (!rec) {
      skipped.push({ n: item.n, title: item.title, reason: "not in data/plan.json (pull first)" });
      continue;
    }
    if (item.action === "done" || item.action === "wontdo") {
      const to = item.action === "done" ? DONE_STATUS : WONT_DO_STATUS;
      changes.push({ n: item.n, title: item.title, field: "Status", from: rec.Status, to });
      rec.Status = to;
    } else if (item.action === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || "") || !rec.Date) {
        skipped.push({ n: item.n, title: item.title, reason: `date must be YYYY-MM-DD (got ${JSON.stringify(item.date)})` });
        continue;
      }
      const shift = dayDelta(localDate(rec.Date), item.date);
      const from = rec.Date;
      rec.Date = redate(rec.Date, item.date);
      if (rec["Date End"]) rec["Date End"] = redate(rec["Date End"], shiftDate(localDate(rec["Date End"]), shift));
      changes.push({ n: item.n, title: item.title, field: "Date", from, to: rec.Date });
    } else {
      skipped.push({ n: item.n, title: item.title, reason: `unknown action "${item.action}"` });
    }
  }

  return { changes, skipped };
}

module.exports = {
  DONE_STATUS,
  WONT_DO_STATUS,
  todayString,
  shiftDate,
  resetWindow,
  openTasks,
  plannedBlocks,
  openEntries,
  numberItems,
  applyTaskAnswers,
  applyEntryAnswers,
};
