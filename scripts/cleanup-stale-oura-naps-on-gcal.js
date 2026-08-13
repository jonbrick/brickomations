#!/usr/bin/env node
/**
 * One-off cleanup for pre-PR#70 Oura stale GCal events.
 *
 * Before PR #70 (oura: skip naps and fragments), every Oura `type: "sleep"`
 * session was written to Sleep In or Normal Wake Up. PR #70 stopped the
 * bleeding for new data. PR #112 introduced the Naps calendar so naps are
 * preserved as life context without polluting the sleep-trend cals.
 *
 * This script finishes the migration:
 *   - Deletes 7 surviving stale events from Sleep In / Normal Wake Up
 *     (6 drowsy fragments + 1 nap whose record will be re-routed)
 *   - Creates 6 events on the new Naps calendar (the 5 nap records that
 *     never had a surviving GCal event + the 5/4 nap that's being moved)
 *
 * Notion-side cleanup (archiving 22 drowsy records, updating 6 nap records
 * to Google Calendar = "Naps") is done out of band via Notion MCP.
 *
 * Idempotency:
 *   - Deletes are guarded: log + skip if the target event isn't found.
 *   - Creations check for an existing event in a tight window before
 *     creating a duplicate.
 *
 * Run on the mini (PERSONAL_GOOGLE_REFRESH_TOKEN must be set):
 *   cd ~/projects/brickomations && node scripts/cleanup-stale-oura-naps-on-gcal.js
 *
 * Add --dry-run to see what would happen without writing.
 */

require("dotenv").config();
const GoogleCalendarService = require("../src/services/GoogleCalendarService");

const DRY_RUN = process.argv.includes("--dry-run");

const SLEEP_IN_ID = process.env.SLEEP_IN_CALENDAR_ID;
const NORMAL_WAKE_UP_ID = process.env.NORMAL_WAKE_UP_CALENDAR_ID;
const NAPS_ID = process.env.NAPS_CALENDAR_ID;

if (!SLEEP_IN_ID || !NORMAL_WAKE_UP_ID || !NAPS_ID) {
  console.error(
    "❌ Missing env. Need SLEEP_IN_CALENDAR_ID, NORMAL_WAKE_UP_CALENDAR_ID, NAPS_CALENDAR_ID."
  );
  process.exit(1);
}

// 7 stale events to remove from Sleep In / Normal Wake Up.
// Times are ISO strings with the local TZ offset, matching what Oura stored.
const TO_DELETE = [
  { cal: SLEEP_IN_ID, start: "2026-01-19T18:00:30-05:00", end: "2026-01-19T18:41:00-05:00", note: "0.3h drowsy" },
  { cal: NORMAL_WAKE_UP_ID, start: "2026-03-29T01:39:13-04:00", end: "2026-03-29T02:48:33-04:00", note: "1h pre-bed fragment" },
  { cal: SLEEP_IN_ID, start: "2026-04-21T22:46:00-04:00", end: "2026-04-21T23:50:30-04:00", note: "0.2h drowsy" },
  { cal: SLEEP_IN_ID, start: "2026-04-27T23:01:01-04:00", end: "2026-04-27T23:22:01-04:00", note: "0.1h drowsy" },
  { cal: SLEEP_IN_ID, start: "2026-05-02T20:35:57-04:00", end: "2026-05-02T20:57:28-04:00", note: "0.1h drowsy" },
  { cal: SLEEP_IN_ID, start: "2026-05-02T22:53:27-04:00", end: "2026-05-02T23:30:28-04:00", note: "0.2h drowsy" },
  { cal: SLEEP_IN_ID, start: "2026-05-04T12:03:30-04:00", end: "2026-05-04T13:30:31-04:00", note: "1.1h nap — migrating to Naps cal" },
];

// 6 nap events to create on the Naps calendar.
// Summary + description match the format produced by
// transformers/notion-oura-to-calendar-sleep.js.
const TO_CREATE = [
  { start: "2026-02-27T17:37:00-05:00", end: "2026-02-27T18:42:00-05:00", durHrs: 0.7, eff: 70, note: "afternoon nap" },
  { start: "2026-03-08T12:44:00-05:00", end: "2026-03-08T16:09:59-04:00", durHrs: 1.9, eff: 84, note: "long afternoon nap" },
  { start: "2026-03-20T18:19:00-04:00", end: "2026-03-20T19:29:00-04:00", durHrs: 0.9, eff: 80, note: "early evening nap" },
  { start: "2026-03-31T09:19:19-07:00", end: "2026-03-31T11:34:24-07:00", durHrs: 1.3, eff: 86, note: "morning nap after main sleep" },
  { start: "2026-04-26T07:22:34-04:00", end: "2026-04-26T10:14:45-04:00", durHrs: 2.5, eff: 86, note: "morning sleep (single block, no main long_sleep)" },
  { start: "2026-05-04T12:03:30-04:00", end: "2026-05-04T13:30:31-04:00", durHrs: 1.1, eff: 75, note: "afternoon nap (moved from Sleep In)" },
];

