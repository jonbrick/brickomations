#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Month bundle: emit one JSON object on stdout with all data /plan-month
 * needs for the given month. Read-only against data/*.json — safe on
 * either machine (no writes, no iCloud race).
 *
 * Shares join/strip helpers with cli/plan-bundle.js so week and month
 * bundles agree on what "open", "settled", and "upcoming" mean.
 *
 * Usage: yarn --silent month:bundle <mm>   (1..12)
 */

const {
  strip,
  stripKeepId,
  joinByWeek,
  inRange,
  loadJson,
  upcomingEventsTrips,
  openTaskCounts,
  undatedBacklog,
  SETTLED,
  GOAL_CLOSED,
  WEEKS_RELATION,
  MONTHS_RELATION,
} = require("./plan-bundle");

// Forward lookahead past month end (2 weeks) — the next month's opening.
const LOOKAHEAD_DAYS = 14;

const pad2 = (n) => String(n).padStart(2, "0");

function findMonthRecord(plan, mm) {
  const prefix = `${pad2(mm)}. `;
  return (plan.months || []).find((m) => String(m.Month || "").startsWith(prefix)) || null;
}

function byMonth(records, monthNotionId) {
  if (!monthNotionId || !Array.isArray(records)) return null;
  return (
    records.find(
      (r) =>
        Array.isArray(r[MONTHS_RELATION]) &&
        r[MONTHS_RELATION].includes(monthNotionId)
    ) || null
  );
}

function weekNumber(title) {
  const m = /Week\s+(\d+)/.exec(String(title || ""));
  return m ? Number(m[1]) : null;
}

const rockSlim = (r) => ({
  Rock: r.Rock,
  Category: r.Category,
  Status: r.Status,
  Retro: r.Retro,
});

