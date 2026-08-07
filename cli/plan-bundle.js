#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Plan bundle: emit one JSON object on stdout with all data /plan-week
 * needs for the given week. Read-only against data/*.json — safe on
 * either machine (no writes, no iCloud race).
 *
 * Mirrors cli/retro-bundle.js conventions (joinByWeek via the Weeks
 * relation, plumbing-key stripping, fail loud, --silent stdout JSON).
 *
 * Usage: yarn --silent plan:bundle <wk>
 */

const path = require("path");

const PLUMBING_KEYS = new Set([
  "_notionId",
  "_lastPulled",
  "_notionEditedTime",
  "_titleKey",
  "_propertyTypes",
  "_hash",
  "_content",
  "_contentHash",
]);

const WEEKS_RELATION = "⏰ 2026 Weeks";
const MONTHS_RELATION = "🗓️ 2026 Months";

function strip(record) {
  if (!record || typeof record !== "object") return record;
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (!PLUMBING_KEYS.has(k)) out[k] = v;
  }
  return out;
}

// Like strip(), but keeps _notionId — /plan-week builds Notion URLs from it.
function stripKeepId(record) {
  if (!record || typeof record !== "object") return record;
  const out = strip(record);
  out._notionId = record._notionId;
  return out;
}

function joinByWeek(records, weekNotionId) {
  if (!Array.isArray(records)) return [];
  return records.filter(
    (r) =>
      Array.isArray(r[WEEKS_RELATION]) &&
      r[WEEKS_RELATION].includes(weekNotionId)
  );
}

function inRange(dateStr, start, end) {
  return typeof dateStr === "string" && dateStr >= start && dateStr <= end;
}

// Calendar event starts are ISO datetimes with TZ offset (timed) or
// date-only strings (all-day); the leading 10 chars are the local date.
function calEventInSpan(ev, start, end) {
  const day = String(ev.start || "").slice(0, 10);
  return day >= start && day <= end;
}

function calSlim(ev) {
  const description = String(ev.description || "");
  return {
    summary: ev.summary,
    start: ev.start,
    end: ev.end,
    location: ev.location || "",
    status: ev.status,
    description:
      description.length > 200 ? description.slice(0, 200) + "…" : description,
  };
}

// The 11 dedicated habit calendars, keyed by their 🌱 2026 Weeks Plan - Personal
// column name so the render — and the habit walk — line up 1:1 with the
// numbers written back. Streams live in calendar.json beside the main cals.
const HABIT_STREAMS = {
  "Workout Days": "workout",
  "Sober Days": "sober",
  "Drinking Days": "drinking",
  "Cooking Days": "cooking",
  "Early Wakeup Days": "normalWakeUp",
  "Meditation Days": "meditation",
  "Reading Days": "reading",
  "Coding Days": "coding",
  "Music Days": "music",
  "Art Days": "art",
  "Video Games Days": "videoGames",
};

