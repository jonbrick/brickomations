#!/usr/bin/env node
/**
 * daily-records.js — mirror vault daily notes into the Notion 📋 Daily Records DB.
 *
 * The one vault → Notion pipe (everything else flows Notion → vault). The
 * definition of done is "what's in Obsidian is what's in Notion": each row's
 * page body carries the note's ENTIRE markdown, verbatim. Dumb by design —
 * no rendering, no conversion, no stripping. Notion shows markdown source;
 * that's the point (the mirror is pipeline, not cosmetics, and LLM readers
 * prefer raw markdown anyway).
 *
 * Row properties stay thin:
 *
 *   Day            title      "2026-08-22 Saturday" (the daily-note filename)
 *   Date           date       2026-08-22 — one row per day; the date is the identity
 *   Source         rich_text  vault-relative note path
 *   Synced         date       when the mirror last wrote this row's body
 *   ⏰ 2026 Weeks  relation   the week containing the date (from data/plan.json)
 *
 * Mirror-on-change: a row is created with the body on first sight; after that
 * the body is re-uploaded only when the note file's mtime is newer than the
 * row's Synced. One-way and Notion-read-only: anything edited in the Notion
 * copy is clobbered on the next re-mirror.
 *
 * Runs as the last `yarn sync` step. Fixed yesterday→tomorrow window — the
 * sync-wide backfill window (--from/--to) is deliberately NOT forwarded to
 * this step. A note edited outside the window heals with an explicit --date,
 * which always re-mirrors (no freshness check) and fails loud on a missing
 * note.
 *
 * Usage:
 *   node cli/daily-records.js --auto             # yesterday..tomorrow, mirror-on-change
 *   node cli/daily-records.js --date=YYYY-MM-DD  # one day, forced re-mirror, fail loud
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

// Notion caps a rich_text payload at 2000 chars; chunk under it so a block
// boundary never lands mid-word on the limit itself.
const BLOCK_CHAR_LIMIT = 1900;
// Notion caps children per create/append call.
const BLOCKS_PER_CALL = 100;

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

// ---- markdown → verbatim paragraph blocks ------------------------------

function paragraphBlock(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

/** Split raw markdown into verbatim paragraph blocks under the char limit,
 *  breaking only on line boundaries (hard-splitting a single over-limit line). */
function toBlocks(markdown) {
  const chunks = [];
  let buf = "";
  const push = () => {
    if (buf.length > 0) chunks.push(buf);
    buf = "";
  };
  for (let line of markdown.split("\n")) {
    while (line.length > BLOCK_CHAR_LIMIT) {
      push();
      chunks.push(line.slice(0, BLOCK_CHAR_LIMIT));
      line = line.slice(BLOCK_CHAR_LIMIT);
    }
    if (buf.length + line.length + 1 > BLOCK_CHAR_LIMIT) push();
    buf = buf.length > 0 ? `${buf}\n${line}` : line;
  }
  push();
  return chunks.map(paragraphBlock);
}

// ---- Notion body ops (raw client — NotionDatabase has no block methods,
// and its _formatProperties silently drops relation payloads) -------------

async function appendBody(client, pageId, blocks) {
  for (let i = 0; i < blocks.length; i += BLOCKS_PER_CALL) {
    await client.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + BLOCKS_PER_CALL),
    });
    await delay(config.sources.rateLimits.notion.backoffMs);
  }
}

