#!/usr/bin/env node
/**
 * render-evening-report.js — fill the daily note's evening ACTUALS from the
 * freshly-synced snapshot. Deterministic, no Notion API, no LLM.
 *
 * Rebuilds (surgically, from scratch) these subsections under ## Evening Report:
 *
 *   ### Tasks            Morning plan vs actual, grouped:
 *                          **Done**          every task done today (planned OR ad-hoc)
 *                          **Not finished**  morning-plan tasks still due today, not done
 *                          **Moved**         morning-plan tasks no longer on today
 *                                            (rescheduled, unscheduled, or deleted)
 *                        Replaces the old Done-only ### Completed Tasks (renamed in place).
 *
 *   ### Completed Events  Notion 2026 Events that occurred (unchanged behaviour).
 *
 *   ### Calendar          What actually happened, straight from calendar.json:
 *                          **Work**            workCalendar timed blocks
 *                          **Everything else** personalCalendar + workout + cooking
 *                        Times + titles (emoji-stripped). Video games & data-only
 *                        calendars (weight, BP, sleep, PRs) are excluded by design.
 *                        Inserted right after ### Completed Events on notes that
 *                        predate the section.
 *
 * The morning plan is read from data/briefs/<date>.json (written 6 AM). Tasks join
 * the plan to the evening life.json by Notion ID when the snapshot carries one, else
 * by normalized title (rename-safe once the ID lands).
 *
 * NOT built here — these need an LLM/Cowork step and land as a fast-follow:
 *   - the top ### Recap (plan-vs-actual narrative)
 *   - the ### Training & Meals actual
 *   - folding SHORT meeting gists into the Work list (### Work Meetings stays its
 *     own detailed section until the processor emits short gists)
 *
 * Scheduling (com.brickbot.evening-render): fires 21:15, AFTER the 9 PM yarn sync
 * refreshes the JSON and the evening-processor writes meeting recaps, BEFORE the
 * 9:20 PM evening text reads the note.
 *
 * Usage:
 *   node scripts/render-evening-report.js [--date YYYY-MM-DD] [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const VAULT_DIR = path.join(os.homedir(), "projects", "brickocampus");
const DATA_DIR = path.join(os.homedir(), "projects", "brickomations", "data");

// Event statuses that mean "did not occur" — dropped from Completed Events.
const EVENT_DROP_STATUSES = new Set(["Won't Do", "N/A"]);

// The evening ### Calendar > "Everything else" set. Work is workCalendar (its own
// group). Everything else is the personal main cal plus the two activity calendars
// Jon wants surfaced. All other calendars (video games, sleep, weight, BP, PRs,
// other hobbies) are intentionally excluded — see the design in task #1.
const WORK_CAL = "workCalendar";
const EVERYTHING_ELSE_CALS = ["personalCalendar", "workout", "cooking"];

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

/** Today's date in ET, as YYYY-MM-DD. */
function todayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Strip a leading emoji + whitespace (e.g. "🟢 Done" → "Done", "💪 Workout" → "Workout"). */
function stripEmoji(str) {
  if (!str) return "";
  return String(str).replace(/^[^\x00-\x7F]+\s*/, "").trim();
}

