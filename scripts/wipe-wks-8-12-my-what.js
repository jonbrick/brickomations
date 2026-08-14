// One-shot: clear `My What went well?` / `My What did not go so well?` /
// `My What did I learn?` on Wks 8-12 both retro DBs.
//
// After the rollback of migrate-retro-ai-fields, Wks 8-12 ended up with
// AI-voice content sitting in their My What X columns (AI's voice, mis-
// attributed). Wiping these gives a clean canvas: backfill regenerates the
// AI side under the new bias-free rules, then Jon writes his own My side
// going forward in an AI → Me cadence.
//
// Wks 1-7 My What X is genuinely Jon-authored — leave alone.
// My Retro untouched (already empty for Wks 8-12).
// AI Retro untouched (backfill will overwrite its verbose paragraphs).
//
// Also clears _hash on affected records so push sees them as changed.
//
// Usage:
//   node scripts/wipe-wks-8-12-my-what.js           # dry-run
//   node scripts/wipe-wks-8-12-my-what.js --apply   # writes retro.json

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "retro.json");
const apply = process.argv.includes("--apply");

const WIPE_WEEKS = new Set(["08", "09", "10", "11", "12"]);
const FIELDS = [
  "My What went well?",
  "My What did not go so well?",
  "My What did I learn?",
];

const retro = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

let totalClears = 0;
let recordsAffected = 0;

for (const kind of ["personalWeekly", "workWeekly"]) {
  for (const rec of retro[kind] || []) {
    const title = rec[rec._titleKey] || "";
    const m = title.match(/Week (\d{2})/);
    if (!m || !WIPE_WEEKS.has(m[1])) continue;

    const clears = [];
    for (const f of FIELDS) {
      const v = typeof rec[f] === "string" ? rec[f].trim() : "";
      if (v !== "") {
        clears.push({ f, len: v.length });
        if (apply) rec[f] = "";
      }
    }
    if (clears.length > 0) {
      recordsAffected++;
      totalClears += clears.length;
      if (apply) delete rec._hash; // force push to see the change
      console.log(`  ${title}:`);
      for (const c of clears) {
        console.log(`    ${c.f} (${c.len} chars) → cleared`);
      }
    }
  }
}

console.log("");
console.log(`Records affected: ${recordsAffected}`);
console.log(`Total field clears: ${totalClears}`);

if (apply) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(retro, null, 2));
  console.log("");
  console.log("✓ Wrote retro.json. Next: cd ~/projects/brickomations && yarn push");
} else {
  console.log("");
  console.log("Dry-run only. Re-run with --apply.");
}
