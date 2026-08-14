#!/usr/bin/env node

/**
 * Daily Brief CLI
 *
 * Pre-stages today's daily-note inputs as JSON for Cowork's morning-brief.
 * Filters data/*.json for today's tasks, events, and calendar blocks.
 *
 * Writes data/briefs/<YYYY-MM-DD>.json (the briefs/ folder accumulates
 * indefinitely — historical record for retros and debugging).
 *
 * Designed to run at 6:00 AM via dedicated launchd plist
 * (com.brickomations.daily-brief), separate from `yarn sync`. No API calls —
 * reads existing data/*.json (refreshed by the 11 PM yarn sync the night
 * before). ~5 second runtime, plenty of headroom before the 7 AM Cowork
 * morning-brief task that consumes the brief.
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

// --- Date handling ---

/** Today's date in ET, as YYYY-MM-DD. */
function todayET() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

// --- Helpers ---

/** Strip leading emoji + whitespace from a value (e.g., "🔴 To Do" → "To Do"). */
function stripEmoji(str) {
  if (!str) return "";
  return String(str)
    .replace(/^[^\x00-\x7F]+\s*/, "")
    .trim();
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
function getTasks(life, date) {
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
    }));
}

/** The Brickosystem week containing this date.
 *  Weeks run Sunday-Saturday and match Google Calendar's week numbering —
 *  canonical source is the Notion `2026 Weeks` DB (in plan.json). */
function getWeek(plan, date) {
  const w = (plan.weeks || []).find(
    (x) => date >= x["Date Range (SET)"] && date <= x["Date Range (SET) End"]
  );
  if (!w) return null;
  return {
    label: w.Week,
    number: parseInt(String(w.Week || "").replace(/^Week\s*/, ""), 10) || null,
    start: w["Date Range (SET)"],
    end: w["Date Range (SET) End"],
  };
}

/** Today's date-shaped events from Notion 2026 Events DB. */
function getEvents(plan, date) {
  return (plan.events || [])
    .filter((e) => e.Date === date)
    .map((e) => ({
      name: (e["Event Name"] || "").trim(),
      category: stripEmoji(e.Category),
      subcategory: stripEmoji(e.Subcategory),
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

    const brief = {
      date,
      generated_at: new Date().toISOString(),
      week: getWeek(plan, date),
      tasks: getTasks(life, date),
      events: getEvents(plan, date),
      calendar_blocks: getCalendarBlocks(calendar, date),
    };

    fs.mkdirSync(BRIEFS_DIR, { recursive: true });
    const outPath = path.join(BRIEFS_DIR, `${date}.json`);
    fs.writeFileSync(outPath, JSON.stringify(brief, null, 2) + "\n");

    console.log(`[daily-brief] wrote ${outPath}`);
    console.log(
      `[daily-brief]   ${brief.tasks.length} tasks, ${brief.events.length} events, ${brief.calendar_blocks.length} calendar blocks`
    );

    pingHeartbeat("ok");
  } catch (err) {
    console.error(`[daily-brief] FAILED: ${err.message}`);
    pingHeartbeat("failed", err.message);
    process.exit(1);
  }
}

main();
