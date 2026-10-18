#!/usr/bin/env node

/**
 * Daily Brief CLI
 *
 * Pre-stages today's daily-note inputs as JSON for Cowork's morning-brief.
 * Filters data/*.json for today's tasks, events, and calendar blocks, plus
 * (2026-10-18) the week's Big Rocks and each task's carry history.
 *
 * Writes data/briefs/<YYYY-MM-DD>.json (the briefs/ folder accumulates
 * indefinitely — historical record for retros and debugging, and the source
 * of the carry history below).
 *
 * Designed to run at 5:50 AM via dedicated launchd plist
 * (com.brickomations.daily-brief), separate from `yarn sync`. No API calls —
 * reads existing data/*.json (refreshed by the 11 PM yarn sync the night
 * before). ~5 second runtime, plenty of headroom before the 6 AM Cowork
 * morning-brief task that consumes the brief.
 *
 * Carry history: each task carries `planned_days` (the prior mornings, inside a
 * 14-day window, whose brief already listed it), `push_count` (their count),
 * `morning_number` (push_count + 1 — "back for a fifth morning"),
 * `first_planned` and `first_priority` (the priority the task had on that first
 * morning — Jon clears priority on completion, so the morning snapshots are the
 * only place it survives). Counts DISTINCT mornings, not consecutive days. Note
 * a manual back-fill (`yarn daily-brief <past date>`) regenerates that day's
 * brief from CURRENT data and so rewrites history for that day.
 *
 * Usage:
 *   yarn daily-brief             # Generate today's brief (ET)
 *   yarn daily-brief 2026-05-30  # Generate for a specific date (manual back-fill / dry-run)
 *
 * @layer 3 - Aggregated (multi-source → single-day output)
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const BRIEFS_DIR = path.join(DATA_DIR, "briefs");
const HEARTBEAT_SCRIPT = path.join(REPO_ROOT, "scripts", "heartbeat-ping.sh");
const JOB_NAME = "brickomations-daily-brief";

// Prior mornings scanned for carry history. Two weeks covers a task that slid
// across a weekend and a holiday without turning every stale ticket into a saga.
const CARRY_WINDOW_DAYS = 14;

// Notion relation property names (property names, not database IDs).
const WEEK_ROCKS_PROP = "🪨 2026 Rocks"; // on a 2026 Weeks record → rock IDs
const TASK_ROCKS_PROP = "🪨 2026 Rocks"; // on a 2026 Tasks record → rock IDs

// --- Date handling ---

/** Today's date in ET, as YYYY-MM-DD. */
function todayET() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

/** YYYY-MM-DD shifted by `days` (noon UTC anchor sidesteps DST edges). */
function shiftDate(dateISO, days) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- Helpers ---

/** Strip leading emoji + whitespace from a value (e.g., "🔴 To Do" → "To Do"). */
function stripEmoji(str) {
  if (!str) return "";
  return String(str)
    .replace(/^[^\x00-\x7F]+\s*/, "")
    .trim();
}

