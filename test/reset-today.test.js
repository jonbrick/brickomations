// Guards /reset-today's window, task selection, block verdicts, and the
// life.json edits reset:apply makes before `yarn push --only=tasks`.

const { assert, assertEqual } = require("./helpers");
const {
  DONE_STATUS,
  todayString,
  resetWindow,
  openTasks,
  plannedBlocks,
  numberItems,
  applyTaskAnswers,
} = require("../src/workflows/reset-today");
const { findActual } = require("../src/utils/planned-events");
const { applyPlannedAction } = require("../src/workflows/planned-event-actions");

const WINDOW = { start: "2026-11-08", end: "2026-11-14" };

function task(fields) {
  return { _titleKey: "Task", Status: "🔴 To Do", "Linear ID": "", "Linear URL": null, ...fields };
}

function event(id, summary, start) {
  return { id, summary, start: { dateTime: start }, end: { dateTime: start } };
}

module.exports = {
  "window is the past 7 days through yesterday, across week boundaries": () => {
    const w = resetWindow("2026-11-15");
    assertEqual(w.start, "2026-11-08");
    assertEqual(w.end, "2026-11-14");
    const wed = resetWindow("2026-11-18");
    assertEqual(wed.start, "2026-11-11");
    assertEqual(wed.end, "2026-11-17");
  },

  "today is New York's date, not UTC's": () => {
    // 02:00 UTC Mon = 21:00 Sun in New York
    assertEqual(todayString(new Date("2026-11-16T02:00:00Z")), "2026-11-15");
  },

  "open tasks: in window, not Done, not [DELETE], oldest first": () => {
    const tasks = [
      task({ _notionId: "a", Task: "Laundry", "Due Date": "2026-11-14", Status: "🔵 Doing" }),
      task({ _notionId: "b", Task: "Retro", "Due Date": "2026-11-14", Status: DONE_STATUS }),
      task({ _notionId: "c", Task: "Today's thing", "Due Date": "2026-11-15" }),
      task({ _notionId: "d", Task: "Old", "Due Date": "2026-11-07" }),
      task({ _notionId: "e", Task: "[DELETE] Dupe", "Due Date": "2026-11-10" }),
      task({ _notionId: "f", Task: "Icons", "Due Date": "2026-11-09", "Linear ID": "PD-650", "Linear URL": "https://x" }),
    ];
    const open = openTasks(tasks, WINDOW);
    assertEqual(open.map((t) => t.notionId).join(","), "f,a");
    assertEqual(open[0].source, "PD-650");
    assertEqual(open[1].source, "Notion");
  },

  "block verdicts: actual → done, manual → ask, auto without actual → not done": () => {
    const calendarData = {
      workout: [{ summary: "💪 Afternoon Workout", start: "2026-11-14T16:39:00-05:00" }],
      cooking: [],
    };
    const events = [
      event("1", "Planned: Workout", "2026-11-14T11:30:00-05:00"),
      event("2", "Planned: Workout", "2026-11-13T07:00:00-05:00"),
      event("3", "Planned: Cook — chili", "2026-11-12T18:00:00-05:00"),
      event("4", "Planned: Workout", "2026-11-15T07:00:00-05:00"),
    ];
    const blocks = plannedBlocks(events, calendarData, WINDOW);
    assertEqual(blocks.map((b) => `${b.id}:${b.verdict}`).join(","), "3:ask,2:open,1:done");
    assertEqual(blocks[2].actual.summary, "💪 Afternoon Workout");
  },

  "findActual matches on the local date only": () => {
    const data = { workout: [{ summary: "Run", start: "2026-11-14T23:30:00-05:00" }] };
    assert(findActual(data, "workout", "2026-11-14"));
    assertEqual(findActual(data, "workout", "2026-11-15"), null);
    assertEqual(findActual(data, "unknown", "2026-11-14"), null);
  },

  "items are numbered: tasks 1..n, blocks fresh from 1": () => {
    const { tasks, blocks } = numberItems([{ title: "a" }, { title: "b" }], [{ id: "x" }]);
    assertEqual(tasks[1].n, 2);
    assertEqual(blocks[0].n, 1);
  },

  "applyTaskAnswers edits Due Date and Status, skips Linear-born and bad dates": () => {
    const life = [
      task({ _notionId: "a", Task: "Laundry", "Due Date": "2026-11-14", Status: "🔵 Doing" }),
      task({ _notionId: "b", Task: "Book travel", "Due Date": "2026-11-14" }),
      task({ _notionId: "f", Task: "Icons", "Due Date": "2026-11-09", "Linear ID": "PD-650" }),
      task({ _notionId: "g", Task: "Plan", "Due Date": "2026-11-14" }),
    ];
    const { changes, skipped } = applyTaskAnswers(life, [
      { n: 1, notionId: "a", title: "Laundry", action: "done" },
      { n: 2, notionId: "b", title: "Book travel", action: "date", date: "2026-11-15" },
      { n: 3, notionId: "f", title: "Icons", action: "date", date: "2026-11-15" },
      { n: 4, notionId: "g", title: "Plan", action: "date", date: "Sun" },
      { n: 5, notionId: "a", title: "Laundry", action: "done", applied: "earlier" },
      { n: 6, notionId: "zz", title: "Gone", action: "done" },
    ]);
    assertEqual(changes.length, 2);
    assertEqual(life[0].Status, DONE_STATUS);
    assertEqual(life[1]["Due Date"], "2026-11-15");
    assertEqual(life[1].Status, "🔴 To Do");
    assertEqual(life[2]["Due Date"], "2026-11-09");
    assertEqual(life[3]["Due Date"], "2026-11-14");
    assertEqual(skipped.map((s) => s.n).join(","), "3,4,6");
  },

  "planned action: never touches an event that isn't a live Planned: placeholder": async () => {
    const calls = [];
    const svc = {
      getEvent: async (cal, id) =>
        ({ real: { summary: "Dinner with Mom", status: "confirmed" }, gone: { summary: "Planned: X", status: "cancelled" } })[id] || null,
      deleteEvent: async (...a) => calls.push(["delete", ...a]),
      createEvent: async (...a) => calls.push(["create", ...a]),
    };
    for (const id of ["real", "gone", "missing"]) {
      const r = await applyPlannedAction(svc, "main", { id, action: "delete" });
      assertEqual(r.result, "skipped");
    }
    assertEqual(calls.length, 0);
  },

  "planned action: reschedule creates the new slot, then deletes the old": async () => {
    const calls = [];
    const svc = {
      getEvent: async () => ({ summary: "Planned: Workout", status: "confirmed", start: {}, end: {} }),
      deleteEvent: async (cal, id) => calls.push(`delete ${id}`),
      createEvent: async (cal, ev) => calls.push(`create ${ev.summary} ${ev.start.dateTime}`),
    };
    const r = await applyPlannedAction(svc, "main", {
      id: "e1",
      action: "reschedule",
      newStart: "2026-11-15T18:00:00-05:00",
      newEnd: "2026-11-15T19:00:00-05:00",
    });
    assertEqual(r.result, "rescheduled");
    assertEqual(calls.join(" | "), "create Planned: Workout 2026-11-15T18:00:00-05:00 | delete e1");

    const dry = [];
    svc.deleteEvent = async () => dry.push("x");
    svc.createEvent = async () => dry.push("x");
    await applyPlannedAction(svc, "main", { id: "e1", action: "delete" }, { dryRun: true });
    assertEqual(dry.length, 0);
  },
};
