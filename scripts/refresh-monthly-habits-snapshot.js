// One-shot: refresh the "Monthly Habits" text snapshot from its Roll Up
// formula on personal monthly recaps where the two differ.
//
// Companion to clear-zero-health-averages.js — once the junk zeros are
// cleared from the weekly records, the Monthly Habits Roll Up formula
// recomputes live, but the free-text "Monthly Habits" column is a snapshot
// and holds the old numbers until re-copied. This re-copies ONLY that one
// column. A full `yarn aggregate` re-run would re-copy every Roll Up → value
// column, including the My/AI retro fields — more than this cleanup needs.
//
// Usage:
//   node scripts/refresh-monthly-habits-snapshot.js           # dry-run
//   node scripts/refresh-monthly-habits-snapshot.js --apply   # writes to Notion

require("dotenv").config();
const config = require("../src/config");
const NotionDatabase = require("../src/databases/NotionDatabase");
const { delay } = require("../src/utils/async");

const apply = process.argv.includes("--apply");

const FORMULA_PROP = "Monthly Habits Roll Up";
const VALUE_PROP = "Monthly Habits";

// Pull the metric lines (weight/BP) out of a habits blob for compact display
function metricLines(text) {
  return (text || "")
    .split("\n")
    .filter((l) => /Weight|BP/.test(l))
    .join(" ; ");
}

async function main() {
  const db = new NotionDatabase();
  const databaseId = config.notion.databases.personalMonthlyRecap;
  if (!databaseId) {
    throw new Error("PERSONAL_MONTHLY_RECAP_DATABASE_ID not set");
  }

  const pages = await db.queryDatabaseAll(databaseId);
  let refreshed = 0;

  // Sort by title so months print in calendar order
  pages.sort((a, b) =>
    db.extractProperty(a, "Month Recap").localeCompare(db.extractProperty(b, "Month Recap"))
  );

  for (const page of pages) {
    const title = db.extractProperty(page, "Month Recap");
    const rollUp = db.extractProperty(page, FORMULA_PROP) || "";
    const current = db.extractProperty(page, VALUE_PROP) || "";

    if (rollUp === current) continue;

    refreshed++;
    console.log(`  ${title}:`);
    console.log(`    old: ${metricLines(current) || "(empty)"}`);
    console.log(`    new: ${metricLines(rollUp) || "(empty)"}`);

    if (apply) {
      await db.updatePage(page.id, { [VALUE_PROP]: rollUp });
      await delay(config.sources.rateLimits.notion.backoffMs);
    }
  }

  console.log(`\nRecaps needing refresh: ${refreshed}`);
  console.log(apply ? "\n✓ Snapshots refreshed." : "\nDry-run only. Re-run with --apply.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
