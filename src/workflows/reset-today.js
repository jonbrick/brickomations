/**
 * @layer 2 - Domain
 *
 * `/reset-today` — get back to neutral today without touching the plan.
 *
 * The window is a rolling 7 days: the past 7 days through yesterday, across
 * any week boundary. Two inputs: 2026 Tasks rows due in the window that aren't
 * Done, and `Planned:` placeholders on the main personal calendar in the
 * window. Pure functions — the reset:view / reset:apply CLIs do the I/O.
 *
 * Task writes land in data/life.json (Notion-native rows only, Due Date and
 * Status only); `yarn push --only=tasks` carries them to Notion. Linear-born
 * rows are never edited locally — the next pull:linear would overwrite them —
 * so their moves are reported for the skill to make in Linear.
 */

const { classify, findActual, localDate } = require("../utils/planned-events");

const DONE_STATUS = "🟢 Done";
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

/** Tasks numbered 1..n; blocks numbered fresh 1..m. */
function numberItems(tasks, blocks) {
  return {
    tasks: tasks.map((t, i) => ({ n: i + 1, ...t })),
    blocks: blocks.map((b, i) => ({ n: i + 1, ...b })),
  };
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

module.exports = {
  DONE_STATUS,
  todayString,
  shiftDate,
  resetWindow,
  openTasks,
  plannedBlocks,
  numberItems,
  applyTaskAnswers,
};