/** Normalize a title for cross-snapshot matching (trim, collapse WS, lowercase). */
function normTitle(str) {
  return String(str || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function readJson(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) {
    throw new Error(`Required data file missing: ${p}. Run \`yarn sync\` first.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Read a JSON file, returning null if it's absent (the morning brief may not exist). */
function readJsonOptional(relPath) {
  const p = path.join(DATA_DIR, relPath);
  if (!fs.existsSync(p)) return null;
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

// ---- calendar helpers -----------------------------------------------------

/** "2026-08-03T09:00:00-04:00" → "09:00"; all-day ("2026-08-03") → null. */
function hhmm(start) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start || "") ? start.slice(11, 16) : null;
}
function isTimed(start) {
  return hhmm(start) !== null;
}
/** True if Jon's own RSVP on this event is "declined" — a meeting he opted out of. */
function selfDeclined(e) {
  return (e.attendees || []).some((a) => a && a.self && a.response === "declined");
}
/** Display title: drop a leading "Planned:" plan-marker, then a leading emoji. */
function cleanTitle(summary) {
  return stripEmoji(String(summary || "").replace(/^\s*planned:\s*/i, "")).trim();
}
/** "Do Not Schedule" / personal-day blocker markers — not real happenings. */
function isBlockerNoise(e) {
  return /^DNS\b/i.test(cleanTitle(e.summary));
}

// ---- task classification (morning plan vs evening actual) -----------------

/** "🌱 Personal" + "📝 Admin" → "Personal / Admin"; work uses WORK Category. */
function lifeTaskCategory(t) {
  const cat = stripEmoji(t.Category);
  const sub =
    cat === "Personal" ? stripEmoji(t["PERSONAL Category"]) :
    cat === "Work" ? stripEmoji(t["WORK Category"]) : "";
  return sub ? `${cat} / ${sub}` : cat;
}
function planTaskCategory(p) {
  const cat = p.category || "";
  const sub = cat === "Personal" ? p.personal_category : cat === "Work" ? p.work_category : "";
  return sub ? `${cat} / ${sub}` : cat;
}
function lifeTaskLine(t) {
  const cat = lifeTaskCategory(t);
  const title = (t.Task || "").trim();
  return cat ? `- ${title} (${cat})` : `- ${title}`;
}
function planTaskLine(p) {
  const cat = planTaskCategory(p);
  const title = (p.title || "").trim();
  return cat ? `- ${title} (${cat})` : `- ${title}`;
}

/**
 * Classify the morning plan against the evening life.json state.
 * Returns { done, notFinished, moved } as arrays of rendered bullet lines.
 */
function classifyTasks(brief, life, date) {
  const tasks = life.tasks || [];
  const plan = (brief && brief.tasks) || [];

  const done = [];
  const notFinished = [];
  const moved = [];
  const matchedIds = new Set();

  for (const p of plan) {
    // Prefer a Notion-ID join (robust to same-day renames); fall back to title.
    let lt = null;
    if (p._notionId) lt = tasks.find((t) => t._notionId === p._notionId);
    if (!lt) lt = tasks.find((t) => normTitle(t.Task) === normTitle(p.title));

    if (!lt) {
      // Vanished from the sync entirely → deleted/archived → treat as moved.
      moved.push(planTaskLine(p));
      continue;
    }
    if (lt._notionId) matchedIds.add(lt._notionId);

    const status = stripEmoji(lt.Status);
    if (status === "Done") done.push(lifeTaskLine(lt));
    else if (lt["Due Date"] === date) notFinished.push(lifeTaskLine(lt));
    else moved.push(lifeTaskLine(lt)); // rescheduled off today
  }

  // Ad-hoc wins: anything done today that wasn't in the morning plan → Done.
  for (const t of tasks) {
    if (t["Due Date"] !== date) continue;
    if (stripEmoji(t.Status) !== "Done") continue;
    if (t._notionId && matchedIds.has(t._notionId)) continue;
    done.push(lifeTaskLine(t));
  }

  return { done, notFinished, moved };
}

// ---- section bodies -------------------------------------------------------

function buildTasksBody({ done, notFinished, moved }) {
  const groups = [
    ["Done", done],
    ["Not finished", notFinished],
    ["Moved", moved],
  ];
  const out = [];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    if (out.length) out.push("");
    out.push(`**${label}**`, ...items);
  }
  return out.length ? out : ["_no tasks_"];
}

// Today's events that occurred (anything except Won't Do / N/A) → `- <name>`.
function completedEventLines(plan, date) {
  const lines = (plan.events || [])
    .filter((e) => e.Date === date && !EVENT_DROP_STATUSES.has(stripEmoji(e.Status)))
    .map((e) => `- ${(e["Event Name"] || "").trim()}`);
  return lines.length ? lines : ["_no events_"];
}

function calBlockLine(e) {
  return `- ${hhmm(e.start)} — ${cleanTitle(e.summary)}`;
}

function buildCalendarBody(calendar, date) {
  const keep = (e) =>
    isTimed(e.start) && String(e.start).startsWith(date) && !isBlockerNoise(e);
  const byStart = (a, b) => a.start.localeCompare(b.start);

  const work = (calendar[WORK_CAL] || [])
    .filter((e) => keep(e) && !selfDeclined(e))
    .sort(byStart);

  const elseEvents = EVERYTHING_ELSE_CALS
    .flatMap((c) => (calendar[c] || []).filter(keep))
    .sort(byStart);

  const out = [];
  if (work.length) out.push("**Work**", ...work.map(calBlockLine));
  if (elseEvents.length) {
    if (out.length) out.push("");
    out.push("**Everything else**", ...elseEvents.map(calBlockLine));
  }
  return out.length ? out : ["_nothing on the calendar_"];
}

// ---- surgical section rewrite ---------------------------------------------

// Replace the body under `### <heading>` (up to the next ### / ## / --- / EOF)
// with newLines + one trailing blank. Returns { lines, found }.
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

// Rename the tasks heading to `### Tasks` (from either name) and replace its body.
// Handles today's notes (### Completed Tasks) and future ones (### Tasks) alike.
function upsertTasks(lines, newLines) {
  const idx = lines.findIndex(
    (l) => l.trim() === "### Tasks" || l.trim() === "### Completed Tasks"
  );
  if (idx === -1) return { lines, found: false };
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^###\s/.test(lines[i]) || /^##\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const rebuilt = [...lines.slice(0, idx), "### Tasks", ...newLines, "", ...lines.slice(end)];
  return { lines: rebuilt, found: true };
}

// Insert-or-replace a `### <heading>` section. If present, replace its body; else
// insert a fresh section immediately after the `### <afterHeading>` block.
function upsertSection(lines, heading, newLines, afterHeading) {
  if (lines.some((l) => l.trim() === `### ${heading}`)) {
    return replaceSubsection(lines, heading, newLines);
  }
  const aIdx = lines.findIndex((l) => l.trim() === `### ${afterHeading}`);
  if (aIdx === -1) return { lines, found: false };
  let end = lines.length;
  for (let i = aIdx + 1; i < lines.length; i++) {
    if (/^###\s/.test(lines[i]) || /^##\s/.test(lines[i]) || /^---\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, end);
  if (before.length && before[before.length - 1].trim() !== "") before.push("");
  const block = [`### ${heading}`, ...newLines, ""];
  return { lines: [...before, ...block, ...lines.slice(end)], found: true };
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
  const calendar = readJson("calendar.json");
  const brief = readJsonOptional(path.join("briefs", `${date}.json`));

  const tasksBody = buildTasksBody(classifyTasks(brief, life, date));
  const eventsBody = completedEventLines(plan, date);
  const calBody = buildCalendarBody(calendar, date);

  const notePath = resolveNote(date);
  let lines = fs.readFileSync(notePath, "utf8").split("\n");

  const rTasks = upsertTasks(lines, tasksBody);
  const rEvents = replaceSubsection(rTasks.lines, "Completed Events", eventsBody);
  const rCal = upsertSection(rEvents.lines, "Calendar", calBody, "Completed Events");
  lines = rCal.lines;

  const missing = [];
  if (!rTasks.found) missing.push("### Tasks / ### Completed Tasks");
  if (!rEvents.found) missing.push("### Completed Events");
  if (!rCal.found) missing.push("### Calendar (anchor ### Completed Events)");

  if (args.dryRun) {
    console.log(`[dry-run] ${date} · note: ${notePath}`);
    if (!brief) console.log(`[dry-run] no morning brief for ${date} — tasks limited to done-today`);
    if (missing.length) console.log(`[dry-run] MISSING (would skip): ${missing.join(", ")}`);
    console.log(
      `\n### Tasks\n${tasksBody.join("\n")}\n\n### Completed Events\n${eventsBody.join("\n")}\n\n### Calendar\n${calBody.join("\n")}`
    );
    return;
  }

  if (missing.length) {
    console.error(`[render-evening-report] ${date}: missing ${missing.join(", ")} — not a new-template note; skipping those.`);
  }
  fs.writeFileSync(notePath, lines.join("\n"));
  const n = (a) => (a === 1 ? "" : "s");
  const c = classifyTasks(brief, life, date);
  console.log(
    `[render-evening-report] ${date}: tasks ${c.done.length} done / ${c.notFinished.length} not finished / ${c.moved.length} moved, ` +
    `${eventsBody[0] === "_no events_" ? 0 : eventsBody.length} event${n(eventsBody.length)}, calendar written.`
  );
}

main();
