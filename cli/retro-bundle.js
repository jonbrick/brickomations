#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Retro bundle: emit one JSON object on stdout with all data /retro-week
 * needs for the given week — or, with --month, all data /recap-month needs
 * for the given month. Read-only against data/*.json.
 *
 * Contract: ~/projects/brickocampus/personal/projects/doing/Build retro-week data bundler/bundle-shape.md
 *
 * Usage: yarn --silent retro:bundle <wk>            (JSON on stdout)
 *        yarn --silent retro:bundle --month <mm>    (too big to paste —
 *          stages local/retro/month-bundle-<MM>.json, same as month:view)
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
const MONTHS_RELATION = "🗓️ 2026 Months";

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

// Day-level health logs (collected.json). Keep only the fields Beat 9 reads —
// the raw rows carry relation-ID arrays, formula strings and "⬇️" divider
// columns that bury the checkboxes past any terminal's output cutoff.
// Status is the DB's own formula over the five checkboxes (see
// src/utils/day-status.js); the boxes ride along for backfill writes.
const MEDS_FIELDS = [
  "Date",
  "Status",
  "AM Meds",
  "PM Meds",
  "AM Meds Skipped",
  "PM Meds Skipped",
  "No Meds",
];
const SUPPS_FIELDS = [
  "Date",
  "Status",
  "AM Supps",
  "PM Supps",
  "AM Supps Skipped",
  "PM Supps Skipped",
  "No Supps",
  "AM Skipped",
  "PM Skipped",
];

function healthRowsForWeek(rows, fields, start, end) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => inRange(r.Date, start, end))
    .sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0))
    .map((r) => Object.fromEntries(fields.map((f) => [f, r[f] ?? null])));
}

// Month mode (/recap-month). Same week-join model, sliced over the month's
// related weeks. Causal window: prior recaps are months < mm only. Bias
// isolation: the target month's My Recap is dropped unless its AI Recap is
// already filled (a revisit reads it only to keep Jon's anchors intact).
function buildMonthRetroBundle(mm) {
  const { findMonthRecord, byMonth } = require("./month-bundle");
  const plan = loadJson("plan.json");
  const summaries = loadJson("summaries.json");
  const retro = loadJson("retro.json");
  const life = loadJson("life.json");
  const journal = loadJson("journal.json");
  const linearTeam = loadJson("linearTeam.json");

  const monthRecord = findMonthRecord(plan, mm);
  if (!monthRecord) throw new Error(`month not found in plan.json: ${mm}`);
  const monthNotionId = monthRecord._notionId;

  const weekIds = new Set(monthRecord[WEEKS_RELATION] || []);
  const weeks = (plan.weeks || [])
    .filter((w) => weekIds.has(w._notionId))
    .sort((a, b) =>
      String(a["Date Range (SET)"]).localeCompare(String(b["Date Range (SET)"]))
    );
  if (!weeks.length) throw new Error(`month "${monthRecord.Month}" has no related weeks`);
  const start = weeks[0]["Date Range (SET)"];
  const end = weeks[weeks.length - 1]["Date Range (SET) End"];

  const forWeeks = (records) =>
    (Array.isArray(records) ? records : []).filter(
      (r) =>
        Array.isArray(r[WEEKS_RELATION]) &&
        r[WEEKS_RELATION].some((id) => weekIds.has(id))
    );
  const byDate = (key) => (a, b) => String(a[key]).localeCompare(String(b[key]));

  const rocks = forWeeks(plan.rocks);
  // Roll Up formulas duplicate their snapshot twins; the What-X snapshots
  // duplicate the weekly retros already in the bundle.
  const recapFor = (records) => {
    const rec = byMonth(records, monthNotionId);
    if (!rec) return null;
    const out = strip(rec);
    for (const k of Object.keys(out)) {
      if (k.endsWith(" Roll Up") || /^(AI|My) What /.test(k) || k === MONTHS_RELATION) {
        delete out[k];
      }
    }
    if (!out["AI Recap"]) delete out["My Recap"];
    return out;
  };
  // Weekly retros: the free-text columns + habits; block/task Roll Ups
  // duplicate the weekly summaries.
  const retroSlim = (r) =>
    Object.fromEntries(
      Object.entries(strip(r)).filter(
        ([k]) => !k.endsWith(" Roll Up") || k === "Weekly Habits Roll Up"
      )
    );
  const pick = (fields) => (r) =>
    Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, r[f]]));
  const priorMonths = Array.from({ length: mm - 1 }, (_, i) =>
    findMonthRecord(plan, i + 1)
  ).filter(Boolean);
  const priorAiRecaps = (records) =>
    priorMonths
      .map((m) => byMonth(records, m._notionId))
      .filter((r) => r && r["AI Recap"])
      .map((r) => ({ "Month Recap": r["Month Recap"], "AI Recap": r["AI Recap"] }));
  const lastMonth = priorMonths[priorMonths.length - 1];
  const lastMyRecap = (records) => {
    const r = lastMonth ? byMonth(records, lastMonth._notionId) : null;
    return r && r["My Recap"] ? { "Month Recap": r["Month Recap"], "My Recap": r["My Recap"] } : null;
  };

  return {
    month: {
      number: mm,
      title: monthRecord.Month,
      notionId: monthNotionId,
      start,
      end,
      weeks: weeks.map((w) => ({
        title: w.Week,
        start: w["Date Range (SET)"],
        end: w["Date Range (SET) End"],
      })),
    },
    plans: {
      personal: strip(byMonth(life.personalMonthlyPlans, monthNotionId)),
      work: strip(byMonth(life.workMonthlyPlans, monthNotionId)),
    },
    rocks: {
      personal: rocks.filter((r) => r.Category !== "💼 Work").map(strip),
      work: rocks.filter((r) => r.Category === "💼 Work").map(strip),
    },
    events: forWeeks(plan.events)
      .sort(byDate("Date"))
      .map(pick(["Event Name", "Date", "Date End", "Status", "Category", "PERSONAL Category", "WORK Category", "Notes"])),
    trips: forWeeks(plan.trips)
      .sort(byDate("Date"))
      .map(pick(["Trip Name", "Date", "Date End", "Status", "Category", "Subcategory", "Notes"])),
    summaries: {
      personal: forWeeks(summaries.personalWeekly).map(strip),
      work: forWeeks(summaries.workWeekly).map(strip),
    },
    retros: {
      personal: forWeeks(retro.personalWeekly).sort(byDate("Date")).map(retroSlim),
      work: forWeeks(retro.workWeekly).sort(byDate("Date")).map(retroSlim),
    },
    recap: {
      personal: recapFor(summaries.personalMonthlyRecap),
      work: recapFor(summaries.workMonthlyRecap),
    },
    priorRecaps: {
      personal: priorAiRecaps(summaries.personalMonthlyRecap),
      work: priorAiRecaps(summaries.workMonthlyRecap),
      lastMyRecap: {
        personal: lastMyRecap(summaries.personalMonthlyRecap),
        work: lastMyRecap(summaries.workMonthlyRecap),
      },
    },
    tasks: (life.tasks || [])
      .filter((t) => inRange(t["Due Date"], start, end))
      .sort(byDate("Due Date"))
      .map(pick(["Task", "Due Date", "Status", "Category", "PERSONAL Category", "WORK Category", "Description"])),
    projectUpdates: Array.isArray(linearTeam.projectUpdates)
      ? linearTeam.projectUpdates
          .filter((u) => inRange(u.Date, start, end))
          .sort((a, b) => a["Created At"].localeCompare(b["Created At"]))
      : null,
    journal: (journal.entries || []).filter((e) => inRange(e.date, start, end)),
  };
}

function main() {
  if (process.argv[2] === "--month") {
    const mmArg = process.argv[3];
    const mm = Number.parseInt(mmArg, 10);
    if (!Number.isInteger(mm) || mm < 1 || mm > 12) {
      process.stderr.write(
        `usage: yarn retro:bundle --month <mm>  (mm must be an integer 1..12, got ${JSON.stringify(mmArg)})\n`
      );
      process.exit(1);
    }
    try {
      const bundle = buildMonthRetroBundle(mm);
      const rel = `local/retro/month-bundle-${String(mm).padStart(2, "0")}.json`;
      const out = path.join(__dirname, "..", rel);
      require("fs").mkdirSync(path.dirname(out), { recursive: true });
      require("fs").writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");
      process.stdout.write(
        `[retro month bundle staged → ${rel}] ${bundle.month.title} · ${bundle.month.start} → ${bundle.month.end} · ` +
          `${bundle.month.weeks.length} weeks · ${bundle.retros.personal.length}+${bundle.retros.work.length} retros · ` +
          `${bundle.journal.length} journal · ${bundle.tasks.length} tasks\n`
      );
    } catch (err) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    return;
  }

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
  const collected = loadJson("collected.json");
  const linearTeam = loadJson("linearTeam.json");

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
  const medications = healthRowsForWeek(
    collected.medications,
    MEDS_FIELDS,
    start,
    end
  );
  const supplements = healthRowsForWeek(
    collected.supplements,
    SUPPS_FIELDS,
    start,
    end
  );
  // Linear project-update posts dated inside the week (pull-linear's local
  // team cache; every author, `Mine` flags Jon's own). null = the cache
  // predates the key — rerun yarn pull:linear on the mini; [] = a week
  // with no posts.
  const projectUpdates = Array.isArray(linearTeam.projectUpdates)
    ? linearTeam.projectUpdates
        .filter((u) => inRange(u.Date, start, end))
        .sort((a, b) => a["Created At"].localeCompare(b["Created At"]))
    : null;

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
    projectUpdates,
    journal: journalEntries,
    medications,
    supplements,
  };

  process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
}

main();
