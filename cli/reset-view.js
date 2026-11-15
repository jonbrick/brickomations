#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Reset view: what `/reset-today` settles — the past 7 days through
 * yesterday (rolling, across week boundaries). Prints two numbered lists and
 * writes them to local/reset/<today>.json for the skill to answer.
 *
 *   1. Open tasks — 2026 Tasks rows due in the window, not Done (data/life.json)
 *   2. Planned blocks — `Planned:` events on the main personal calendar in the
 *      window, each with a verdict from data/calendar.json actuals:
 *        done → an actual exists that day (delete the placeholder)
 *        ask  → manual or unrecognized habit, nothing logged
 *        open → auto habit with no actual
 *   3. Events & trips — rows whose last day fell in the window but are still
 *      open (Scheduled, To Book, …) in data/plan.json
 *
 * Read-only against Notion and the calendar. Run after `yarn pull:linear &&
 * yarn pull --auto` so the tasks are current.
 *
 * Usage: yarn reset:view [--today=YYYY-MM-DD]
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const GoogleCalendarService = require("../src/services/GoogleCalendarService");
const { readFileSyncRetry } = require("../src/utils/fs-retry");
const { isPlanned } = require("../src/utils/planned-events");
const {
  todayString,
  resetWindow,
  openTasks,
  plannedBlocks,
  openEntries,
  numberItems,
} = require("../src/workflows/reset-today");

const DATA_DIR = path.join(__dirname, "..", "data");
const RESET_DIR = path.join(__dirname, "..", "local", "reset");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}

function readData(filename) {
  return JSON.parse(readFileSyncRetry(path.join(DATA_DIR, filename), "utf-8"));
}

function dayLabel(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${ymd.slice(5)}`;
}

function timeLabel(start) {
  return String(start).includes("T") ? String(start).slice(11, 16) : "all day";
}

const VERDICT_LABEL = { done: "✓ done", ask: "? ask", open: "✗ not done" };

async function main() {
  const today = argValue("today") || todayString();
  const window = resetWindow(today);

  const life = readData("life.json");
  const plan = readData("plan.json");
  const calendarData = readData("calendar.json");

  const mainCal = process.env.PERSONAL_MAIN_CALENDAR_ID;
  if (!mainCal) throw new Error("Missing env: PERSONAL_MAIN_CALENDAR_ID");
  const svc = new GoogleCalendarService("personal");
  const events = (
    await svc.listEvents(mainCal, new Date(`${window.start}T00:00:00`), new Date(`${window.end}T23:59:59`))
  ).filter((e) => isPlanned(e.summary));

  const { tasks, blocks, entries } = numberItems(
    openTasks(life.tasks, window),
    plannedBlocks(events, calendarData, window),
    openEntries(plan.events, plan.trips, window)
  );

  console.log(`\n🔄 Reset — ${dayLabel(window.start)} → ${dayLabel(window.end)} (today ${dayLabel(today)})`);
  console.log(`   tasks pulled ${life._meta?.pulledAt || "?"}`);

  console.log(`\nOPEN TASKS (${tasks.length})`);
  if (tasks.length === 0) console.log("  none");
  for (const t of tasks) {
    console.log(`  ${String(t.n).padStart(2)}. ${dayLabel(t.due)} · ${t.title} · ${t.source} · ${t.status || "no status"}`);
  }

  console.log(`\nPLANNED BLOCKS (${blocks.length})`);
  if (blocks.length === 0) console.log("  none");
  for (const b of blocks) {
    const proof = b.actual ? ` (${b.actual.summary} ${timeLabel(b.actual.start)})` : "";
    console.log(
      `  ${String(b.n).padStart(2)}. ${dayLabel(b.start.slice(0, 10))} ${timeLabel(b.start)} · ${b.summary} · ${VERDICT_LABEL[b.verdict]}${proof}`
    );
  }

  console.log(`\nEVENTS & TRIPS (${entries.length})`);
  if (entries.length === 0) console.log("  none");
  for (const e of entries) {
    const span = e.dateEnd ? ` → ${dayLabel(e.dateEnd)}` : "";
    console.log(`  ${String(e.n).padStart(2)}. ${dayLabel(e.date)}${span} · ${e.title} · ${e.kind} · ${e.status || "no status"}`);
  }

  fs.mkdirSync(RESET_DIR, { recursive: true });
  const outPath = path.join(RESET_DIR, `${today}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ today, window, generatedAt: new Date().toISOString(), tasks, blocks, entries }, null, 2) + "\n"
  );
  console.log(`\n📝 ${path.relative(process.cwd(), outPath)}\n`);
}

main().catch((err) => {
  console.error("\n❌ reset:view failed:", err.message);
  process.exit(1);
});
