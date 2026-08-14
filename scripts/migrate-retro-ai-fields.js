// One-shot migration: move AI-written bullet content from `My What X` columns
// to `AI What X` columns on weekly retro records.
//
// Background: before the AI/My column split, the bare-named columns
// `What went well?`, `What did not go so well?`, `What did I learn?` were
// filled by the /retro-week skill. Those columns were renamed to `My What X`
// in Notion as the user-owned half of the new split. The AI content needs to
// move into the new `AI What X` columns so the My side is empty for Jon.
//
// Logic per record:
//   For each pair (My What X, AI What X) in the 3 What-fields:
//     If My X non-empty AND AI X empty → copy My X → AI X, clear My X.
//     Else skip.
//
// Safe to re-run — already-migrated records are no-ops.
//
// Usage:
//   node scripts/migrate-retro-ai-fields.js           # dry-run (default)
//   node scripts/migrate-retro-ai-fields.js --apply   # write retro.json
//
// After --apply, run `yarn push` to send the migration to Notion.

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "retro.json");
const apply = process.argv.includes("--apply");

const FIELD_PAIRS = [
  ["My What went well?", "AI What went well?"],
  ["My What did not go so well?", "AI What did not go so well?"],
  ["My What did I learn?", "AI What did I learn?"],
];

function trimOrEmpty(v) {
  return typeof v === "string" ? v : "";
}

const retro = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

let totalMoves = 0;
let totalSkipped = 0;
let recordsAffected = 0;

for (const kind of ["personalWeekly", "workWeekly"]) {
  const recs = retro[kind] || [];
  for (const rec of recs) {
    const title = rec[rec._titleKey] || "(untitled)";
    const moves = [];
    for (const [myKey, aiKey] of FIELD_PAIRS) {
      const myVal = trimOrEmpty(rec[myKey]);
      const aiVal = trimOrEmpty(rec[aiKey]);
      if (myVal !== "" && aiVal === "") {
        moves.push({ myKey, aiKey, len: myVal.length });
        if (apply) {
          rec[aiKey] = myVal;
          rec[myKey] = "";
        }
      } else if (myVal !== "" && aiVal !== "") {
        totalSkipped++;
      }
    }
    if (moves.length > 0) {
      recordsAffected++;
      totalMoves += moves.length;
      console.log(`  ${title}:`);
      for (const m of moves) {
        console.log(`    ${m.myKey} (${m.len} chars) → ${m.aiKey}`);
      }
    }
  }
}

console.log("");
console.log(`Records affected: ${recordsAffected}`);
console.log(`Total field moves: ${totalMoves}`);
if (totalSkipped > 0) {
  console.log(`Skipped (both sides populated, no move): ${totalSkipped}`);
}

if (apply) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(retro, null, 2));
  console.log("");
  console.log("✓ Wrote retro.json. Next: cd ~/projects/brickomations && yarn push");
} else {
  console.log("");
  console.log("Dry-run only. Re-run with --apply to write retro.json.");
}
