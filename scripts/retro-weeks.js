// Lists weeks needing retros for a given type (personal or work)
// Usage: node scripts/retro-weeks.js personal
//        node scripts/retro-weeks.js work
//
// A week whose date range hasn't closed yet is flagged "still in week" — a
// retro run today is a partial read that gets revisited once the week closes.
// Weeks that haven't started are hidden (nothing to retro yet).

const type = process.argv[2];
if (!type || !["personal", "work"].includes(type)) {
  console.error("Usage: node scripts/retro-weeks.js <personal|work>");
  process.exit(1);
}

const retro = require("../data/retro.json");
const plan = require("../data/plan.json");

const weeks = plan.weeks || [];
const isPersonal = type === "personal";
const retros = isPersonal ? retro.personalWeekly || [] : retro.workWeekly || [];
const titleField = isPersonal ? "Personal Retro" : "Work Retro";

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

const results = [];
for (const r of retros) {
  const title = r[titleField] || "";
  const weekMatch = title.match(/Week (\d+)/);
  if (!weekMatch) continue;
  const weekNum = weekMatch[1];
  const week = weeks.find((w) => w["Week"] === "Week " + weekNum);
  const start = week ? week["Date Range (SET)"] : "?";
  const end = week ? week["Date Range (SET) End"] : "?";
  const status = (r["Status"] || "Not started").trim();
  const hasDates = start !== "?" && end !== "?";
  const future = hasDates && start > today;
  const inWeek = hasDates && !future && today <= end;

  results.push({
    weekNum: Number(weekNum),
    week: "Week " + weekNum,
    start,
    end,
    status,
    future,
    inWeek,
  });
}

const open = results.filter((r) => r.status !== "Done");
const needsWork = open
  .filter((r) => !r.future)
  .sort((a, b) => a.weekNum - b.weekNum);
const hidden = open.length - needsWork.length;

console.log("Weeks needing retro work:");
for (const r of needsWork) {
  const flag = r.inWeek
    ? " — still in week, ends " + weekday(r.end) + " " + r.end
    : "";
  console.log(
    "  " + r.week + " (" + r.start + " to " + r.end + ") — " + r.status + flag
  );
}
if (needsWork.length === 0) console.log("  All retros complete!");
if (hidden > 0) {
  console.log(
    "  (" + hidden + " future week" + (hidden === 1 ? "" : "s") +
      " hidden — nothing to retro yet)"
  );
}
console.log("Or pick any week number to revisit.");
