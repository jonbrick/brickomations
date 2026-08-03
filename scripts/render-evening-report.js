#!/usr/bin/env node
/**
 * render-evening-report.js — fill the daily note's `### Completed Tasks` and
 * `### Completed Events` (under `## Evening Report`) from the freshly-synced
 * Notion snapshot. The ACTUAL half of the plan→actual daily note.
 *
 * Deterministic, no Notion API: reads the local JSON that `yarn sync`'s `pull`
 * step refreshes (data/life.json tasks, data/plan.json events), filters today's
 * actuals, and surgically rebuilds ONLY those two subsections — rebuild-from-
 * scratch, same pattern as the evening-processor's meeting recaps. Every other
 * section (meetings, /log-day capture, the Morning Brief) is left untouched.
 *
 *   Completed Tasks  = today's tasks with Status = Done
 *   Completed Events = today's events with Status ≠ Won't Do / N/A (the "occurred" set)
 *
 * Scheduling (com.brickbot.evening-render): fires 21:15, i.e. AFTER the 9 PM
 * `yarn sync` refreshes the JSON and after the 9 PM evening-processor writes the
 * meeting recaps, and BEFORE the 9:20 PM evening text reads the note. v1 assumes
 * those upstream jobs have finished by 21:15 (they normally run in a few minutes);
 * if a race ever drops a night's Completed sections, move this later or gate on
 * the sync's heartbeat — iterate then, don't pre-engineer.
 *
 * Usage:
 *   node scripts/render-evening-report.js [--date YYYY-MM-DD] [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const VAULT_DIR = path.join(os.homedir(), "projects", "brickocampus");
const DATA_DIR = path.join(os.homedir(), "projects", "brickbot", "data");

// Event statuses that mean "did not occur" — dropped from Completed Events.
const EVENT_DROP_STATUSES = new Set(["Won't Do", "N/A"]);

// ---- args -----------------------------------------------------------------

function parseArgs(argv) {
  const args = { date: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--date") args.date = argv[++i];
    else if (a.startsWith("--date=")) args.date = a.slice("--date=".length);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/** Today's date in ET, as YYYY-MM-DD (matches daily-brief.js). */
function todayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Strip leading emoji + whitespace (e.g. "🟢 Done" → "Done"). */
function stripEmoji(str) {
  if (!str) return "";
  return String(str).replace(/^[^\x00-\x7F]+\s*/, "").trim();
}

function readJson(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) {
    throw new Error(`Required data file missing: ${p}. Run \`yarn sync\` first.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Find the daily note for a YYYY-MM-DD date (filename carries the weekday).
function resolveNote(dateISO) {
  const year = dateISO.slice(0, 4);
  const yearMonth = dateISO.slice(0, 7);
  const dir = path.join(VAULT_DIR, "_daily", year, yearMonth);
  if (!fs.existsSync(dir)) throw new Error(`Daily-note folder not found: ${dir}`);
  const match = fs.readdirSync(dir).find((f) => f.startsWith(`${dateISO} `) && f.endsWith(".md"));
  if (!match) throw new Error(`No daily note found for ${dateISO} in ${dir}`);
  return path.join(dir, match);
}

// ---- actuals from the synced snapshot -------------------------------------

// Today's Done tasks → `- <title> (<category>)`.
function completedTaskLines(life, date) {
  return (life.tasks || [])
    .filter((t) => t["Due Date"] === date && stripEmoji(t.Status) === "Done")
    .map((t) => {
      const title = (t.Task || "").trim();
      const cat = stripEmoji(t.Category);
      return cat ? `- ${title} (${cat})` : `- ${title}`;
    });
}

// Today's events that occurred (anything except Won't Do / N/A) → `- <name>`.
function completedEventLines(plan, date) {
  return (plan.events || [])
    .filter((e) => e.Date === date && !EVENT_DROP_STATUSES.has(stripEmoji(e.Status)))
    .map((e) => `- ${(e["Event Name"] || "").trim()}`);
}

// ---- surgical subsection rewrite ------------------------------------------

// Replace the body under `### <heading>` (up to the next ### / ## / --- / EOF)
// with newLines, followed by one blank line. Returns { lines, found }.
function replaceSubsection(lines, heading, newLines) {
  const idx = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (idx === -1) return { lines, found: false };
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^###\s/.test(lines[i]) || /^##\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const rebuilt = [...lines.slice(0, idx + 1), ...newLines, "", ...lines.slice(end)];
  return { lines: rebuilt, found: true };
}

// ---- main -----------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date || todayET();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`invalid date arg: '${date}' (expected YYYY-MM-DD)`);
  }

  const life = readJson("life.json");
  const plan = readJson("plan.json");

  const tasks = completedTaskLines(life, date);
  const events = completedEventLines(plan, date);
  const taskBody = tasks.length ? tasks : ["_no tasks completed_"];
  const eventBody = events.length ? events : ["_no events_"];

  const notePath = resolveNote(date);
  let lines = fs.readFileSync(notePath, "utf8").split("\n");

  const r1 = replaceSubsection(lines, "Completed Tasks", taskBody);
  const r2 = replaceSubsection(r1.lines, "Completed Events", eventBody);
  lines = r2.lines;

  const missing = [];
  if (!r1.found) missing.push("### Completed Tasks");
  if (!r2.found) missing.push("### Completed Events");

  if (args.dryRun) {
    console.log(`[dry-run] ${date} · note: ${notePath}`);
    if (missing.length) console.log(`[dry-run] MISSING headings (would skip): ${missing.join(", ")}`);
    console.log(`\n### Completed Tasks\n${taskBody.join("\n")}\n\n### Completed Events\n${eventBody.join("\n")}`);
    return;
  }

  if (missing.length) {
    // Note predates the new template (no Completed headings). Don't fabricate a
    // zone — that's the evening-processor's legacy-fallback territory. Just skip.
    console.error(`[render-evening-report] ${date}: missing ${missing.join(", ")} — not a new-template note; skipping those.`);
  }
  fs.writeFileSync(notePath, lines.join("\n"));
  console.log(`[render-evening-report] ${date}: ${tasks.length} completed task(s), ${events.length} event(s) written.`);
}

main();