function buildMonthBundle(mm) {
  const plan = loadJson("plan.json");
  const life = loadJson("life.json");
  const summaries = loadJson("summaries.json");

  const monthRecord = findMonthRecord(plan, mm);
  if (!monthRecord) {
    throw new Error(`month not found in plan.json: "${pad2(mm)}. …"`);
  }
  const monthNotionId = monthRecord._notionId;
  const priorRecord = mm > 1 ? findMonthRecord(plan, mm - 1) : null;
  const priorNotionId = priorRecord ? priorRecord._notionId : null;

  // --- Weeks: the month's related Weeks rows, chronological, with the plan
  // state each already carries (the cascade skips weeks past 🔴 To Do).
  const weekIds = new Set(monthRecord[WEEKS_RELATION] || []);
  const weeks = (plan.weeks || [])
    .filter((w) => weekIds.has(w._notionId))
    .map((w) => {
      const personalPlan = joinByWeek(life.habitsPlan, w._notionId)[0] || null;
      const workPlan = joinByWeek(life.workWeeksPlan, w._notionId)[0] || null;
      return {
        number: weekNumber(w.Week),
        title: w.Week,
        notionId: w._notionId,
        start: w["Date Range (SET)"] || null,
        end: w["Date Range (SET) End"] || null,
        personalPlanStatus: personalPlan ? personalPlan.Status || null : null,
        workPlanStatus: workPlan ? workPlan.Status || null : null,
        personalPlanNotionId: personalPlan ? personalPlan._notionId : null,
        workPlanNotionId: workPlan ? workPlan._notionId : null,
        rocks: joinByWeek(plan.rocks, w._notionId).map(rockSlim),
      };
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (!weeks.length) {
    throw new Error(`month "${monthRecord.Month}" has no related weeks`);
  }
  const start = weeks[0].start;
  const end = weeks[weeks.length - 1].end;
  if (!start || !end) {
    throw new Error(`month "${monthRecord.Month}" weeks missing Date Range (SET)`);
  }

  // --- Work state, same derivation as plan-bundle.
  const workProjectRows = (life.personalProjects || []).filter(
    (p) => p.Category === "💼 Work"
  );
  const workTaskRows = (life.tasks || []).filter((t) => t.Category === "💼 Work");
  const openCounts = openTaskCounts(life);
  const withOpenCount = (p) => ({
    ...stripKeepId(p),
    openTaskCount: openCounts.get(p._notionId) || 0,
  });

  // --- Events / trips inside the month span. Trips overlap-match on their span.
  const tripStart = (t) => String(t.Date || t.Start || t["Start Date"] || "").slice(0, 10);
  const tripEnd = (t) => String(t["Date End"] || t.End || t["End Date"] || tripStart(t)).slice(0, 10);
  const events = (plan.events || [])
    .filter((e) => inRange(String(e.Date || "").slice(0, 10), start, end))
    .sort((a, b) => String(a.Date).localeCompare(String(b.Date)))
    .map(strip);
  const trips = (plan.trips || [])
    .filter((t) => tripStart(t) && tripStart(t) <= end && tripEnd(t) >= start)
    .sort((a, b) => tripStart(a).localeCompare(tripStart(b)))
    .map(strip);

  return {
    generatedAt: new Date().toISOString(),
    dataPulledAt:
      (life._meta && (life._meta.pulledAt || life._meta.pulled_at)) || null,
    month: {
      number: mm,
      title: monthRecord.Month,
      notionId: monthNotionId,
      start,
      end,
    },
    weeks,
    // _notionId kept: /plan-month writes AI lanes + Status to these rows.
    plans: {
      personal: stripKeepId(byMonth(life.personalMonthlyPlans, monthNotionId)),
      work: stripKeepId(byMonth(life.workMonthlyPlans, monthNotionId)),
    },
    priorMonth: priorRecord
      ? {
          number: mm - 1,
          title: priorRecord.Month,
          plans: {
            personal: strip(byMonth(life.personalMonthlyPlans, priorNotionId)),
            work: strip(byMonth(life.workMonthlyPlans, priorNotionId)),
          },
          recaps: {
            personal: strip(byMonth(summaries.personalMonthlyRecap, priorNotionId)),
            work: strip(byMonth(summaries.workMonthlyRecap, priorNotionId)),
          },
        }
      : null,
    events,
    trips,
    upcoming: upcomingEventsTrips(plan, end, LOOKAHEAD_DAYS),
    inputs: {
      goals: (life.goals || [])
        .filter((g) => !GOAL_CLOSED.has(g.Status))
        .map(stripKeepId),
      themes: (life.themes || []).map(strip),
      personalProjects: (life.personalProjects || [])
        .filter((p) => p.Category !== "💼 Work" && p.Status !== "🟢 Done")
        .map(withOpenCount),
      undatedBacklog: undatedBacklog(life),
      workProjects: {
        pulledAt: life._meta ? life._meta.pulledAt : null,
        projects: workProjectRows
          .filter((p) => p.Status === "🔵 Doing" || p.Status === "🔴 To Do")
          .map(withOpenCount),
      },
      // Open tickets: due inside the month, or undated and unsettled.
      workTickets: {
        pulledAt: life._meta ? life._meta.pulledAt : null,
        tickets: workTaskRows
          .filter(
            (t) =>
              (inRange(t["Due Date"], start, end) && !SETTLED.has(t.Status)) ||
              (!t["Due Date"] && !SETTLED.has(t.Status))
          )
          .map(stripKeepId),
      },
    },
  };
}

function parseMonthArg(arg) {
  const mm = Number.parseInt(arg, 10);
  return Number.isInteger(mm) && mm >= 1 && mm <= 12 ? mm : null;
}

function main() {
  const mm = parseMonthArg(process.argv[2]);
  if (!mm) {
    process.stderr.write(
      `usage: yarn --silent month:bundle <mm>  (mm must be an integer 1..12, got ${JSON.stringify(process.argv[2])})\n`
    );
    process.exit(1);
  }
  try {
    process.stdout.write(JSON.stringify(buildMonthBundle(mm), null, 2) + "\n");
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { buildMonthBundle, parseMonthArg, pad2 };

if (require.main === module) {
  main();
}
