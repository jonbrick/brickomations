#!/usr/bin/env node
/**
 * Events restructure, step 1 (Fri 2026-10-16): the five work *types* move from
 * `Subcategory` into `WORK Category`, so `Subcategory` can become the
 * personal-type column (renamed to `PERSONAL Category`, same property id, so
 * the Weeks DB rollup formulas keep working).
 *
 * For every 💼 Work event: WORK Category ← Subcategory when Subcategory is one
 * of the five work types. Rows with no Subcategory (the staffing rows) are
 * reported and left blank — Jon's pick. Idempotent.
 *
 * Prerequisite (Notion MCP, before --apply): `WORK Category` re-optioned to
 * the five work types; that ALTER clears the old 7-lane values on its own.
 *
 *   node scripts/move-event-work-types.js            # dry run
 *   node scripts/move-event-work-types.js --apply
 */

require("dotenv").config();
const { Client } = require("@notionhq/client");

const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_EVENTS_DATABASE_ID;
const WORK = "💼 Work";

const WORK_TYPES = new Set([
  "🏟️ Work Conferences & Events",
  "🍸 Work Social",
  "🏝️ Work OOO",
  "🚀 Work Milestone",
  "😎 Work Remote",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = (p, n) => (p.properties[n] && p.properties[n].select ? p.properties[n].select.name : null);
const title = (p) => (p.properties["Event Name"].title || []).map((t) => t.plain_text).join("");
const dateOf = (p) => (p.properties.Date && p.properties.Date.date ? p.properties.Date.date.start : "");

async function queryAll(client) {
  const out = [];
  let cursor;
  do {
    const res = await client.databases.query({ database_id: DB, start_cursor: cursor, page_size: 100 });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
    await sleep(350);
  } while (cursor);
  return out;
}

async function main() {
  if (!TOKEN || !DB) {
    console.error("Missing NOTION_TOKEN / NOTION_EVENTS_DATABASE_ID");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode — writing to Notion" : "DRY RUN — pass --apply to write");
  const client = new Client({ auth: TOKEN });
  const pages = await queryAll(client);

  const plan = [];
  const blank = [];
  const already = [];
  const stray = [];
  for (const p of pages) {
    const cat = sel(p, "Category");
    const sub = sel(p, "Subcategory");
    const cur = sel(p, "WORK Category");
    if (cat !== WORK) {
      if (sub && WORK_TYPES.has(sub)) stray.push(`${dateOf(p)}  ${title(p)}  (${cat} · ${sub})`);
      continue;
    }
    if (!sub || !WORK_TYPES.has(sub)) {
      blank.push(`${dateOf(p)}  ${title(p)}  (Subcategory: ${sub || "—"} · WORK Category now: ${cur || "—"})`);
      continue;
    }
    if (cur === sub) {
      already.push(title(p));
      continue;
    }
    plan.push({ id: p.id, name: title(p), date: dateOf(p), from: cur, to: sub });
  }

  console.log(`\n💼 Work rows: ${plan.length + blank.length + already.length}`);
  console.log(`\n→ set WORK Category from Subcategory (${plan.length}):`);
  for (const r of plan.sort((a, b) => a.date.localeCompare(b.date)))
    console.log(`  ${r.date}  ${r.name.padEnd(42).slice(0, 42)}  ${String(r.from || "—").padEnd(18)} → ${r.to}`);
  const counts = {};
  for (const r of plan) counts[r.to] = (counts[r.to] || 0) + 1;
  console.log(`  by type: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`\n⚠️  left blank — no work-type Subcategory (${blank.length}):`);
  for (const b of blank) console.log(`  ${b}`);
  if (already.length) console.log(`\n= already set (${already.length})`);
  if (stray.length) {
    console.log(`\n⚠️  non-work rows carrying a work type (${stray.length}):`);
    for (const s of stray) console.log(`  ${s}`);
  }

  if (!apply) return;
  let n = 0;
  for (const r of plan) {
    await client.pages.update({ page_id: r.id, properties: { "WORK Category": { select: { name: r.to } } } });
    n++;
    await sleep(350);
  }
  console.log(`\n✓ updated ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
