// One-shot: clear literal-0 weight/BP averages on weekly summary records.
//
// The weekly weight/BP parsers used to write 0 when a week had no readings.
// The monthly rollup mean ignores blank weeks but counts a written 0 as a
// real data point, dragging sparse months (May 167.46, Aug 42.64) and pinning
// no-data months' BP at 0. The parsers now write blanks (see
// fix/avg-weight-bp-blank-not-zero); this clears the zeros already in Notion.
//
// A true 0 is impossible for body weight or blood pressure, so "value === 0"
// is a safe selector. Weeks with real readings are untouched. The monthly
// formulas recompute live once the zeros are gone.
//
// Targets both weekly DBs (Personal Summaries + Habits Summaries).
// data/summaries.json refreshes on the next pull — nothing local to edit.
//
// Usage:
//   node scripts/clear-zero-health-averages.js           # dry-run
//   node scripts/clear-zero-health-averages.js --apply   # writes to Notion

require("dotenv").config();
const config = require("../src/config");
const NotionDatabase = require("../src/databases/NotionDatabase");
const { delay } = require("../src/utils/async");

const apply = process.argv.includes("--apply");

const FIELDS = [
  "Body Weight Average",
  "Blood Pressure Systolic Average",
  "Blood Pressure Diastolic Average",
];

const TARGET_DBS = [
  { label: "Personal Summaries - Weeks", id: config.notion.databases.personalSummary },
  { label: "Habits Summary Weeks", id: config.notion.databases.personalHabits },
];

function pageTitle(page) {
  const titleProp = Object.values(page.properties).find((p) => p.type === "title");
  return titleProp?.title?.map((t) => t.plain_text).join("") || "(untitled)";
}

async function main() {
  const db = new NotionDatabase();
  let totalClears = 0;
  let recordsAffected = 0;

  for (const target of TARGET_DBS) {
    if (!target.id) {
      console.log(`⚠️  ${target.label}: database ID not set, skipping`);
      continue;
    }

    console.log(`\n${target.label}:`);
    const pages = await db.queryDatabaseAll(target.id);

    for (const page of pages) {
      const clears = FIELDS.filter(
        (name) => page.properties[name]?.type === "number" && page.properties[name].number === 0
      );
      if (clears.length === 0) continue;

      recordsAffected++;
      totalClears += clears.length;
      console.log(`  ${pageTitle(page)}: ${clears.join(", ")} → cleared`);

      if (apply) {
        const properties = {};
        clears.forEach((name) => {
          properties[name] = { number: null };
        });
        await db.updatePage(page.id, properties);
        await delay(config.sources.rateLimits.notion.backoffMs);
      }
    }
  }

  console.log(`\nRecords affected: ${recordsAffected}`);
  console.log(`Total field clears: ${totalClears}`);
  console.log(apply ? "\n✓ Cleared in Notion." : "\nDry-run only. Re-run with --apply.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
