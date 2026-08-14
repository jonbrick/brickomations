// Lists months needing reflection work for a given type (personal or work)
// Usage: node scripts/recap-months.js personal
//        node scripts/recap-months.js work

const type = process.argv[2];
if (!type || !["personal", "work"].includes(type)) {
  console.error("Usage: node scripts/recap-months.js <personal|work>");
  process.exit(1);
}

const summaries = require("../data/summaries.json");
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

const results = [];
for (const r of recaps) {
  const title = r["Month Recap"] || "";
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

  results.push({ title, status, aiRecap, myRecap, myQs, aiQs, aggBytes });
}

const needsWork = results
  .filter((r) => r.status !== "Done")
  .sort((a, b) => a.title.localeCompare(b.title));

console.log("Months needing recap work:");
for (const r of needsWork) {
  const ai = r.aiRecap ? "✓" : "◯";
  const my = r.myRecap ? "✓" : "◯";
  const agg = r.aggBytes > 100 ? "ready" : `THIN (${r.aggBytes}b)`;
  console.log(
    `  ${r.title} — ${r.status} — AI:${ai} My:${my} Qs(AI):${r.aiQs}/3 Qs(My):${r.myQs}/3 | brickomations agg: ${agg}`
  );
}
if (needsWork.length === 0) console.log("  All monthly recaps complete!");
console.log("Or pick any month to revisit.");
