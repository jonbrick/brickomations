#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Goals view: a deterministic, human-readable readout of where every 2026
 * goal stands — status, date, clarifying statement, the projects / tasks /
 * events that ladder to it, and (for metric + habit goals) the number the
 * data already holds. The goals pass /plan-month opens with: read this,
 * then decide what each goal's Status should say.
 *
 * Read-only against data/*.json — safe on either machine. Stages
 * local/plan/goals-bundle.json (goal rows with _notionId) for the write.
 *
 * Usage: yarn --silent goals:view
 */

const fs = require("fs");
const path = require("path");
const { loadJson, SETTLED } = require("./plan-bundle");
const { pretty, ymd } = require("./render-portfolio");

const GOALS_RELATION_ON_PROJECT = "🏆 Goal";
const PROJECTS_RELATION_ON_GOAL = "🔨 2026 Projects";
const PROJECTS_RELATION_ON_TASK = "💎 2026 Projects";
const GOALS_ROLLUP_ON_TASK = "🏆 2026 Goals";
const EVENTS_RELATION_ON_GOAL = "🎟️ 2026 Events";
const TRIPS_RELATION_ON_GOAL = "✈️ 2026 Trips";
const THEMES_RELATION_ON_GOAL = "🏔️ 2026 Themes";

const YEAR = 2026;
const YEAR_END = `${YEAR}-12-31`;

// Status order: active first, parked last (mirrors render-portfolio).
const STATUS_RANK = { "🔵 Doing": 0, "🔴 To Do": 1, "🟢 Done": 2 };
const statusRank = (s) => (s in STATUS_RANK ? STATUS_RANK[s] : 9);

// Day math on YYYY-MM-DD strings (UTC — no timezone drift).
const toUTC = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const addDays = (s, n) => {
  const dt = new Date(toUTC(s) + n * 86400000);
  return dt.toISOString().slice(0, 10);
};

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const avg = (nums) => {
  const xs = nums.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
};

