// Lists months needing reflection work for a given type (personal or work)
// Usage: node scripts/recap-months.js personal
//        node scripts/recap-months.js work
//
// A month that hasn't closed yet is flagged "still in month" — a recap run today
// is a partial read that gets revisited once the month closes. Months that
// haven't started are hidden (nothing to recap yet). Mirrors retro-weeks.js.

const type = process.argv[2];
if (!type || !["personal", "work"].includes(type)) {
  console.error("Usage: node scripts/recap-months.js <personal|work>");
  process.exit(1);
}

const summaries = require("../data/summaries.json");
const plan = require("../data/plan.json");
const isPersonal = type === "personal";
const recaps = isPersonal
  ? summaries.personalMonthlyRecap || []
  : summaries.workMonthlyRecap || [];

// Mirrors MONTHLY_RECAP_BLOCK_PROPERTIES + MONTHLY_RECAP_TASK_PROPERTIES in
// src/config/unified-sources.js. Used to detect whether brickomations's `recap`
// stage has populated the month (sum-of-bytes check, not single-field sample —
// any one field can legitimately be empty if the month had no events in that
// category).
const aggFields = isPersonal
  ? [
      "Family Block Details",
      "Relationship Block Details",
      "Interpersonal Block Details",
      "Hobbies Block Details",
      "Mental Health Block Details",
      "Personal Task Details",
      "Home Task Details",
      "Physical Health Task Details",
      "Mental Health Task Details",
      "Admin Task Details",
      "Coding Task Details",
    ]
  : [
      "Meetings Block Details",
      "Social & Personal Block Details",
      "Design Task Details",
      "Research Task Details",
      "Admin Task Details",
      "Coding Task Details",
      "QA Task Details",
      "Hiring Task Details",
      "Sketch Task Details",
    ];

const now = new Date();
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");

function weekday(dateStr) {
  // Noon keeps a date-only string from rolling back a day in US timezones
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
  });
}

// Month records carry no dates — only "10. Oct" titles — so the year comes from
// the weeks related to the month (plan.json weeks → 🗓️ 2026 Months relation).
// Falls back to today's year (previous year when the month is still ahead of us)
// if no week links to the month yet.
const weeks = plan.weeks || [];
function monthRange(monthIds, monthNum) {
  let year = null;
  const related = weeks.filter((w) =>
    (w["🗓️ 2026 Months"] || []).some((id) => monthIds.includes(id))
  );
  const sameMonth = related.find(
    (w) => Number((w["Date Range (SET)"] || "").slice(5, 7)) === monthNum
  );
  const anchor = sameMonth || related[0];
  if (anchor) {
    const d = anchor["Date Range (SET) End"] || anchor["Date Range (SET)"] || "";
    if (/^\d{4}-/.test(d)) year = Number(d.slice(0, 4));
  }
  if (year === null) {
    year = now.getFullYear();
    if (monthNum > now.getMonth() + 1) year -= 1;
  }
  const mm = String(monthNum).padStart(2, "0");
  const lastDay = new Date(year, monthNum, 0).getDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${lastDay}` };
}

const results = [];
for (const r of recaps) {
  const title = r["Month Recap"] || "";
  const monthMatch = title.match(/^(\d{1,2})\./);
  const monthNum = monthMatch ? Number(monthMatch[1]) : null;
  const range = monthNum ? monthRange(r["🗓️ 2026 Months"] || [], monthNum) : null;
  const future = !!range && range.start > today;
  const inMonth = !!range && !future && today <= range.end;
  const aiRecap = (r["AI Recap"] || "").trim();
  const myRecap = (r["My Recap"] || "").trim();
  const myQ1 = (r["My What went well?"] || "").trim();
  const myQ2 = (r["My What did not go so well?"] || "").trim();
  const myQ3 = (r["My What did I learn?"] || "").trim();
  const aiQ1 = (r["AI What went well?"] || "").trim();
  const aiQ2 = (r["AI What did not go so well?"] || "").trim();
  const aiQ3 = (r["AI What did I learn?"] || "").trim();
  const status = (r["Status"] || "Not started").trim();
  // brickomations's aggregate stage joins weekly retro values with commas; when all
  // weeks are empty, the snapshot field becomes ",,,," — non-empty but
  // semantically empty. Require at least one alphanumeric character so the
  // comma-soup case correctly counts as 0/3.
  const hasContent = (s) => /[a-zA-Z0-9]/.test(s);
  const myQs = [myQ1, myQ2, myQ3].filter(hasContent).length;
  const aiQs = [aiQ1, aiQ2, aiQ3].filter(hasContent).length;
  const aggBytes = aggFields.reduce(
    (sum, f) => sum + (r[f] || "").length,
    0
  );

  results.push({
    title,
    monthNum: monthNum || 0,
    end: range ? range.end : null,
    future,
    inMonth,
    status,
    aiRecap,
    myRecap,
    myQs,
    aiQs,
    aggBytes,
  });
}

const open = results.filter((r) => r.status !== "Done");
const needsWork = open
  .filter((r) => !r.future)
  .sort((a, b) => a.monthNum - b.monthNum || a.title.localeCompare(b.title));
const hidden = open.length - needsWork.length;

console.log("Months needing recap work:");
for (const r of needsWork) {
  const ai = r.aiRecap ? "✓" : "◯";
  const my = r.myRecap ? "✓" : "◯";
  const agg = r.aggBytes > 100 ? "ready" : `THIN (${r.aggBytes}b)`;
  const flag = r.inMonth
    ? ` — still in month, ends ${weekday(r.end)} ${r.end}`
    : "";
  console.log(
    `  ${r.title} — ${r.status}${flag} — AI:${ai} My:${my} Qs(AI):${r.aiQs}/3 Qs(My):${r.myQs}/3 | brickomations agg: ${agg}`
  );
}
if (needsWork.length === 0) console.log("  All monthly recaps complete!");
if (hidden > 0) {
  console.log(
    `  (${hidden} future month${hidden === 1 ? "" : "s"} hidden — nothing to recap yet)`
  );
}
console.log("Or pick any month to revisit.");