// Per-habit actuals within a span → {label: [{date, summary}]}, keyed by
// 🌱 Weeks Plan - Personal column name. The habit calendars hold the PAST
// (actuals): future days
// come back empty by design — on a catch-up run the past is already filled
// in, so the walk proposes from real actuals instead of a blank plan row.
function habitActuals(calendar, start, end) {
  const out = {};
  for (const [label, key] of Object.entries(HABIT_STREAMS)) {
    out[label] = (calendar[key] || [])
      .filter((e) => calEventInSpan(e, start, end))
      .map((e) => ({
        date: String(e.start || "").slice(0, 10),
        summary: String(e.summary || "").trim(),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

function loadJson(name) {
  return require(path.join(__dirname, "..", "data", name));
}

function buildBundle(wk) {
  const plan = loadJson("plan.json");
  const life = loadJson("life.json");
  const calendar = loadJson("calendar.json");
  const retro = loadJson("retro.json");

  // Linear caches (yarn pull:linear) may be absent until the first
  // scheduled pull lands; not fatal.
  let workProjects = null;
  try {
    workProjects = loadJson("workProjects.json");
  } catch {
    workProjects = null;
  }
  let workTasks = null;
  try {
    workTasks = loadJson("workTasks.json");
  } catch {
    workTasks = null;
  }

  // plan.json week titles are zero-padded ("Week 08"); life.json task
  // "Week Number" values are not ("Week 8"). Different keys per file.
  const weekTitle = `Week ${String(wk).padStart(2, "0")}`;
  const taskWeekKey = `Week ${wk}`;
  const weekRecord = plan.weeks.find((w) => w.Week === weekTitle);
  if (!weekRecord) {
    throw new Error(`week not found in plan.json: "${weekTitle}"`);
  }
  const weekNotionId = weekRecord._notionId;
  const start = weekRecord["Date Range (SET)"];
  const end = weekRecord["Date Range (SET) End"];
  if (!start || !end) {
    throw new Error(
      `week "${weekTitle}" missing Date Range (SET) / Date Range (SET) End`
    );
  }

  // --- Tasks: Week Number is the clean key (string "Week 28"); union with
  // Due Date range for tasks that carry a date but no week relation.
  const seenTasks = new Set();
  const weekTasks = (life.tasks || []).filter((t) => {
    const match =
      t["Week Number"] === taskWeekKey || inRange(t["Due Date"], start, end);
    if (!match || seenTasks.has(t._notionId)) return false;
    seenTasks.add(t._notionId);
    return true;
  });
  const tasks = { personal: [], work: [], other: [] };
  for (const t of weekTasks) {
    if (t["WORK Category"]) tasks.work.push(strip(t));
    else if (t["PERSONAL Category"]) tasks.personal.push(strip(t));
    else tasks.other.push(strip(t));
  }

  // --- Calendar blocks, both sides (constraints are side-agnostic).
  const calendarBlocks = {
    personal: (calendar.personalCalendar || [])
      .filter((e) => calEventInSpan(e, start, end))
      .map(calSlim),
    work: (calendar.workCalendar || [])
      .filter((e) => calEventInSpan(e, start, end))
      .map(calSlim),
  };

  // --- Events / trips: Weeks relation primary, Date-range fallback.
  const eventsById = new Map();
  for (const e of joinByWeek(plan.events, weekNotionId)) {
    eventsById.set(e._notionId, e);
  }
  for (const e of plan.events || []) {
    if (inRange(e.Date, start, end)) eventsById.set(e._notionId, e);
  }
  const events = [...eventsById.values()].map(strip);
  const trips = joinByWeek(plan.trips, weekNotionId).map(strip);

  // --- Existing outcome state (plan tops up; it never double-books).
  const rocksForWeek = joinByWeek(plan.rocks, weekNotionId);
  const soberDrinking = ["sober", "drinking"]
    .flatMap((cal) => calendar[cal] || [])
    .filter((e) => calEventInSpan(e, start, end))
    .map((e) => ({ summary: e.summary, start: e.start, end: e.end }));
  const plannedBlocks = (calendar.personalCalendar || [])
    .filter(
      (e) =>
        calEventInSpan(e, start, end) &&
        String(e.summary || "").startsWith("Planned:")
    )
    .map(calSlim);
  // --- Inputs (read-only context; the "lens").
  const monthRecord = (plan.months || []).find(
    (m) =>
      Array.isArray(m[WEEKS_RELATION]) &&
      m[WEEKS_RELATION].includes(weekNotionId)
  );
  const monthNotionId = monthRecord ? monthRecord._notionId : null;
  const findMonthPlan = (plans) =>
    monthNotionId
      ? (plans || []).find(
          (p) =>
            Array.isArray(p[MONTHS_RELATION]) &&
            p[MONTHS_RELATION].includes(monthNotionId)
        ) || null
      : null;

  const priorWeekRecord = plan.weeks.find(
    (w) => w.Week === `Week ${String(wk - 1).padStart(2, "0")}`
  );
  const priorWeekNotionId = priorWeekRecord ? priorWeekRecord._notionId : null;

  const bundle = {
    generatedAt: new Date().toISOString(),
    dataPulledAt:
      (life._meta && (life._meta.pulledAt || life._meta.pulled_at)) || null,
    week: {
      number: wk,
      title: weekTitle,
      notionId: weekNotionId,
      start,
      end,
    },
    tasks,
    calendarBlocks,
    events,
    trips,
    existingState: {
      rocks: {
        personal: rocksForWeek
          .filter((r) => r.Category !== "💼 Work")
          .map(strip),
        work: rocksForWeek
          .filter((r) => r.Category === "💼 Work")
          .map(strip),
      },
      soberDrinking,
      plannedBlocks,
      // What's already happened this week on the habit calendars — empty for
      // future days, filled for past ones (the catch-up-run signal).
      habitActuals: habitActuals(calendar, start, end),
      // _notionId kept: /plan-week writes this week's numbers + Status to it.
      habitsPlan:
        joinByWeek(life.habitsPlan, weekNotionId).map(stripKeepId)[0] || null,
      // Work Week Plan row (lanes + Status). Null until WORK_WEEKS_PLAN_DATABASE_ID
      // is set and pulled; /plan-week + /retro-week fall back to an MCP lookup.
      workPlan: life.workWeeksPlan
        ? joinByWeek(life.workWeeksPlan, weekNotionId).map(stripKeepId)[0] || null
        : null,
    },
    inputs: {
      goals: (life.goals || [])
        .filter((g) => g.Status !== "🟢 Done")
        .map(stripKeepId),
      personalProjects: (life.personalProjects || [])
        .filter((p) => p.Status !== "🟢 Done")
        .map(stripKeepId),
      workProjects: workProjects
        ? {
            pulledAt: workProjects._meta
              ? workProjects._meta.pulledAt || workProjects._meta.pulled_at
              : null,
            projects: workProjects.projects || [],
          }
        : null,
      // The week's Linear tickets: due in span (done ones included, so the
      // plan doesn't double-book) plus open undated. A non-empty
      // "Completed At" means done — Status names are team-customizable.
      workTickets: workTasks
        ? {
            pulledAt: workTasks._meta ? workTasks._meta.pulledAt : null,
            tickets: (workTasks.tasks || []).filter(
              (t) =>
                inRange(t["Due Date"], start, end) ||
                (!t["Due Date"] && !t["Completed At"])
            ),
          }
        : null,
      monthPlans: {
        personal: strip(findMonthPlan(life.personalMonthlyPlans)),
        work: strip(findMonthPlan(life.workMonthlyPlans)),
      },
      priorWeek: priorWeekNotionId
        ? {
            number: wk - 1,
            start: priorWeekRecord["Date Range (SET)"] || null,
            end: priorWeekRecord["Date Range (SET) End"] || null,
            retros: {
              personal:
                strip(joinByWeek(retro.personalWeekly, priorWeekNotionId)[0]) ||
                null,
              work:
                strip(joinByWeek(retro.workWeekly, priorWeekNotionId)[0]) ||
                null,
            },
            rocks: joinByWeek(plan.rocks, priorWeekNotionId).map(strip),
            // Prior week's numbers are the defaults for the habit walk.
            habitsPlan:
              strip(joinByWeek(life.habitsPlan, priorWeekNotionId)[0]) || null,
            // Prior week's real actuals from the dedicated habit calendars —
            // the better default when the 🌱 plan row is blank (unplanned week).
            habitActuals:
              priorWeekRecord["Date Range (SET)"] &&
              priorWeekRecord["Date Range (SET) End"]
                ? habitActuals(
                    calendar,
                    priorWeekRecord["Date Range (SET)"],
                    priorWeekRecord["Date Range (SET) End"]
                  )
                : null,
          }
        : null,
      themes: (life.themes || []).map(strip),
    },
  };

  return bundle;
}

function main() {
  const wkArg = process.argv[2];
  const wk = Number.parseInt(wkArg, 10);
  if (!Number.isInteger(wk) || wk < 1 || wk > 53) {
    process.stderr.write(
      `usage: yarn --silent plan:bundle <wk>  (wk must be an integer 1..53, got ${JSON.stringify(wkArg)})\n`
    );
    process.exit(1);
  }
  try {
    process.stdout.write(JSON.stringify(buildBundle(wk), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { buildBundle };

if (require.main === module) {
  main();
}
