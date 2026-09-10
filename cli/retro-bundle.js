#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Retro bundle: emit one JSON object on stdout with all data /retro-week
 * needs for the given week. Read-only against data/*.json.
 *
 * Contract: ~/projects/brickocampus/personal/projects/doing/Build retro-week data bundler/bundle-shape.md
 *
 * Usage: yarn retro:bundle <wk>
 */

const path = require("path");

const PLUMBING_KEYS = new Set([
  "_notionId",
  "_lastPulled",
  "_notionEditedTime",
  "_titleKey",
  "_propertyTypes",
  "_hash",
]);

const WEEKS_RELATION = "⏰ 2026 Weeks";

function strip(record) {
  if (!record || typeof record !== "object") return record;
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (!PLUMBING_KEYS.has(k)) out[k] = v;
  }
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

function loadJson(name) {
  return require(path.join(__dirname, "..", "data", name));
}

function main() {
  const wkArg = process.argv[2];
  const wk = Number.parseInt(wkArg, 10);
  if (!Number.isInteger(wk) || wk < 1 || wk > 53) {
    process.stderr.write(
      `usage: yarn retro:bundle <wk>  (wk must be an integer 1..53, got ${JSON.stringify(wkArg)})\n`
    );
    process.exit(1);
  }

  const plan = loadJson("plan.json");
  const summaries = loadJson("summaries.json");
  const retro = loadJson("retro.json");
  const life = loadJson("life.json");
  const journal = loadJson("journal.json");

  // plan.json week titles are zero-padded ("Week 08")
  const weekTitle = `Week ${String(wk).padStart(2, "0")}`;
  const weekRecord = plan.weeks.find((w) => w.Week === weekTitle);
  if (!weekRecord) {
    process.stderr.write(`week not found in plan.json: "${weekTitle}"\n`);
    process.exit(1);
  }
  const weekNotionId = weekRecord._notionId;
  const start = weekRecord["Date Range (SET)"];
  const end = weekRecord["Date Range (SET) End"];
  if (!start || !end) {
    process.stderr.write(
      `week "${weekTitle}" missing Date Range (SET) / Date Range (SET) End\n`
    );
    process.exit(1);
  }

  const rocksForWeek = joinByWeek(plan.rocks, weekNotionId);
  const personalRocks = rocksForWeek
    .filter((r) => r.Category !== "💼 Work")
    .map(strip);
  const workRocks = rocksForWeek
    .filter((r) => r.Category === "💼 Work")
    .map(strip);

  const events = joinByWeek(plan.events, weekNotionId).map(strip);
  const trips = joinByWeek(plan.trips, weekNotionId).map(strip);

  const personalSummary = joinByWeek(summaries.personalWeekly, weekNotionId)[0];
  const workSummary = joinByWeek(summaries.workWeekly, weekNotionId)[0];

  const personalRetro = joinByWeek(retro.personalWeekly, weekNotionId)[0];
  const workRetro = joinByWeek(retro.workWeekly, weekNotionId)[0];

  const habits = joinByWeek(life.habits, weekNotionId).map(strip);
  const habitsPlan =
    joinByWeek(life.habitsPlan, weekNotionId).map(strip)[0] || null;
  const workPlan =
    joinByWeek(life.workWeeksPlan, weekNotionId).map(strip)[0] || null;
  const tasks = (life.tasks || [])
    .filter((t) => inRange(t["Due Date"], start, end))
    .map(strip);
  const journalEntries = (journal.entries || []).filter((e) =>
    inRange(e.date, start, end)
  );

  const bundle = {
    week: {
      number: wk,
      notionId: weekNotionId,
      start,
      end,
    },
    rocks: {
      personal: personalRocks,
      work: workRocks,
    },
    events,
    trips,
    summaries: {
      personal: personalSummary ? strip(personalSummary) : null,
      work: workSummary ? strip(workSummary) : null,
    },
    retros: {
      personal: personalRetro ? strip(personalRetro) : null,
      work: workRetro ? strip(workRetro) : null,
    },
    habits,
    habitsPlan,
    workPlan,
    tasks,
    journal: journalEntries,
  };

  process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
}

main();