async function replaceBody(client, pageId, blocks) {
  const existingIds = [];
  let cursor;
  do {
    const resp = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    existingIds.push(...resp.results.map((b) => b.id));
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  for (const id of existingIds) {
    await client.blocks.delete({ block_id: id });
    await delay(config.sources.rateLimits.notion.backoffMs);
  }
  await appendBody(client, pageId, blocks);
}

// ---- per-day mirror -----------------------------------------------------

/** Returns "created" | "updated" | "fresh" | "skipped".
 *  force = re-mirror regardless of freshness + fail loud on a missing note. */
async function mirrorDay(db, databaseId, plan, dateISO, { force, dryRun }) {
  const notePath = resolveNote(dateISO);
  if (!notePath) {
    if (force) throw new Error(`No daily note found for ${dateISO}`);
    console.log(`[daily-records] ${dateISO}: no note — skipped`);
    return "skipped";
  }

  const markdown = fs.readFileSync(notePath, "utf8");
  const mtime = fs.statSync(notePath).mtime;
  const blocks = toBlocks(markdown);
  const dayTitle = path.basename(notePath).replace(/\.md$/, "");
  const source = path.relative(VAULT_DIR, notePath);
  const syncedNow = { Synced: { date: { start: new Date().toISOString() } } };

  const existing = await db.queryDatabase(databaseId, {
    property: "Date",
    date: { equals: dateISO },
  });

  if (existing.length > 0) {
    const page = existing[0];
    const syncedAt = page.properties?.Synced?.date?.start;
    const stale = force || !syncedAt || mtime > new Date(syncedAt);
    if (!stale) {
      console.log(`[daily-records] ${dateISO}: fresh — no changes`);
      return "fresh";
    }
    if (dryRun) {
      console.log(`[daily-records] ${dateISO}: DRY RUN — would re-mirror (${blocks.length} blocks)`);
      return "updated";
    }
    await replaceBody(db.client, page.id, blocks);
    await db.client.pages.update({ page_id: page.id, properties: syncedNow });
    await delay(config.sources.rateLimits.notion.backoffMs);
    console.log(`[daily-records] ${dateISO}: re-mirrored (${blocks.length} blocks)`);
    return "updated";
  }

  // New row. Week relation target comes from the plan.json snapshot
  // (refreshed by the pull step earlier in the same sync run).
  const week = (plan.weeks || []).find(
    (w) => dateISO >= w["Date Range (SET)"] && dateISO <= w["Date Range (SET) End"]
  );
  if (!week || !week._notionId) {
    throw new Error(`No week covering ${dateISO} in plan.json. Run \`yarn sync\` first.`);
  }

  if (dryRun) {
    console.log(
      `[daily-records] ${dateISO}: DRY RUN — would create "${dayTitle}" (${week.Week}, ${blocks.length} blocks)`
    );
    return "created";
  }

  const page = await db.client.pages.create({
    parent: { database_id: databaseId },
    properties: {
      Day: { title: [{ text: { content: dayTitle } }] },
      Date: { date: { start: dateISO } },
      Source: { rich_text: [{ text: { content: source } }] },
      ...syncedNow,
      [WEEKS_RELATION_PROPERTY]: { relation: [{ id: week._notionId }] },
    },
    children: blocks.slice(0, BLOCKS_PER_CALL),
  });
  await delay(config.sources.rateLimits.notion.backoffMs);
  if (blocks.length > BLOCKS_PER_CALL) {
    await appendBody(db.client, page.id, blocks.slice(BLOCKS_PER_CALL));
  }

  console.log(`[daily-records] ${dateISO}: created (${week.Week}, ${blocks.length} blocks)`);
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
  let force;
  if (args.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      throw new Error(`invalid date arg: '${args.date}' (expected YYYY-MM-DD)`);
    }
    dates = [args.date];
    force = true;
  } else {
    const today = todayET();
    dates = [addDays(today, -1), today, addDays(today, 1)];
    force = false;
  }

  const plan = readJson("plan.json");
  const db = new NotionDatabase();

  const tally = { created: 0, updated: 0, fresh: 0, skipped: 0 };
  for (const dateISO of dates) {
    const result = await mirrorDay(db, databaseId, plan, dateISO, {
      force,
      dryRun: args.dryRun,
    });
    tally[result]++;
  }

  console.log(
    `[daily-records] done${args.dryRun ? " (dry run)" : ""}: ` +
      `${tally.created} created, ${tally.updated} updated, ${tally.fresh} fresh, ${tally.skipped} skipped`
  );
}

main().catch((err) => {
  console.error(`[daily-records] ${err.message}`);
  process.exitCode = 1;
});
