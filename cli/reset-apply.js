#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Reset apply: carry out the answers `/reset-today` wrote into
 * local/reset/<today>.json (produced by `yarn reset:view`).
 *
 *   Tasks  → data/life.json only (Due Date / Status on Notion-native rows).
 *            Notion is updated by the push that follows:
 *              yarn push --auto --only=tasks
 *            Linear-born rows are skipped and listed — they move in Linear.
 *   Blocks → the main personal calendar directly (delete / move to a habit
 *            calendar / reschedule), each re-checked as a live `Planned:`
 *            event first.
 *
 * Item answers:
 *   task:  { "action": "done" }  |  { "action": "date", "date": "YYYY-MM-DD" }
 *   block: { "action": "delete" }
 *          { "action": "move", "targetKey": "cooking", "newSummary": "Roast chicken" }
 *          { "action": "reschedule", "newStart": "<ISO>", "newEnd": "<ISO>" }
 * Items without an action are left alone. Applied items are stamped
 * `applied`, so a re-run never repeats them.
 *
 * Usage: yarn reset:apply [--dry-run] [--today=YYYY-MM-DD]
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const GoogleCalendarService = require("../src/services/GoogleCalendarService");
const { readFileSyncRetry, writeFileSyncRetry } = require("../src/utils/fs-retry");
const { applyPlannedAction } = require("../src/workflows/planned-event-actions");
const { todayString, applyTaskAnswers } = require("../src/workflows/reset-today");

const LIFE_PATH = path.join(__dirname, "..", "data", "life.json");
const RESET_DIR = path.join(__dirname, "..", "local", "reset");
const dryRun = process.argv.includes("--dry-run");

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}

async function main() {
  const today = argValue("today") || todayString();
  const resetPath = path.join(RESET_DIR, `${today}.json`);
  if (!fs.existsSync(resetPath)) throw new Error(`${resetPath} not found — run yarn reset:view first`);
  const reset = JSON.parse(fs.readFileSync(resetPath, "utf-8"));
  const stamp = new Date().toISOString();

  console.log(`\n🔄 Reset apply — ${today}${dryRun ? " (dry run, nothing written)" : ""}`);

  // Tasks → data/life.json
  const life = JSON.parse(readFileSyncRetry(LIFE_PATH, "utf-8"));
  const { changes, skipped } = applyTaskAnswers(life.tasks, reset.tasks);

  console.log(`\nTASKS → data/life.json (${changes.length})`);
  for (const c of changes) console.log(`  ${String(c.n).padStart(2)}. ${c.title} · ${c.field} ${c.from} → ${c.to}`);
  for (const s of skipped) console.log(`  ${String(s.n).padStart(2)}. ⏭️  ${s.title} — ${s.reason}`);

  if (!dryRun && changes.length > 0) {
    writeFileSyncRetry(LIFE_PATH, JSON.stringify(life, null, 2));
    const done = new Set(changes.map((c) => c.n));
    for (const t of reset.tasks) if (done.has(t.n)) t.applied = stamp;
  }

  // Blocks → main personal calendar
  const answered = (reset.blocks || []).filter((b) => b.action && !b.applied);
  console.log(`\nPLANNED BLOCKS → calendar (${answered.length})`);
  if (answered.length > 0) {
    const mainCal = process.env.PERSONAL_MAIN_CALENDAR_ID;
    if (!mainCal) throw new Error("Missing env: PERSONAL_MAIN_CALENDAR_ID");
    const svc = new GoogleCalendarService("personal");
    for (const b of answered) {
      const { result, message } = await applyPlannedAction(svc, mainCal, b, { dryRun });
      console.log(`  ${String(b.n).padStart(2)}. ${result === "skipped" ? "⏭️  SKIP " : ""}${message}`);
      if (!dryRun && result !== "skipped") b.applied = stamp;
    }
  }

  if (!dryRun) fs.writeFileSync(resetPath, JSON.stringify(reset, null, 2) + "\n");

  if (changes.length > 0) {
    console.log(
      dryRun
        ? "\nNext: yarn reset:apply (for real), then yarn push --auto --only=tasks --dry-run\n"
        : "\nNext: yarn push --auto --only=tasks --dry-run, then without --dry-run\n"
    );
  } else {
    console.log("");
  }
}

main().catch((err) => {
  console.error("\n❌ reset:apply failed:", err.message);
  process.exit(1);
});
