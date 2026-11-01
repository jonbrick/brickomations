// Reports per-week data readiness for retro drafting.
// Combines personal + work summary hours and journal entry counts so skills
// don't have to inspect data/*.json shape ad-hoc.
//
// Also prints a per-source Gaps block — the days a tracker was left dark —
// so /retro-week can ask "fill these first, or run on what's there?" BEFORE
// the walk, instead of tripping over holes at Beat 9. Sources and what counts
// as dark:
//   Meds / Supps  collected.json rows: a day is dark when AM, PM and No are
//                 all unchecked (and, supps, both Skipped lists empty). A day
//                 with no row at all is dark too. "None" (No Meds checked) is
//                 a logged day, not a gap — intent is unknowable either way.
//   Sleep         calendar.json normalWakeUp + sleepIn (Oura, bedtime-stamped):
//                 distinct dates with a record vs. the 7 nights. Oura reaches
//                 the calendar via collect → Notion → calendar → pull, so a
//                 ring synced today may land tomorrow.
//   Journal       journal.json entries whose wins AND improvements are empty —
//                 the evening half of 5MJ never happened (a 7/7 count hides it).
//   Events        plan.json 🎟️ events joined to the week whose end date has
//                 passed but Status is still 🟡 Scheduled / 🔵 Doing.
// Weight / BP reading counts (collected.json withings / bloodPressure) print as
// an info line, never as a gap — whether a week should carry readings is the
// plan's call, and flagging them every week would just be noise.
//
// Usage: node scripts/retro-readiness.js <wkStart> [wkEnd]
//        node scripts/retro-readiness.js 12        // single week
//        node scripts/retro-readiness.js 12 20     // inclusive range

const start = parseInt(process.argv[2], 10);
const end = parseInt(process.argv[3], 10) || start;

if (!start || start < 1 || start > 53 || end < start || end > 53) {
  console.error("Usage: node scripts/retro-readiness.js <wkStart> [wkEnd]");
  console.error("  weeks are 1-53, end defaults to start (single week)");
  process.exit(1);
}

const summaries = require("../data/summaries.json");
const journal = require("../data/journal.json");
const plan = require("../data/plan.json");
const collected = require("../data/collected.json");
const calendar = require("../data/calendar.json");

const weeks = plan.weeks || [];
const journalEntries = journal.entries || [];

// Event statuses that still need Jon's hand once the date has passed.
const EVENT_OPEN_STATUSES = new Set(["🟡 Scheduled", "🔵 Doing"]);

