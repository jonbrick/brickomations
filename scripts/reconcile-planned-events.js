#!/usr/bin/env node
/**
 * Reconcile `/plan-week`'s `Planned:` placeholder events at retro time.
 *
 * `/plan-week` scatters `Planned:` events across the main personal calendar as
 * the week's plan (workouts, cooks, meals, early wake-ups, other habit days).
 * They're placeholders — the *actuals* live on the dedicated habit calendars
 * (Workout via Strava, Sleep via Oura, Cooking hand-logged, etc.). At retro,
 * `/retro-week` walks plan-vs-actual and this script does the calendar cleanup
 * so Jon never deletes placeholders by hand.
 *
 * TWO STEPS — audit, then delete:
 *
 *   1. AUDIT (--pull) — dump the week's `Planned:` events (with real event IDs)
 *      to local JSON, print a per-event verdict, AND write a ready-to-apply
 *      manifest. Read-only against the calendar. Auto habits resolve to delete;
 *      manual habits (cooking, reading, …) come back "review" for `/retro-week`
 *      to resolve from the habits walk.
 *
 *        node scripts/reconcile-planned-events.js --pull <week> [--out <path>]
 *
 *      Writes: local/calendar/planned-<week>.json          (audit dump)
 *              local/calendar/planned-actions-<week>.json  (manifest)
 *
 *   2. DELETE (--apply) — execute the manifest. Any item still marked "review"
 *      is skipped, so an unresolved verdict never gets deleted.
 *
 *        node scripts/reconcile-planned-events.js --apply <manifest> [--dry-run]
 *
 *      Manifest = JSON array of:
 *        { "id": "...", "summary": "...", "action": "delete" }
 *        { "id": "...", "summary": "...", "action": "move",
 *          "targetKey": "cooking", "newSummary": "Roast chicken" }
 *        { "id": "...", "summary": "...", "action": "relabel",
 *          "newSummary": "Dinner — Lucali" }
 *
 * SAFETY:
 *   - Never touches anything but the MAIN personal calendar as the source.
 *   - Before every mutate it re-fetches the event and refuses to act unless the
 *     live summary still starts with "Planned:" — a wrong/stale id can't nuke a
 *     real event.
 *   - Any manifest item still marked "review" is skipped, never deleted.
 *   - Google Calendar deletes go to its trash (recoverable ~30 days).
 *   - --dry-run remains an optional preview (writes nothing); the --pull audit
 *     is the default preview.
 *
 * Run on the mini (PERSONAL_GOOGLE_REFRESH_TOKEN must be set).
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const GoogleCalendarService = require("../src/services/GoogleCalendarService");

const {
  classify,
  eventStart,
  isPlanned,
  stripPlanned,
} = require("../src/utils/planned-events");
const { applyPlannedAction } = require("../src/workflows/planned-event-actions");

const MAIN_CAL = process.env.PERSONAL_MAIN_CALENDAR_ID;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** What this tool is doing — printed on every run so the output is self-explanatory. */
function printDisclaimer() {
  console.log(
    "\nℹ️  Planned-event cleanup — clearing /plan-week's \"Planned:\" placeholders.\n" +
    "   The main personal calendar holds the week's plan as \"Planned:\" events; the\n" +
    "   actuals live on the dedicated habit calendars. At retro these placeholders go:\n" +
    "     • workouts, wake-ups, games, coding         → DELETE (auto-captured elsewhere)\n" +
    "     • cooking, reading, music, art, meditation  → MOVE to its habit calendar if it\n" +
    "                                                    happened, else DELETE\n" +
    "     • a meal at a place                         → RELABEL in place (drop \"Planned:\")\n" +
    "   Deletes land in Google Calendar trash (recoverable ~30 days). Only events whose\n" +
    "   title still starts with \"Planned:\" are ever touched."
  );
}

function loadWeekRange(week) {
  const plan = require(path.join(__dirname, "..", "data", "plan.json"));
  const title = `Week ${String(week).padStart(2, "0")}`;
  const rec = (plan.weeks || []).find((w) => w.Week === title);
  if (!rec) throw new Error(`week not found in plan.json: "${title}"`);
  const start = rec["Date Range (SET)"];
  const end = rec["Date Range (SET) End"];
  if (!start || !end) throw new Error(`week "${title}" missing Date Range (SET) / End`);
  return { title, start, end };
}

