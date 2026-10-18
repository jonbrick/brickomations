// Guards cli/daily-brief.js carry history + rocks (2026-10-18).
//
// The morning summary says "back for a fifth morning, Urgent on Thu 2026-09-03"
// from these fields alone, so: distinct mornings (not consecutive days), ID match
// preferred with a title fallback for pre-ID briefs, first-morning priority kept
// even though Notion has since cleared it, and a 14-day window that never counts
// today's own file.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { assert, assertEqual } = require("./helpers");
const {
  shiftDate,
  withCarryHistory,
  readPriorBriefs,
  getRocks,
  getTasks,
} = require("../cli/daily-brief");

const T = (id, title, priority = "") => ({ _notionId: id, title, priority });

module.exports = {
  "carry: distinct prior mornings, first-morning priority, gaps don't reset": () => {
    const prior = [
      { date: "2026-09-03", tasks: [T("slo", "SLO picker UX", "Urgent")] },
      { date: "2026-09-08", tasks: [T("slo", "SLO picker UX", "")] }, // priority cleared later — ignored
      { date: "2026-09-09", tasks: [T("slo", "SLO picker UX", "High")] },
      { date: "2026-09-14", tasks: [T("slo", "SLO picker UX", "High")] },
      { date: "2026-09-22", tasks: [T("other", "Something else")] },
    ];
    const [slo, fresh] = withCarryHistory([T("slo", "SLO picker UX"), T("new", "Brand new")], prior);
    assertEqual(slo.push_count, 4, "four prior mornings");
    assertEqual(slo.morning_number, 5, "today is the fifth");
    assertEqual(slo.first_planned, "2026-09-03");
    assertEqual(slo.first_priority, "Urgent", "priority from the FIRST morning");
    assertEqual(slo.planned_days.join(","), "2026-09-03,2026-09-08,2026-09-09,2026-09-14");
    assertEqual(fresh.push_count, 0);
    assertEqual(fresh.morning_number, 1);
    assertEqual(fresh.first_planned, null);
    assertEqual(fresh.first_priority, null);
  },

  "carry: Notion ID wins over title; title fallback when a side lacks the ID": () => {
    const prior = [
      { date: "2026-10-14", tasks: [{ title: "Gradient PR", priority: "" }] }, // pre-ID brief
      { date: "2026-10-15", tasks: [T("g", "Gradient PR — renamed", "")] },
      { date: "2026-10-16", tasks: [T("zzz", "Gradient PR", "High")] }, // same title, different task
    ];
    const [g] = withCarryHistory([T("g", "Gradient PR")], prior);
    assertEqual(g.planned_days.join(","), "2026-10-14,2026-10-15", "title match on 10-14, ID match on 10-15, ID mismatch on 10-16");
    assertEqual(g.push_count, 2);
    assertEqual(g.first_priority, null, "no priority on the first morning → null, not empty string");
  },

  "readPriorBriefs: 14-day window, excludes today and the future, skips corrupt files": () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "briefs-"));
    const write = (d, body) => fs.writeFileSync(path.join(dir, `${d}.json`), body);
    write("2026-10-04", JSON.stringify({ tasks: [T("a", "too old")] })); // 15 days back
    write("2026-10-05", JSON.stringify({ tasks: [T("a", "edge in")] })); // exactly 14 days back
    write("2026-10-12", "{not json");
    write("2026-10-18", JSON.stringify({ tasks: [T("a", "yesterday")] }));
    write("2026-10-19", JSON.stringify({ tasks: [T("a", "today")] }));
    write("2026-10-20", JSON.stringify({ tasks: [T("a", "tomorrow")] }));
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignored");
    const got = readPriorBriefs("2026-10-19", dir);
    assertEqual(got.map((b) => b.date).join(","), "2026-10-05,2026-10-18");
  },

  "shiftDate: crosses month and year boundaries": () => {
    assertEqual(shiftDate("2026-10-05", -14), "2026-09-21");
    assertEqual(shiftDate("2026-01-03", -14), "2025-12-20");
    assertEqual(shiftDate("2026-03-08", -1), "2026-03-07"); // DST switch day in ET
  },

  "rocks: week relation first, date-span fallback, task rock resolved by ID": () => {
    const plan = {
      rocks: [
        { _notionId: "r1", Rock: "36. Design system strategy documented", Category: "💼 Work", Status: "🔵 In Progress", Date: "2026-09-06", "Date End": "2026-09-12", "My Description": "", "AI Description": "Get the doc out." },
        { _notionId: "r2", Rock: "Apartment reset", Category: "🌱 Personal", Status: "🔴 To Do", Date: "2026-09-06", "Date End": "2026-09-12" },
        { _notionId: "r3", Rock: "Other week", Category: "🌱 Personal", Status: "🔴 To Do", Date: "2026-09-13", "Date End": "2026-09-19" },
      ],
    };
    const viaRelation = getRocks(plan, { "🪨 2026 Rocks": ["r2", "missing"] }, "2026-09-08");
    assertEqual(viaRelation.map((r) => r.title).join("|"), "Apartment reset", "relation wins; unknown IDs dropped");
    assertEqual(viaRelation[0].category, "Personal");
    assertEqual(viaRelation[0].status, "To Do");

    const viaDates = getRocks(plan, { "🪨 2026 Rocks": [] }, "2026-09-08");
    assertEqual(viaDates.map((r) => r.title).join("|"), "36. Design system strategy documented|Apartment reset", "date-span fallback");
    assertEqual(viaDates[0].description, "Get the doc out.", "AI Description when My Description is empty");
    assertEqual(getRocks(plan, null, "2026-12-25").length, 0, "no rocks → empty, not an error");

    const rockById = new Map(plan.rocks.map((r) => [r._notionId, r]));
    const life = { tasks: [
      { _notionId: "t1", Task: "Strategy doc first draft", "Due Date": "2026-09-08", "🪨 2026 Rocks": ["r1"], Status: "🔴 To Do", Priority: "🔥 High", Category: "💼 Work", "WORK Category": "✏️ Design" },
      { _notionId: "t2", Task: "Water plants", "Due Date": "2026-09-08", Status: "🔴 To Do", Category: "🌱 Personal", "PERSONAL Category": "🏠 Home" },
      { _notionId: "t3", Task: "Not today", "Due Date": "2026-09-09" },
    ] };
    const tasks = getTasks(life, "2026-09-08", rockById);
    assertEqual(tasks.length, 2);
    assertEqual(tasks[0].rock.title, "36. Design system strategy documented");
    assertEqual(tasks[0].priority, "High");
    assertEqual(tasks[1].rock, null);
  },
};
