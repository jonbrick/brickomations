#!/usr/bin/env node
/**
 * daily-records.js — upsert vault daily notes into the Notion 📋 Daily Records DB.
 *
 * The one vault → Notion pipe (everything else flows Notion → vault). Thin by
 * design — a row is plumbing proof, not content:
 *
 *   Day            title      "2026-08-22 Saturday" (the daily-note filename)
 *   Date           date       2026-08-22 — one row per day; the date is the identity
 *   Source         rich_text  vault-relative note path
 *   Synced         date       when this row was written
 *   ⏰ 2026 Weeks  relation   the week containing the date (from data/plan.json)
 *
 * Runs as the last `yarn sync` step. Fixed yesterday→tomorrow window — the
 * sync-wide backfill window (--from/--to) is deliberately NOT forwarded to this
 * step: Daily Records doesn't backfill. Rows exist only for days whose notes
 * existed while the window passed over them. A note that appears late (e.g. a
 * /log-day backfill of yesterday) is picked up by the next 2-hourly run.
 *
 * Write-once + idempotent: an existing row for a date is never touched, so a
 * second run reports 0 created. Within the window a missing note is a skip,
 * not an error (tomorrow's note never exists yet). With an explicit --date the
 * missing note IS an error — you asked for that day specifically.
 *
 * Usage:
 *   node cli/daily-records.js --auto             # yesterday..tomorrow, lenient
 *   node cli/daily-records.js --date=YYYY-MM-DD  # one day, fail loud
 *   node cli/daily-records.js --dry-run          # either mode, no writes
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const os = require("os");

const config = require("../src/config");
const NotionDatabase = require("../src/databases/NotionDatabase");
const { delay } = require("../src/utils/async");

const VAULT_DIR = path.join(os.homedir(), "projects", "brickocampus");
const DATA_DIR = path.join(os.homedir(), "projects", "brickomations", "data");

// Rolls each year with the Weeks DB (generate-year recreates it as "⏰ 2027
// Weeks" etc.); the create call fails loud on an unknown property name, so a
// stale name can't write a bad row.
const WEEKS_RELATION_PROPERTY = "⏰ 2026 Weeks";

// ---- args -------------------------------------------------------------

function parseArgs(argv) {
  const args = { date: null, auto: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--auto") args.auto = true;
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

/** dateISO ± n days, as YYYY-MM-DD (noon-UTC anchor sidesteps DST edges). */
function addDays(dateISO, n) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function readJson(filename) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) {
    throw new Error(`Required data file missing: ${p}. Run \`yarn sync\` first.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Find the daily note for a YYYY-MM-DD date (filename carries the weekday).
// Returns null when the note (or its month folder) doesn't exist.
function resolveNote(dateISO) {
  const year = dateISO.slice(0, 4);
  const yearMonth = dateISO.slice(0, 7);
  const dir = path.join(VAULT_DIR, "_daily", year, yearMonth);
  if (!fs.existsSync(dir)) return null;
  const match = fs.readdirSync(dir).find((f) => f.startsWith(`${dateISO} `) && f.endsWith(".md"));
  return match ? path.join(dir, match) : null;
}

// ---- per-day upsert ---------------------------------------------------

/** Returns "created" | "exists" | "skipped". Throws on strict-mode missing note. */
async function upsertDay(db, databaseId, plan, dateISO, { strict, dryRun }) {
  const notePath = resolveNote(dateISO);
  if (!notePath) {
    if (strict) throw new Error(`No daily note found for ${dateISO}`);
    console.log(`[daily-records] ${dateISO}: no note — skipped`);
    return "skipped";
  }

  // Write-once: an existing row for the date means done, not update.
  const existing = await db.queryDatabase(databaseId, {
    property: "Date",
    date: { equals: dateISO },
  });
  if (existing.length > 0) {
    console.log(`[daily-records] ${dateISO}: row exists — no changes`);
    return "exists";
  }

  const dayTitle = path.basename(notePath).replace(/\.md$/, "");
  const source = path.relative(VAULT_DIR, notePath);

  // Week relation target from the plan.json snapshot (refreshed by the pull
  // step earlier in the same sync run). A note without a covering week is a
  // real error — fail loud.
  const week = (plan.weeks || []).find(
    (w) => dateISO >= w["Date Range (SET)"] && dateISO <= w["Date Range (SET) End"]
  );
  if (!week || !week._notionId) {
    throw new Error(`No week covering ${dateISO} in plan.json. Run \`yarn sync\` first.`);
  }

  if (dryRun) {
    console.log(`[daily-records] ${dateISO}: DRY RUN — would create "${dayTitle}" (${week.Week})`);
    return "created";
  }

  // Raw client: NotionDatabase._formatProperties silently drops relation
  // properties (generate-year.js uses the same escape hatch).
  await db.client.pages.create({
    parent: { database_id: databaseId },
    properties: {
      Day: { title: [{ text: { content: dayTitle } }] },
      Date: { date: { start: dateISO } },
      Source: { rich_text: [{ text: { content: source } }] },
      Synced: { date: { start: new Date().toISOString() } },
      [WEEKS_RELATION_PROPERTY]: { relation: [{ id: week._notionId }] },
    },
  });
  await delay(config.sources.rateLimits.notion.backoffMs);

  console.log(`[daily-records] ${dateISO}: created (${week.Week})`);
  return "created";
}

// ---- main -------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const databaseId = config.notion.databases.dailyRecords;
  if (!databaseId) {
    throw new Error(
      "NOTION_DAILY_RECORDS_DATABASE_ID is required (Notion database ID of 📋 Daily Records)"
    );
  }

  let dates;
  let strict;
  if (args.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error(`invalid date arg: '${args.date}' (expected YYYY-MM-DD)`);
    }
    dates = [args.date];
    strict = true;
  } else {
    const today = todayET();
    dates = [addDays(today, -1), today, addDays(today, 1)];
    strict = false;
  }

  const plan = readJson("plan.json");
  const db = new NotionDatabase();

  const tally = { created: 0, exists: 0, skipped: 0 };
  for (const dateISO of dates) {
    const result = await upsertDay(db, databaseId, plan, dateISO, {
      strict,
      dryRun: args.dryRun,
    });
    tally[result]++;
  }

  console.log(
    `[daily-records] done${args.dryRun ? " (dry run)" : ""}: ` +
      `${tally.created} created, ${tally.exists} existing, ${tally.skipped} skipped`
  );
}

main().catch((err) => {
  console.error(`[daily-records] ${err.message}`);
  process.exitCode = 1;
});
