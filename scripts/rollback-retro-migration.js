// One-shot rollback for migrate-retro-ai-fields.js.
//
// The original migration moved every record's My What X → AI What X
// indiscriminately, assuming the bare-name columns held AI-authored bullets.
// Wks 1-7 turned out to hold Jon-authored bullets in his voice — so the
// migration mis-attributed his content as AI's. Rather than partially undo, we
// revert ALL 24 records back to My, then backfill from Wk 1 will overwrite
// AI What X with fresh bias-free output under the new rules.
//
// Logic: for each record's 3 What-field pairs:
//   If AI X non-empty AND My X empty → move AI X → My X.
//
// Safe to re-run — already-reverted records are no-ops.
//
// Usage:
//   node scripts/rollback-retro-migration.js           # dry-run
//   node scripts/rollback-retro-migration.js --apply   # writes retro.json

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
let recordsAffected = 0;

for (const kind of ["personalWeekly", "workWeekly"]) {
  for (const rec of retro[kind] || []) {
    const title = rec[rec._titleKey] || "(untitled)";
    const moves = [];
    for (const [myKey, aiKey] of FIELD_PAIRS) {
      const myVal = trimOrEmpty(rec[myKey]);
      const aiVal = trimOrEmpty(rec[aiKey]);
      if (aiVal !== "" && myVal === "") {
        moves.push({ aiKey, myKey, len: aiVal.length });
        if (apply) {
          rec[myKey] = aiVal;
          rec[aiKey] = "";
        }
      }
    }
    if (moves.length > 0) {
      recordsAffected++;
      totalMoves += moves.length;
      console.log(`  ${title}:`);
      for (const m of moves) {
        console.log(`    ${m.aiKey} (${m.len} chars) → ${m.myKey}`);
      }
    }
  }
}

console.log("");
console.log(`Records affected: ${recordsAffected}`);
console.log(`Total field moves: ${totalMoves}`);

if (apply) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(retro, null, 2));
  console.log("");
  console.log("✓ Wrote retro.json. Next: cd ~/projects/brickomations && yarn push");
} else {
  console.log("");
  console.log("Dry-run only. Re-run with --apply.");
}
