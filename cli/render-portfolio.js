#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Portfolio render: the goals / projects / backlog / work-state block that
 * /plan-week Beat 1 (rocks + big to-dos) and /plan-month read first. Shared
 * by plan-view.js and month-view.js so both renders say the same thing the
 * same way. Pure — takes a bundle's `inputs`, returns lines.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// --- date helpers (UTC arithmetic — no timezone drift on day math) ---
const ymd = (s) => String(s || "").slice(0, 10);
const parseYMD = (s) => {
  const [y, m, d] = String(s).split("-").map(Number);
  return { y, m, d };
};
const weekdayOf = (s) => {
  const { y, m, d } = parseYMD(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const pretty = (s) => {
  if (!s) return "";
  const { m, d } = parseYMD(s);
  return `${WEEKDAYS[weekdayOf(s)]} ${MONTHS[m - 1]} ${d}`;
};

// Lane names per side (Overall is handled separately — it's a sentence, not
// bullets). Canon: notion-conventions § 2026 Months.
const PERSONAL_LANES = ["Personal", "Interpersonal", "Home", "Physical Health", "Mental Health"];
const WORK_LANES = ["Design", "Coding", "Research", "Admin"];
const PERSONAL_OVERALL = "Overall Personal Plan";
const WORK_OVERALL = "Overall Work Plan";

// Downstream reads My-else-AI: Jon's column when he wrote one, the draft otherwise.
function laneText(row, lane) {
  if (!row) return "";
  const my = row[`My ${lane}`];
  if (typeof my === "string" && my.trim()) return my.trim();
  const ai = row[`AI ${lane}`];
  return typeof ai === "string" ? ai.trim() : "";
}

// One side's month-plan row as lines: Overall sentence, then each lane's
// bullets top-down. Empty lanes are skipped (a blank cell is a blank cell;
// "- Not a focus" is content and renders).
function monthPlanLines(label, row, overallLane, lanes, indent = "    ") {
  if (!row) return [];
  const out = [];
  const overall = laneText(row, overallLane);
  out.push(`${indent}${label}${row.Status ? `  (${row.Status})` : ""}`);
  if (overall) out.push(`${indent}  ${overall}`);
  for (const lane of lanes) {
    const text = laneText(row, lane);
    if (!text) continue;
    out.push(`${indent}  ${lane}`);
    for (const ln of text.split("\n")) {
      if (ln.trim()) out.push(`${indent}    ${ln.trim()}`);
    }
  }
  return out;
}

// Status order for goal + project lists: active first, parked last. Goals
// carry the wider 🌄 2026 Goals enum (notion-conventions § 2026 Goals);
// projects use 🔵 Doing / 🔴 To Do / 🧊 Icebox. Unknown values sort last.
const STATUS_RANK = {
  "🔵 Doing": 0,
  "🟡 Scheduled": 1,
  "🟠 To Book": 1,
  "🔴 To Do": 2,
  "🟣 Considering": 3,
  "⏸️ Blocked": 3,
  "🧊 Ice Box": 4,
  "🧊 Icebox": 4,
  "🟢 Done": 8,
  "↗️ Next Year": 9,
  "❌ Cancelled": 9,
};
const statusRank = (s) => (s in STATUS_RANK ? STATUS_RANK[s] : 9);
const PRIORITY_RANK = { Urgent: 0, High: 1, Medium: 2, Med: 2, Low: 3 };
const priorityRank = (p) => (p in PRIORITY_RANK ? PRIORITY_RANK[p] : 9);
const byStatusThenPriority = (a, b) =>
  statusRank(a.Status) - statusRank(b.Status) ||
  priorityRank(a.Priority) - priorityRank(b.Priority) ||
  String(a.Project || "").localeCompare(String(b.Project || ""));

// The asymmetries the counts alone hide — rock candidates, flagged inline.
function projectFlag(p) {
  if (p.Status === "🔵 Doing" && !p.openTaskCount) return "⚠ Doing, no open tasks";
  if (p.Status === "🔴 To Do" && (p.Priority === "High" || p.Priority === "Urgent"))
    return `⚠ ${p.Priority}, not started`;
  return "";
}

// Work tickets carry no Notion project relation (they're Linear-born), so a
// work project's open count is unknowable here — personal rows only.
function projectLine(p, indent, { counts = true } = {}) {
  const pri = (p.Priority || "—").padEnd(7);
  const open = counts ? `open ${p.openTaskCount || 0}` : "";
  const dated = p.Date ? `date ${ymd(p.Date)}` : "";
  const flag = counts ? projectFlag(p) : "";
  const tail = [open, dated, flag].filter(Boolean).join("  ·  ");
  return `${indent}${(p.Status || "").padEnd(9)} ${pri} ${p.Project}${tail ? `  ·  ${tail}` : ""}`;
}

function ticketLine(t, indent) {
  const pri = (t.Priority || "—").padEnd(7);
  const id = t["Linear ID"] ? `${t["Linear ID"]}  ` : "";
  const due = t["Due Date"] ? `  ·  due ${ymd(t["Due Date"])}` : "";
  const cat = t["WORK Category"] ? `  ·  ${t["WORK Category"]}` : "";
  return `${indent}${(t.Status || "").padEnd(9)} ${pri} ${id}${t.Task}${due}${cat}`;
}

/**
 * Render the portfolio block.
 * @param {object} inputs  a plan/month bundle's `inputs`
 * @param {object} [opts]
 * @param {string} [opts.title]      section title (default "PORTFOLIO")
 * @param {string} [opts.subtitle]   parenthetical after the title
 * @returns {string[]} lines
 */
function portfolioLines(inputs, opts = {}) {
  const out = [];
  const P = (s = "") => out.push(s);
  const I = "    ";
  const title = opts.title || "PORTFOLIO";
  const subtitle =
    opts.subtitle || "(goals · projects · backlog · work state — read this first)";
  P(`${title}   ${subtitle}`);

  // ---------- month plan (My-else-AI) ----------
  const mp = inputs.monthPlans || {};
  const mpLines = [
    ...monthPlanLines("🌱 personal", mp.personal, PERSONAL_OVERALL, PERSONAL_LANES),
    ...monthPlanLines("💼 work", mp.work, WORK_OVERALL, WORK_LANES),
  ];
  if (mpLines.length) {
    P("");
    P("  Month plan (My-else-AI)");
    for (const ln of mpLines) P(ln);
  }

  // ---------- goals ----------
  const goals = (inputs.goals || []).slice().sort(
    (a, b) => statusRank(a.Status) - statusRank(b.Status)
  );
  P("");
  P(`  Goals (${goals.length})`);
  for (const g of goals)
    P(`${I}${(g.Status || "").padEnd(9)} ${g.Name}${g.Category ? `  (${g.Category})` : ""}`);

  // ---------- personal projects ----------
  const pp = (inputs.personalProjects || []).slice().sort(byStatusThenPriority);
  P("");
  P(`  Personal projects (${pp.length})`);
  for (const p of pp) P(projectLine(p, I));

  // ---------- undated backlog ----------
  const backlog = inputs.undatedBacklog || [];
  const backlogTotal = backlog.reduce((n, g) => n + g.count, 0);
  P("");
  P(`  Undated backlog (${backlogTotal} across ${backlog.length} projects)`);
  for (const g of backlog) P(`${I}${g.project} (${g.count})`);

  // ---------- work projects ----------
  const wp = ((inputs.workProjects || {}).projects || []).slice().sort(byStatusThenPriority);
  P("");
  P(`  Work projects (${wp.length})`);
  for (const p of wp) P(projectLine(p, I, { counts: false }));

  // ---------- work tickets ----------
  const wt = ((inputs.workTickets || {}).tickets || []).slice().sort(
    (a, b) =>
      ymd(a["Due Date"] || "9999").localeCompare(ymd(b["Due Date"] || "9999")) ||
      priorityRank(a.Priority) - priorityRank(b.Priority)
  );
  P("");
  P(`  Work tickets (${wt.length})`);
  for (const t of wt) P(ticketLine(t, I));

  return out;
}

module.exports = {
  portfolioLines,
  statusRank,
  monthPlanLines,
  laneText,
  pretty,
  ymd,
  weekdayOf,
  WEEKDAYS,
  MONTHS,
  PERSONAL_LANES,
  WORK_LANES,
  PERSONAL_OVERALL,
  WORK_OVERALL,
};