async function doPull(svc, week) {
  printDisclaimer();
  const { title, start, end } = loadWeekRange(week);
  const timeMin = new Date(`${start}T00:00:00`);
  const timeMax = new Date(`${end}T23:59:59`);

  const all = await svc.listEvents(MAIN_CAL, timeMin, timeMax);
  const planned = all
    .filter((e) => isPlanned(e.summary))
    .map((e) => {
      const cls = classify(e.summary);
      return {
        id: e.id,
        summary: e.summary,
        start: eventStart(e),
        end: e.end && (e.end.dateTime || e.end.date),
        description: e.description || "",
        ...cls,
        strippedTitle: stripPlanned(e.summary),
        // `/retro-week` fills the final action from the habits walk. This is the
        // safe default: auto habits delete, everything else needs a verdict.
        suggestedAction: cls.auto ? "delete" : "review",
      };
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  const outPath = path.resolve(argValue("--out") || `local/calendar/planned-${week}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ week: title, range: { start, end }, events: planned }, null, 2) + "\n");

  // Ready-to-apply manifest. Auto habits resolve to "delete"; manual habits stay
  // "review" (carrying targetKey + a suggested newSummary) so /retro-week only
  // flips them to move/delete from the habits walk. --apply skips any "review".
  const manifest = planned.map((p) => {
    const item = { id: p.id, summary: p.summary, action: p.suggestedAction };
    if (p.suggestedAction === "review") {
      if (p.targetKey) item.targetKey = p.targetKey;
      item.newSummary = p.strippedTitle;
    }
    return item;
  });
  const manifestPath = path.resolve(`local/calendar/planned-actions-${week}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const reviews = manifest.filter((m) => m.action === "review").length;
  console.log(`\n📋 Audit — ${planned.length} Planned event(s) for ${title} (${start} → ${end}):\n`);
  for (const p of planned) {
    const verdict = p.suggestedAction === "delete"
      ? "DELETE"
      : `REVIEW  (→ move to ${p.targetKey || "?"} cal if it happened, else delete)`;
    console.log(`  ${String(p.start).slice(0, 16)}  ${p.summary}  →  ${verdict}`);
  }
  console.log(`\n📝 Audit     ${outPath}`);
  console.log(`📝 Manifest  ${manifestPath}`);
  if (reviews > 0) {
    console.log(`\n⚠️  ${reviews} event(s) need a REVIEW verdict — /retro-week resolves these from the habits walk before --apply.`);
  }
  console.log("");
}

async function doApply(svc, manifestPath) {
  printDisclaimer();
  const raw = fs.readFileSync(path.resolve(manifestPath), "utf-8");
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest)) throw new Error("manifest must be a JSON array");

  console.log(`\n🧹 Reconciling ${manifest.length} Planned event(s)${DRY_RUN ? " (dry run)" : ""}\n`);

  let deleted = 0, moved = 0, relabeled = 0, skipped = 0;

  for (const item of manifest) {
    const { result, message } = await applyPlannedAction(svc, MAIN_CAL, item, { dryRun: DRY_RUN });
    if (result === "skipped") {
      console.log(`  ⏭️  SKIP ${message}`);
      skipped++;
      continue;
    }
    console.log(`  ${DRY_RUN ? "🔸" : "✅"} ${message}`);
    if (result === "deleted") deleted++;
    else if (result === "moved") moved++;
    else if (result === "relabeled") relabeled++;
  }

  console.log(
    `\n📊 ${deleted} deleted · ${moved} moved · ${relabeled} relabeled · ${skipped} skipped${DRY_RUN ? " — dry run, no writes" : ""}\n`
  );
}

async function main() {
  if (!MAIN_CAL) {
    console.error("❌ Missing env: PERSONAL_MAIN_CALENDAR_ID");
    process.exit(1);
  }

  const svc = new GoogleCalendarService("personal");

  if (args.includes("--pull")) {
    const week = Number.parseInt(argValue("--pull"), 10);
    if (!Number.isInteger(week) || week < 1 || week > 53) {
      console.error(`❌ --pull needs a week 1..53 (got ${JSON.stringify(argValue("--pull"))})`);
      process.exit(1);
    }
    await doPull(svc, week);
  } else if (args.includes("--apply")) {
    const manifest = argValue("--apply");
    if (!manifest) { console.error("❌ --apply needs a manifest path"); process.exit(1); }
    await doApply(svc, manifest);
  } else {
    console.error(
      "usage:\n" +
      "  node scripts/reconcile-planned-events.js --pull <week> [--out <path>]\n" +
      "  node scripts/reconcile-planned-events.js --apply <manifest> [--dry-run]"
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌ reconcile-planned-events failed:", err.message);
  process.exit(1);
});