// ---- date helpers ---------------------------------------------------------

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-10-27" → "Tue 2026-10-27". Date-only strings are parsed as UTC noon to dodge TZ drift. */
function dayLabel(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${iso}`;
}

/** Every YYYY-MM-DD from start to end inclusive. */
function daysBetween(start, end) {
  const out = [];
  const d = new Date(`${start}T12:00:00Z`);
  const stop = new Date(`${end}T12:00:00Z`);
  while (d <= stop) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** First 10 chars of a date or datetime string, or null. */
function dateOnly(v) {
  return typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null;
}

/** Today's date in ET as YYYY-MM-DD — the line between elapsed and future days. */
function todayET() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Render a list of ISO days as labeled runs: consecutive days collapse to
 * "Tue 2026-10-27 → Sat 2026-10-31"; singletons stay "Mon 2026-10-26".
 * Every day in the reference set → "all N days".
 */
function describeDays(days, weekDays) {
  if (days.length === weekDays.length) return `all ${weekDays.length} days`;
  const idx = (d) => weekDays.indexOf(d);
  const runs = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && idx(d) === idx(last[last.length - 1]) + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) => (r.length === 1 ? dayLabel(r[0]) : `${dayLabel(r[0])} → ${dayLabel(r[r.length - 1])}`))
    .join(", ");
}

// ---- gap detectors --------------------------------------------------------

/** Days in the week with no row, or a row with every tracker checkbox/list empty. */
function darkTrackerDays(rows, weekDays, boxes, lists = []) {
  const byDate = new Map();
  for (const r of rows || []) {
    const d = dateOnly(r.Date);
    if (d) byDate.set(d, r);
  }
  return weekDays.filter((d) => {
    const r = byDate.get(d);
    if (!r) return true;
    const anyBox = boxes.some((b) => r[b] === true);
    const anyList = lists.some((l) => Array.isArray(r[l]) && r[l].length > 0);
    return !anyBox && !anyList;
  });
}

/** Distinct week dates carrying an Oura sleep record (either wake-up calendar). */
function sleepNights(weekDays) {
  const dates = new Set();
  for (const key of ["normalWakeUp", "sleepIn"]) {
    for (const e of calendar[key] || []) {
      const d = dateOnly(e.start);
      if (d && weekDays.includes(d)) dates.add(d);
    }
  }
  return weekDays.filter((d) => dates.has(d));
}

/** Journal entries in the week whose evening half (wins + improvements) is empty. */
function emptyEveningDays(startDate, endDate) {
  return journalEntries
    .filter((e) => e.date >= startDate && e.date <= endDate)
    .filter((e) => !(e.wins || []).length && !(e.improvements || []).length)
    .map((e) => e.date)
    .sort();
}

/** Count collected.json readings whose Date falls in the week. */
function readingsInWeek(rows, startDate, endDate) {
  return (rows || []).filter((r) => {
    const d = dateOnly(r.Date);
    return d && d >= startDate && d <= endDate;
  }).length;
}

/** 🎟️ events joined to the week that ended on or before `cutoff`, Status still open. */
function openPastEvents(weekRec, cutoff) {
  if (!weekRec || !weekRec._notionId) return [];
  return (plan.events || [])
    .filter((e) => (e["⏰ 2026 Weeks"] || []).includes(weekRec._notionId))
    .filter((e) => EVENT_OPEN_STATUSES.has(e.Status))
    .filter((e) => {
      const last = dateOnly(e["Date End"]) || dateOnly(e.Date);
      return last && last <= cutoff;
    })
    .sort((a, b) => String(a.Date).localeCompare(String(b.Date)))
    .map((e) => {
      const d = dateOnly(e.Date);
      return `${(e["Event Name"] || "").trim()} (${d ? dayLabel(d).slice(0, 3) : "?"})`;
    });
}

function findSummary(records, weekNum, side) {
  const want = `Week ${weekNum} ${side} Summary`;
  return (records || []).find((r) => {
    const titleKey = r._titleKey;
    if (!titleKey) return false;
    return r[titleKey] === want;
  });
}

function planWeek(weekNum) {
  return weeks.find((w) => w["Week"] === "Week " + weekNum);
}

function hours(rec, field) {
  if (!rec) return null;
  const v = rec[field];
  if (v == null || v === "") return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function journalCount(startDate, endDate) {
  if (!startDate || !endDate) return null;
  return journalEntries.filter((e) => e.date >= startDate && e.date <= endDate).length;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

for (let wk = start; wk <= end; wk++) {
  const w = planWeek(wk);
  const startDate = w ? w["Date Range (SET)"] : null;
  const endDate = w ? w["Date Range (SET) End"] : null;

  const pSum = findSummary(summaries.personalWeekly, wk, "Personal");
  const wSum = findSummary(summaries.workWeekly, wk, "Work");

  const pHours = hours(pSum, "+ Blocks Hours Total");
  const wHours = hours(wSum, "+ Blocks Hours Total");
  const jCount = journalCount(startDate, endDate);

  const dateStr = startDate && endDate ? `${startDate} to ${endDate}` : "no date range";
  console.log(`Week ${wk} (${dateStr})`);
  console.log(`  Personal: ${pSum ? "✓" : "✗"} summary` + (pSum ? `, ${pHours.toFixed(1)}h` : ""));
  console.log(`  Work:     ${wSum ? "✓" : "✗"} summary` + (wSum ? `, ${wHours.toFixed(1)}h` : ""));
  console.log(`  Journal:  ${jCount == null ? "?" : `${jCount}/7`} entries`);

  // Metrics are informational — whether a week *should* carry readings is the
  // plan's call (Beat 10), so they never count as a gap here.
  if (startDate && endDate) {
    const weight = readingsInWeek(collected.withings, startDate, endDate);
    const bp = readingsInWeek(collected.bloodPressure, startDate, endDate);
    console.log(`  Metrics:  weight ${weight} reading${weight === 1 ? "" : "s"} · BP ${bp} reading${bp === 1 ? "" : "s"}`);
  }

  // Gaps — one block, one line per source with something missing. Structural
  // holes (no summary, empty week) lead; tracker dark days follow. A clean
  // week prints "Gaps:     none" so the skill always has a line to read.
  const gaps = [];
  if (!pSum) gaps.push("Summary   no personal summary");
  if (!wSum) gaps.push("Summary   no work summary");
  if (pSum && pHours === 0) gaps.push("Summary   personal hours = 0");
  if (wSum && wHours === 0) gaps.push("Summary   work hours = 0");

  // Only elapsed days can be dark — today is still in motion and the future
  // hasn't happened. An in-progress week checks yesterday and earlier; a
  // closed week checks all seven.
  const today = todayET();
  const elapsed = startDate && endDate ? daysBetween(startDate, endDate).filter((d) => d < today) : [];
  if (elapsed.length) {
    const lastDay = elapsed[elapsed.length - 1];
    const n = elapsed.length;

    const haveEntry = new Set(journalEntries.map((e) => e.date));
    const noEntry = elapsed.filter((d) => !haveEntry.has(d));
    if (noEntry.length) gaps.push(`Journal   no entry ${describeDays(noEntry, elapsed)}`);

    const evenings = emptyEveningDays(startDate, lastDay);
    if (evenings.length) gaps.push(`Journal   evening half empty ${describeDays(evenings, elapsed)}`);

    const medsDark = darkTrackerDays(collected.medications, elapsed, ["AM Meds", "PM Meds", "No Meds"]);
    if (medsDark.length) gaps.push(`Meds      not logged ${describeDays(medsDark, elapsed)}`);

    const suppsDark = darkTrackerDays(
      collected.supplements, elapsed,
      ["AM Supps", "PM Supps", "No Supps"], ["AM Skipped", "PM Skipped"]
    );
    if (suppsDark.length) gaps.push(`Supps     not logged ${describeDays(suppsDark, elapsed)}`);

    const nights = sleepNights(elapsed);
    if (nights.length < n) {
      const missing = elapsed.filter((d) => !nights.includes(d));
      gaps.push(`Sleep     ${nights.length}/${n} nights recorded — none ${describeDays(missing, elapsed)}`);
    }

    const openEvents = openPastEvents(w, lastDay);
    if (openEvents.length) gaps.push(`Events    still open: ${openEvents.join(", ")}`);
  }

  if (!gaps.length) console.log("  Gaps:     none");
  else {
    console.log("  Gaps:");
    for (const line of gaps) console.log(`    ${line}`);
  }
}
