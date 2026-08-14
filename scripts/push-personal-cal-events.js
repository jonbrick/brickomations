#!/usr/bin/env node
/**
 * Push personal Google Calendar events from a JSON file.
 *
 * Bridges the gap that Claude's GCal MCP can't write to personal calendars
 * (it auths as jon.brick@cortex.io). Brickbot carries PERSONAL_GOOGLE_REFRESH_TOKEN
 * and reaches the personal side via GoogleCalendarService("personal").
 *
 * JSON shape (array of events):
 *   [
 *     {
 *       "summary":     "Event title",                      // required
 *       "start":       "2026-06-16T18:00:00-04:00",        // required (ISO with TZ)
 *       "end":         "2026-06-16T20:00:00-04:00",        // required
 *       "calendar":    "jonbrick09@gmail.com",             // required (cal ID or email)
 *       "description": "...",                              // optional
 *       "location":    "..."                               // optional
 *     }
 *   ]
 *
 * Idempotent: skips creation if an event with the same calendar/start/end
 * (±60 sec window) already exists.
 *
 * Run on the mini (PERSONAL_GOOGLE_REFRESH_TOKEN must be set):
 *   cd ~/projects/brickomations && node scripts/push-personal-cal-events.js [path] [--dry-run]
 *
 * Defaults to local/calendar/personal-events.json when no path is given.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const GoogleCalendarService = require("../src/services/GoogleCalendarService");

const DRY_RUN = process.argv.includes("--dry-run");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const jsonPath = path.resolve(positional[0] || "local/calendar/personal-events.json");

if (!fs.existsSync(jsonPath)) {
  console.error(`❌ JSON file not found: ${jsonPath}`);
  process.exit(1);
}

let events;
try {
  events = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
} catch (err) {
  console.error(`❌ Failed to parse JSON: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(events)) {
  console.error("❌ JSON must be an array of event objects");
  process.exit(1);
}

const TIME_ZONE = "America/New_York";

async function findEvent(svc, calendarId, start, end) {
  const startMs = new Date(start).getTime();
  const timeMin = new Date(startMs - 2 * 60 * 1000);
  const timeMax = new Date(new Date(end).getTime() + 2 * 60 * 1000);
  const list = await svc.listEvents(calendarId, timeMin, timeMax);
  const targetStart = startMs;
  const targetEnd = new Date(end).getTime();
  return list.find((e) => {
    const eStart = new Date(e.start.dateTime || e.start.date).getTime();
    const eEnd = new Date(e.end.dateTime || e.end.date).getTime();
    return Math.abs(eStart - targetStart) < 60_000 && Math.abs(eEnd - targetEnd) < 60_000;
  });
}

async function main() {
  console.log(`\n📅 Pushing ${events.length} personal-cal event(s) from ${jsonPath}${DRY_RUN ? " (dry run)" : ""}\n`);

  const svc = new GoogleCalendarService("personal");

  let pushed = 0;
  let skipped = 0;
  let invalid = 0;

  for (const ev of events) {
    const { summary, start, end, calendar: calId, description, location } = ev;

    if (!summary || !start || !end || !calId) {
      console.error(`  ❌ skip — missing required field(s): ${JSON.stringify(ev)}`);
      invalid++;
      continue;
    }

    const existing = await findEvent(svc, calId, start, end);
    if (existing) {
      console.log(`  ⏭️  ${start.slice(0, 16)} ${summary} → ${calId} — already exists id=${existing.id}`);
      skipped++;
      continue;
    }

    // All-day events use date-only start/end (no "T"); timed events use dateTime.
    const allDay = !String(start).includes("T");
    const eventData = {
      summary,
      start: allDay ? { date: start } : { dateTime: start, timeZone: TIME_ZONE },
      end: allDay ? { date: end } : { dateTime: end, timeZone: TIME_ZONE },
    };
    if (description) eventData.description = description;
    if (location) eventData.location = location;

    if (DRY_RUN) {
      console.log(`  🔸 WOULD CREATE ${start.slice(0, 16)} ${summary} → ${calId}`);
    } else {
      const created = await svc.createEvent(calId, eventData);
      console.log(`  ✅ CREATED ${start.slice(0, 16)} ${summary} → ${calId} id=${created.id}`);
    }
    pushed++;
  }

  console.log(
    `\n📊 ${pushed} ${DRY_RUN ? "would push" : "pushed"} · ${skipped} skipped (already exists) · ${invalid} invalid${DRY_RUN ? " — dry run, no writes" : ""}\n`
  );
}

main().catch((err) => {
  console.error("\n❌ Push failed:", err.message);
  process.exit(1);
});