function normTitle(str) {
  return String(str || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Read and parse a JSON data file; throw if missing. */
function readJsonOrFail(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Required data file missing: ${p}. Run \`yarn pull\` to refresh.`
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// --- Section builders ---

/** Today's Notion tasks (Due Date matches). */
function getTasks(life, date, rockById = new Map()) {
  return (life.tasks || [])
    .filter((t) => t["Due Date"] === date)
    .map((t) => ({
      // Carried through so the evening renderer can join plan→actual by Notion
      // ID (survives a same-day rename); it falls back to title when absent.
      _notionId: t._notionId,
      title: (t.Task || "").trim(),
      status: stripEmoji(t.Status),
      priority: stripEmoji(t.Priority),
      category: stripEmoji(t.Category),
      personal_category: stripEmoji(t["PERSONAL Category"]),
      work_category: stripEmoji(t["WORK Category"]),
      // The Big Rock this task feeds (first linked rock), or null.
      rock: taskRock(t, rockById),
    }));
}

/** {_notionId, title} of the first rock a task is related to, or null. */
function taskRock(task, rockById) {
  const ids = Array.isArray(task[TASK_ROCKS_PROP]) ? task[TASK_ROCKS_PROP] : [];
  const rock = ids.map((id) => rockById.get(id)).find(Boolean);
  return rock ? { _notionId: rock._notionId, title: rockTitle(rock) } : null;
}

function rockTitle(rock) {
  return (rock.Rock || "").trim();
}

/** The raw Notion `2026 Weeks` record containing this date, or null. */
function findWeekRecord(plan, date) {
  return (
    (plan.weeks || []).find(
      (x) => date >= x["Date Range (SET)"] && date <= x["Date Range (SET) End"]
    ) || null
  );
}

/** The Brickosystem week containing this date.
 *  Weeks run Sunday-Saturday and match Google Calendar's week numbering —
 *  canonical source is the Notion `2026 Weeks` DB (in plan.json). */
function getWeek(plan, date) {
  const w = findWeekRecord(plan, date);
  if (!w) return null;
  return {
    label: w.Week,
    number: parseInt(String(w.Week || "").replace(/^Week\s*/, ""), 10) || null,
    start: w["Date Range (SET)"],
    end: w["Date Range (SET) End"],
  };
}

/** The week's Big Rocks (Notion `🪨 2026 Big Rocks`, in plan.json as `rocks`).
 *  Primary: the week record's rocks relation → rock records by Notion ID.
 *  Fallback (no relation / no week): rocks whose Date..Date End spans the date.
 *  Most weeks have 0–3; an empty array is normal, not an error. */
function getRocks(plan, weekRecord, date) {
  const rocks = Array.isArray(plan.rocks) ? plan.rocks : [];
  const byId = new Map(rocks.map((r) => [r._notionId, r]));
  const relIds = (weekRecord && weekRecord[WEEK_ROCKS_PROP]) || [];
  let picked = relIds.map((id) => byId.get(id)).filter(Boolean);
  if (picked.length === 0) {
    picked = rocks.filter(
      (r) => r.Date && r["Date End"] && date >= r.Date && date <= r["Date End"]
    );
  }
  return picked.map((r) => ({
    _notionId: r._notionId,
    title: rockTitle(r),
    category: stripEmoji(r.Category), // Personal / Work
    status: stripEmoji(r.Status),
    description: (r["My Description"] || r["AI Description"] || "").trim(),
  }));
}

/** Prior briefs inside the carry window: [{date, tasks}] ascending by date.
 *  Missing days are simply absent (weekends the job didn't run, outages). */
function readPriorBriefs(date, briefsDir = BRIEFS_DIR, windowDays = CARRY_WINDOW_DAYS) {
  if (!fs.existsSync(briefsDir)) return [];
  const from = shiftDate(date, -windowDays);
  return fs
    .readdirSync(briefsDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .filter((d) => d >= from && d < date)
    .sort()
    .map((d) => {
      try {
        const b = JSON.parse(fs.readFileSync(path.join(briefsDir, `${d}.json`), "utf8"));
        return { date: d, tasks: Array.isArray(b.tasks) ? b.tasks : [] };
      } catch (_err) {
        return null; // a corrupt brief is a gap, not a crash
      }
    })
    .filter(Boolean);
}

/** True when a prior-brief task is the same task as today's. Notion ID when
 *  both sides carry one; normalized title otherwise (pre-ID briefs). */
function sameTask(today, prior) {
  if (today._notionId && prior._notionId) return today._notionId === prior._notionId;
  return normTitle(today.title) === normTitle(prior.title);
}

/** Add carry history to today's tasks from the prior briefs (see header). */
function withCarryHistory(tasks, priorBriefs) {
  return tasks.map((t) => {
    const days = [];
    let firstPriority = null;
    for (const b of priorBriefs) {
      const hit = b.tasks.find((p) => sameTask(t, p));
      if (!hit) continue;
      if (days.length === 0) firstPriority = stripEmoji(hit.priority) || null;
      days.push(b.date);
    }
    return {
      ...t,
      planned_days: days,
      push_count: days.length,
      morning_number: days.length + 1,
      first_planned: days[0] || null,
      first_priority: days.length ? firstPriority : null,
    };
  });
}

/** Today's date-shaped events from Notion 2026 Events DB. */
function getEvents(plan, date) {
  return (plan.events || [])
    .filter((e) => e.Date === date)
    .map((e) => ({
      name: (e["Event Name"] || "").trim(),
      category: stripEmoji(e.Category),
      // Category is the side; the type lives in the side's column
      // (PERSONAL Category — the former Subcategory — or WORK Category).
      type: stripEmoji(e["PERSONAL Category"] || e["WORK Category"]),
      status: stripEmoji(e.Status),
      notes: (e.Notes || "").trim(),
    }));
}

/** My RSVP on a calendar event. A block with no `self` attendee (0 attendees,
 *  or attendees but none is me) is one I authored — intrinsically accepted,
 *  but kept distinct so consumers can tell an invite from my own block. */
function getMyResponse(attendees) {
  const me = (attendees || []).find((a) => a.self === true);
  return me ? me.response || "needsAction" : "self-authored";
}

/** Today's time-shaped events from Google Calendar (work + personal, all calendars). */
function getCalendarBlocks(calendar, date) {
  const blocks = [];
  for (const [calName, events] of Object.entries(calendar)) {
    if (calName === "_meta" || !Array.isArray(events)) continue;
    for (const e of events) {
      // start is ISO datetime with TZ offset (e.g. "2026-05-30T09:00:00-04:00").
      // The leading 10 chars reflect the local-ET date.
      const start = e.start || "";
      if (!start.startsWith(date)) continue;
      blocks.push({
        calendar: calName,
        title: (e.summary || "").trim(),
        start,
        end: e.end || "",
        location: e.location || "",
        attendees: e.attendees || [],
        my_response: getMyResponse(e.attendees),
      });
    }
  }
  // Sort by start time across all calendars.
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return blocks;
}

// --- Heartbeat ---

function pingHeartbeat(status, message) {
  try {
    const args = [JOB_NAME, status];
    if (message) args.push(message);
    execFileSync(HEARTBEAT_SCRIPT, args, { stdio: "inherit" });
  } catch (err) {
    console.error(`[daily-brief] heartbeat ping failed: ${err.message}`);
  }
}

// --- Main ---

function main() {
  const argDate = process.argv[2];
  const date = argDate || todayET();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(
      `[daily-brief] invalid date arg: '${date}' (expected YYYY-MM-DD)`
    );
    pingHeartbeat("failed", `invalid date arg: ${date}`);
    process.exit(64);
  }

  console.log(`[daily-brief] generating brief for ${date}`);

  try {
    const life = readJsonOrFail("life.json");
    const plan = readJsonOrFail("plan.json");
    const calendar = readJsonOrFail("calendar.json");

    const weekRecord = findWeekRecord(plan, date);
    const rocks = getRocks(plan, weekRecord, date);
    const rockById = new Map((plan.rocks || []).map((r) => [r._notionId, r]));
    // Read prior briefs BEFORE writing today's so a same-day re-run never
    // counts today's own file as a prior morning.
    const priorBriefs = readPriorBriefs(date);
    const tasks = withCarryHistory(getTasks(life, date, rockById), priorBriefs);

    const brief = {
      date,
      generated_at: new Date().toISOString(),
      week: getWeek(plan, date),
      rocks,
      tasks,
      events: getEvents(plan, date),
      calendar_blocks: getCalendarBlocks(calendar, date),
    };

    fs.mkdirSync(BRIEFS_DIR, { recursive: true });
    const outPath = path.join(BRIEFS_DIR, `${date}.json`);
    fs.writeFileSync(outPath, JSON.stringify(brief, null, 2) + "\n");

    const carried = tasks.filter((t) => t.push_count >= 2).length;
    console.log(`[daily-brief] wrote ${outPath}`);
    console.log(
      `[daily-brief]   ${brief.tasks.length} tasks (${carried} on a 3rd+ morning), ${brief.rocks.length} rocks, ` +
        `${brief.events.length} events, ${brief.calendar_blocks.length} calendar blocks; ` +
        `${priorBriefs.length} prior briefs scanned`
    );

    pingHeartbeat("ok");
  } catch (err) {
    console.error(`[daily-brief] FAILED: ${err.message}`);
    pingHeartbeat("failed", err.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  CARRY_WINDOW_DAYS,
  shiftDate,
  getTasks,
  getWeek,
  findWeekRecord,
  getRocks,
  readPriorBriefs,
  withCarryHistory,
  getEvents,
  getCalendarBlocks,
};