// Wrap a sentence under an indent; keeps the clarifying statement readable.
function wrap(text, width, indent) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width && cur) {
      lines.push(indent + cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(indent + cur.trim());
  return lines;
}

// ---------- signals: the number the data already holds for a goal ----------
// Matched by goal name. Metric goals read collected.json (Withings / BP);
// habit goals read the weekly 🔨 Habits Summary rows in life.json.
// Config-driven on purpose — add a row, not a branch.
const GOAL_SIGNALS = [
  {
    match: /weigh/i,
    render: ({ collected, today }) => {
      const rows = (collected.withings || [])
        .filter((w) => typeof w.Weight === "number" && ymd(w.Date))
        .sort((a, b) => ymd(a.Date).localeCompare(ymd(b.Date)));
      if (!rows.length) return ["weight: (no readings in cache)"];
      const jan = avg(rows.filter((w) => ymd(w.Date).startsWith(`${YEAR}-01`)).map((w) => w.Weight));
      const last28 = avg(rows.filter((w) => ymd(w.Date) >= addDays(today, -28)).map((w) => w.Weight));
      const last = rows[rows.length - 1];
      return [
        `weight   Jan avg ${jan ?? "—"} → last 28d avg ${last28 ?? "—"}  ·  last ${pretty(ymd(last.Date))} ${last.Weight} lbs`,
      ];
    },
  },
  {
    match: /blood pressure/i,
    render: ({ collected, today }) => {
      const rows = (collected.bloodPressure || [])
        .filter((b) => typeof b["Systolic Pressure"] === "number" && ymd(b.Date))
        .sort((a, b) => ymd(a.Date).localeCompare(ymd(b.Date)));
      if (!rows.length) return ["BP: (no readings in cache)"];
      // 28-day window, widening to the last 5 readings when the cuff has
      // been idle — a blank average hides the gap instead of naming it.
      let win = rows.filter((b) => ymd(b.Date) >= addDays(today, -28));
      let label = "last 28d avg";
      if (!win.length) {
        win = rows.slice(-5);
        label = `no readings in 28d · last ${win.length} avg`;
      }
      const sys = avg(win.map((b) => b["Systolic Pressure"]));
      const dia = avg(win.map((b) => b["Diastolic Pressure"]));
      const last = rows[rows.length - 1];
      return [
        `BP       ${label} ${sys ?? "—"}/${dia ?? "—"}  ·  last ${pretty(ymd(last.Date))} ${last["Systolic Pressure"]}/${last["Diastolic Pressure"]}`,
      ];
    },
  },
  {
    match: /read/i,
    render: ({ habitsYTD }) => [
      `reading  ${habitsYTD("Reading Days")} days YTD · ${habitsYTD("Reading Sessions")} sessions`,
    ],
  },
  {
    match: /cook/i,
    render: ({ habitsYTD }) => [`cooking  ${habitsYTD("Cooking Days")} dinner cooks YTD`],
  },
];

function buildGoalsBundle() {
  const life = loadJson("life.json");
  const plan = loadJson("plan.json");
  const collected = loadJson("collected.json");
  const today = new Date().toLocaleDateString("en-CA");

  const goals = life.goals || [];
  const themes = life.themes || [];
  const projects = life.personalProjects || [];
  const tasks = life.tasks || [];
  const eventsById = new Map((plan.events || []).map((e) => [e._notionId, e]));
  const tripsById = new Map((plan.trips || []).map((t) => [t._notionId, t]));
  const projectById = new Map(projects.map((p) => [p._notionId, p]));

  // Habit YTD sums off the weekly summary rows.
  const habitsYTD = (col) =>
    (life.habits || []).reduce((n, r) => n + (typeof r[col] === "number" ? r[col] : 0), 0);

  const goalRows = goals.map((g) => {
    const id = g._notionId;
    // Projects: the goal's relation ∪ projects pointing back at the goal.
    const projIds = new Set(g[PROJECTS_RELATION_ON_GOAL] || []);
    for (const p of projects)
      if ((p[GOALS_RELATION_ON_PROJECT] || []).includes(id)) projIds.add(p._notionId);
    const goalProjects = [...projIds]
      .map((pid) => projectById.get(pid))
      .filter(Boolean)
      .sort((a, b) => statusRank(a.Status) - statusRank(b.Status));

    // Tasks: via the goal's projects, or the task's goal rollup.
    const goalTasks = tasks.filter(
      (t) =>
        (t[PROJECTS_RELATION_ON_TASK] || []).some((pid) => projIds.has(pid)) ||
        (t[GOALS_ROLLUP_ON_TASK] || []).includes(id)
    );
    const done = goalTasks
      .filter((t) => t.Status === "🟢 Done")
      .sort((a, b) => ymd(b["Due Date"]).localeCompare(ymd(a["Due Date"])));
    const open = goalTasks
      .filter((t) => !SETTLED.has(t.Status))
      .sort((a, b) => (ymd(a["Due Date"]) || "9999").localeCompare(ymd(b["Due Date"]) || "9999"));

    const events = (g[EVENTS_RELATION_ON_GOAL] || []).map((eid) => eventsById.get(eid)).filter(Boolean);
    const trips = (g[TRIPS_RELATION_ON_GOAL] || []).map((tid) => tripsById.get(tid)).filter(Boolean);

    const signal = GOAL_SIGNALS.find((s) => s.match.test(String(g.Name || "")));
    const signals = signal ? signal.render({ collected, habitsYTD, today }) : [];

    const goalDate = ymd(g["Goal Date"]);
    const isDone = g.Status === "🟢 Done";
    return {
      _notionId: id,
      name: g.Name,
      status: g.Status,
      category: g.Category,
      doneBy: g["Done by..."],
      goalDate,
      achievedDate: ymd(g["Achieved Date"]) || null,
      pastDate: !isDone && goalDate && goalDate < today,
      clarifying: g["Clarifying Statement"] || "",
      themeIds: g[THEMES_RELATION_ON_GOAL] || [],
      projects: goalProjects.map((p) => ({
        _notionId: p._notionId,
        name: p.Project,
        status: p.Status,
        priority: p.Priority,
        date: ymd(p.Date) || null,
        openCount: tasks.filter(
          (t) => !SETTLED.has(t.Status) && (t[PROJECTS_RELATION_ON_TASK] || []).includes(p._notionId)
        ).length,
      })),
      tasks: {
        doneCount: done.length,
        openCount: open.length,
        lastDone: done[0] ? { title: done[0].Task, date: ymd(done[0]["Due Date"]) } : null,
        nextOpen: open.find((t) => ymd(t["Due Date"]))
          ? { title: open.find((t) => ymd(t["Due Date"])).Task, date: ymd(open.find((t) => ymd(t["Due Date"]))["Due Date"]) }
          : null,
        undatedOpen: open.filter((t) => !ymd(t["Due Date"])).map((t) => t.Task),
      },
      events: events.map((e) => ({ name: e["Event Name"], date: ymd(e.Date), status: e.Status })),
      trips: trips.map((t) => ({ name: t["Trip Name"], date: ymd(t.Date), end: ymd(t["Date End"]), status: t.Status })),
      signals,
    };
  });

  // Themes carry their goals; a goal with no theme lands under "(no theme)".
  const themeRows = themes.map((t) => ({
    _notionId: t._notionId,
    name: t.Name,
    category: t.Category,
    description: t.Description || "",
    goals: goalRows
      .filter((g) => g.themeIds.includes(t._notionId))
      .sort((a, b) => statusRank(a.status) - statusRank(b.status) || String(a.name).localeCompare(String(b.name))),
  }));
  const themed = new Set(themeRows.flatMap((t) => t.goals.map((g) => g._notionId)));
  const unthemed = goalRows.filter((g) => !themed.has(g._notionId));

  // Projects with no goal — valid (admin projects), but worth seeing beside the goals.
  const goalless = projects
    .filter(
      (p) =>
        p.Category !== "💼 Work" &&
        !(p[GOALS_RELATION_ON_PROJECT] || []).length &&
        !goals.some((g) => (g[PROJECTS_RELATION_ON_GOAL] || []).includes(p._notionId)) &&
        p.Status !== "🟢 Done"
    )
    .sort((a, b) => statusRank(a.Status) - statusRank(b.Status));

  // Work projects are Linear-born and never carry a goal relation, so the
  // work goals render empty — list the active ones here so the pass can
  // say which goal each one serves.
  const workProjects = projects
    .filter((p) => p.Category === "💼 Work" && (p.Status === "🔵 Doing" || p.Status === "🔴 To Do"))
    .sort((a, b) => statusRank(a.Status) - statusRank(b.Status));

  return {
    generatedAt: new Date().toISOString(),
    dataPulledAt: (life._meta && (life._meta.pulledAt || life._meta.pulled_at)) || null,
    today,
    daysLeft: daysBetween(today, YEAR_END),
    counts: {
      total: goalRows.length,
      done: goalRows.filter((g) => g.status === "🟢 Done").length,
      doing: goalRows.filter((g) => g.status === "🔵 Doing").length,
      toDo: goalRows.filter((g) => g.status === "🔴 To Do").length,
      pastDate: goalRows.filter((g) => g.pastDate).length,
    },
    themes: themeRows,
    unthemed,
    goalless: goalless.map((p) => ({ _notionId: p._notionId, name: p.Project, status: p.Status, priority: p.Priority })),
    workProjects: workProjects.map((p) => ({ _notionId: p._notionId, name: p.Project, status: p.Status, priority: p.Priority, date: ymd(p.Date) || null })),
  };
}

function render(b) {
  const out = [];
  const P = (s = "") => out.push(s);
  const RULE = "═".repeat(62);
  const I = "      ";

  P(RULE);
  P(`  ${YEAR} GOALS  ·  as of ${pretty(b.today)}  ·  ${b.daysLeft} days left in the year`);
  P(`  data pulled ${b.dataPulledAt || "?"}`);
  P(RULE);
  P("");
  const c = b.counts;
  P(
    `  ${c.total} goals  ·  ${c.done} done  ·  ${c.doing} doing  ·  ${c.toDo} to do  ·  ${c.pastDate} past their date`
  );

  const goalBlock = (g) => {
    P("");
    const when = g.achievedDate
      ? `achieved ${pretty(g.achievedDate)}`
      : `${g.doneBy || "by"} ${g.goalDate ? pretty(g.goalDate) : "?"}${g.pastDate ? "  ⚠ PAST DATE" : ""}`;
    P(`  ${(g.status || "").padEnd(9)} ${g.name}   (${g.category || "?"} · ${when})`);
    for (const ln of wrap(g.clarifying, 86, I)) P(ln);
    if (g.status === "🟢 Done") return; // closed goals get the one line + statement
    if (g.projects.length) {
      P(`${I}projects`);
      for (const p of g.projects)
        P(
          `${I}  ${(p.status || "").padEnd(9)} ${(p.priority || "—").padEnd(7)} ${p.name}  ·  open ${p.openCount}${p.date ? `  ·  date ${p.date}` : ""}`
        );
    } else {
      P(`${I}projects   — none`);
    }
    const t = g.tasks;
    const bits = [`${t.doneCount} done`, `${t.openCount} open`];
    if (t.lastDone) bits.push(`last done ${pretty(t.lastDone.date)} · ${t.lastDone.title}`);
    if (t.nextOpen) bits.push(`next ${pretty(t.nextOpen.date)} · ${t.nextOpen.title}`);
    P(`${I}tasks      ${bits.join("  ·  ")}`);
    if (t.undatedOpen.length)
      P(`${I}           undated: ${t.undatedOpen.slice(0, 6).join(" · ")}${t.undatedOpen.length > 6 ? ` · +${t.undatedOpen.length - 6}` : ""}`);
    for (const e of g.events) P(`${I}event      🎟️  ${pretty(e.date)}  ${e.name}  (${e.status || "?"})`);
    for (const tr of g.trips)
      P(`${I}trip       ✈️  ${pretty(tr.date)}${tr.end && tr.end !== tr.date ? ` → ${pretty(tr.end)}` : ""}  ${tr.name}  (${tr.status || "?"})`);
    for (const s of g.signals) P(`${I}${s}`);
  };

  for (const t of b.themes) {
    P("");
    P(RULE);
    P(`🏔️  ${t.name}   (${t.category || "?"})`);
    for (const ln of wrap(t.description, 90, "    ")) P(ln);
    if (!t.goals.length) P("    (no goals on this theme)");
    for (const g of t.goals) goalBlock(g);
  }
  if (b.unthemed.length) {
    P("");
    P(RULE);
    P("🏔️  (no theme)");
    for (const g of b.unthemed) goalBlock(g);
  }

  P("");
  P(RULE);
  P(`PROJECTS WITH NO GOAL   (${b.goalless.length} · admin projects are valid here — flag only if one should ladder up)`);
  for (const p of b.goalless) P(`    ${(p.status || "").padEnd(9)} ${(p.priority || "—").padEnd(7)} ${p.name}`);
  P("");
  P(RULE);
  P(`WORK PROJECTS   (${b.workProjects.length} active · Linear-born, no goal relation — the pass names which goal each serves)`);
  for (const p of b.workProjects)
    P(`    ${(p.status || "").padEnd(9)} ${(p.priority || "—").padEnd(7)} ${p.name}${p.date ? `  ·  date ${p.date}` : ""}`);
  P("");
  P(RULE);
  return out.join("\n") + "\n";
}

function main() {
  try {
    const bundle = buildGoalsBundle();
    process.stdout.write(render(bundle));
    const stageDir = path.join(__dirname, "..", "local", "plan");
    fs.mkdirSync(stageDir, { recursive: true });
    const stagePath = path.join(stageDir, "goals-bundle.json");
    fs.writeFileSync(stagePath, JSON.stringify(bundle, null, 2) + "\n");
    process.stderr.write(`\n[structured bundle staged → local/plan/goals-bundle.json]\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { buildGoalsBundle, render };