const TIME_ZONE = "America/New_York";

function eventSummary(durHrs, eff) {
  return `🛏️ Sleep - ${durHrs}hrs (${eff}% efficiency)`;
}

function eventDescription(start, end) {
  const fmt = (iso) => new Date(iso).toLocaleString();
  return `Sleep Session\n\nBedtime: ${fmt(start)}\nWake Time: ${fmt(end)}\n\n(Migrated by cleanup-stale-oura-naps-on-gcal.js — historical nap preserved on Naps calendar after PR #112.)`;
}

async function findEvent(svc, calendarId, start, end) {
  // Pull events in a ±2 minute window around the start time.
  const startMs = new Date(start).getTime();
  const timeMin = new Date(startMs - 2 * 60 * 1000);
  const timeMax = new Date(new Date(end).getTime() + 2 * 60 * 1000);
  const events = await svc.listEvents(calendarId, timeMin, timeMax);
  const targetStart = new Date(start).getTime();
  const targetEnd = new Date(end).getTime();
  return events.find((e) => {
    const eStart = new Date(e.start.dateTime || e.start.date).getTime();
    const eEnd = new Date(e.end.dateTime || e.end.date).getTime();
    return Math.abs(eStart - targetStart) < 60_000 && Math.abs(eEnd - targetEnd) < 60_000;
  });
}

async function main() {
  console.log(`\n🧹 Oura GCal cleanup ${DRY_RUN ? "(dry run)" : ""}\n`);

  const svc = new GoogleCalendarService("personal");

  // --- Deletes ---
  console.log(`--- Deletes (${TO_DELETE.length}) ---`);
  let deleted = 0;
  let deleteSkipped = 0;
  for (const item of TO_DELETE) {
    const calName = item.cal === SLEEP_IN_ID ? "SleepIn" : "NormalWakeUp";
    const ev = await findEvent(svc, item.cal, item.start, item.end);
    if (!ev) {
      console.log(`  ⏭️  ${calName} ${item.start.slice(0, 16)} — not found (already deleted?) [${item.note}]`);
      deleteSkipped++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  🔸 WOULD DELETE ${calName} ${item.start.slice(0, 16)} id=${ev.id} [${item.note}]`);
    } else {
      await svc.deleteEvent(item.cal, ev.id);
      console.log(`  ✅ DELETED ${calName} ${item.start.slice(0, 16)} [${item.note}]`);
    }
    deleted++;
  }

  // --- Creates ---
  console.log(`\n--- Creates on Naps (${TO_CREATE.length}) ---`);
  let created = 0;
  let createSkipped = 0;
  for (const nap of TO_CREATE) {
    const existing = await findEvent(svc, NAPS_ID, nap.start, nap.end);
    if (existing) {
      console.log(`  ⏭️  ${nap.start.slice(0, 16)} — already exists id=${existing.id} [${nap.note}]`);
      createSkipped++;
      continue;
    }
    const eventData = {
      summary: eventSummary(nap.durHrs, nap.eff),
      description: eventDescription(nap.start, nap.end),
      start: { dateTime: nap.start, timeZone: TIME_ZONE },
      end: { dateTime: nap.end, timeZone: TIME_ZONE },
    };
    if (DRY_RUN) {
      console.log(`  🔸 WOULD CREATE ${nap.start.slice(0, 16)} ${nap.durHrs}h [${nap.note}]`);
    } else {
      const ev = await svc.createEvent(NAPS_ID, eventData);
      console.log(`  ✅ CREATED ${nap.start.slice(0, 16)} ${nap.durHrs}h id=${ev.id} [${nap.note}]`);
    }
    created++;
  }

  console.log(
    `\n📊 Summary: ${deleted - deleteSkipped} deleted (${deleteSkipped} skipped), ${created - createSkipped} created (${createSkipped} skipped)${DRY_RUN ? " — dry run, no writes" : ""}\n`
  );
}

main().catch((err) => {
  console.error("\n❌ Cleanup failed:", err.message);
  process.exit(1);
});
