#!/usr/bin/env node
/**
 * One-time migration (Fri 2026-10-16): move 🎟️ 2026 Events and ✈️ 2026 Trips
 * onto the two-field category model Tasks / Projects / Big Rocks adopted on
 * 2026-08-16 — `Category` becomes the binary side (💼 Work / 🌱 Personal /
 * 🫥 N/A), the lane moves into `PERSONAL Category` or `WORK Category`.
 *
 * Reads live rows, classifies each from its current Category + Subcategory
 * (+ a few by-name overrides), and writes only the rows that need to change.
 * Idempotent — a second run is a no-op.
 *
 * Default is dry-run. Pass --apply to write to Notion.
 *   node scripts/migrate-events-trips-categories.js
 *   node scripts/migrate-events-trips-categories.js --apply
 *
 * Schema prerequisites (done via Notion MCP before the first --apply):
 *   Events: `PERSONAL Category` (7 lanes), `Work Category` → `WORK Category` (7 lanes)
 *   Trips:  `PERSONAL Category`, `WORK Category`
 */

require("dotenv").config();
const { Client } = require("@notionhq/client");

const TOKEN = process.env.NOTION_TOKEN;
const DBS = {
  events: process.env.NOTION_EVENTS_DATABASE_ID,
  trips: process.env.NOTION_TRIPS_DATABASE_ID,
};

const WORK = "💼 Work";
const PERSONAL = "🌱 Personal";
const NA = "🫥 N/A";

// Old flat lanes that lived in `Category` — same strings as the new lane field.
const FLAT_LANES = new Set([
  "🍻 Interpersonal",
  "🏠 Home",
  "💪 Physical Health",
  "❤️ Mental Health",
]);

// Personal lane by Events Subcategory (for rows already on plain 🌱 Personal).
const EVENT_SUB_TO_PERSONAL_LANE = {
  "🏈 Sports Event": "🎸 Hobbies",
  "🎸 Concerts": "🎸 Hobbies",
  "🎭 Comedy": "🎸 Hobbies",
  "🏛️ Museums & Tours": "🎸 Hobbies",
  "♣️ Tattoo": "🎸 Hobbies",
  "🩺 Medical": "💪 Physical Health",
  "🤒 Sick": "💪 Physical Health",
  "🏋️‍♀️ Personal Training": "💪 Physical Health",
  "🏃 Race": "💪 Physical Health",
  "🧗 Adventures": "💪 Physical Health",
  "🕶️ Shopping & Styling": "💪 Physical Health", // both live rows are tattoo removal
  "🍻 Friend Event": "🍻 Interpersonal",
  "💜 Family Event": "🍻 Interpersonal",
  "🗽 Friends & Fam visit NYC": "🍻 Interpersonal",
  "💒 Wedding": "🍻 Interpersonal",
  "❤️ Relationship": "🍻 Interpersonal",
  "🎄 Family Holidays": "🍻 Interpersonal",
  "🏝️ Vacation": "🍻 Interpersonal",
  "🏠 Home Updates": "🏠 Home",
  "📣 Protest": "🌱 Admin",
  "🗳️ Volunteer & Vote": "🌱 Admin",
  "🏁 Project Completion": "🌱 Admin",
  "😔 Wasted Day": "❤️ Mental Health",
};

// Work lane by Events Subcategory.
const EVENT_SUB_TO_WORK_LANE = {
  "🏝️ Work OOO": "💼 Admin",
  "😎 Work Remote": "💼 Admin",
  "💼 Work Event": "💼 Admin",
  "🚀 Work Milestone": "💼 Admin",
  "🏟️ Work Conferences & Events": "💡 Exploration",
  "🍸 Work Social": "🤝 Hiring & Team",
};
// Work rows with no Subcategory are the staffing rows (last days, returns).
const WORK_NO_SUB_LANE = "🤝 Hiring & Team";

// By-name overrides (exact title match) — the handful the Subcategory can't settle.
const NAME_OVERRIDES = {
  "Jason Woo start": "🤝 Hiring & Team",
  "Product Definition Review: Tabular View": "🎨 Design",
  "Tax Day": "🌱 Admin",
};

// Trips: personal lane by Subcategory (multi-select; first match wins).
const TRIP_SUB_TO_PERSONAL_LANE = {
  "🍻 Friends Trip": "🍻 Interpersonal",
  "💜 Family Trip": "🍻 Interpersonal",
  "🎄 Family Holidays": "🍻 Interpersonal",
  "💒 Wedding": "🍻 Interpersonal",
  "🌱 Personal Trip": "🎸 Hobbies",
  "🧗‍♀️ Adventure": "🎸 Hobbies",
};
const TRIP_WORK_LANE = "💡 Exploration";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sel(page, name) {
  const p = page.properties[name];
  if (!p) return null;
  if (p.type === "select") return p.select ? p.select.name : null;
  if (p.type === "status") return p.status ? p.status.name : null;
  if (p.type === "multi_select") return p.multi_select.map((o) => o.name);
  return null;
}
function title(page, name) {
  const p = page.properties[name];
  return p && p.title ? p.title.map((t) => t.plain_text).join("") : "";
}
function dateOf(page) {
  const p = page.properties.Date;
  return p && p.date ? p.date.start : "";
}

async function queryAll(client, databaseId) {
  const out = [];
  let cursor;
  do {
    const res = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
    await sleep(350);
  } while (cursor);
  return out;
}

/** → { Category?, "PERSONAL Category"?, "WORK Category"? } or null (no change) */
function classifyEvent(page) {
  const name = title(page, "Event Name");
  const cat = sel(page, "Category");
  const sub = sel(page, "Subcategory");
  const override = NAME_OVERRIDES[name];

  if (cat === NA) return { target: null, reason: "N/A stays" };

  if (cat === WORK) {
    const lane = override || (sub ? EVENT_SUB_TO_WORK_LANE[sub] : WORK_NO_SUB_LANE);
    if (!lane) return { target: null, reason: `UNMAPPED work sub ${sub}` };
    return { target: { "WORK Category": lane } };
  }

  if (FLAT_LANES.has(cat)) {
    return { target: { Category: PERSONAL, "PERSONAL Category": cat } };
  }

  if (cat === PERSONAL) {
    const lane = override || (sub ? EVENT_SUB_TO_PERSONAL_LANE[sub] : null);
    if (!lane) return { target: null, reason: `UNMAPPED personal sub ${sub}` };
    return { target: { "PERSONAL Category": lane } };
  }

  return { target: null, reason: `UNMAPPED category ${cat}` };
}

function classifyTrip(page) {
  const cat = sel(page, "Category");
  const subs = sel(page, "Subcategory") || [];

  if (cat === WORK) return { target: { "WORK Category": TRIP_WORK_LANE } };

  if (FLAT_LANES.has(cat)) {
    return { target: { Category: PERSONAL, "PERSONAL Category": cat } };
  }

  if (cat === PERSONAL) {
    const lane = subs.map((s) => TRIP_SUB_TO_PERSONAL_LANE[s]).find(Boolean);
    if (!lane) return { target: null, reason: `UNMAPPED trip subs ${subs.join("|")}` };
    return { target: { "PERSONAL Category": lane } };
  }

  return { target: null, reason: `UNMAPPED category ${cat}` };
}

/** Drop keys already at their target so a re-run is a no-op. */
function diff(page, target) {
  const out = {};
  for (const [k, v] of Object.entries(target)) {
    if (sel(page, k) !== v) out[k] = v;
  }
  return out;
}

async function run(client, kind, titleProp, classify, apply) {
  const pages = await queryAll(client, DBS[kind]);
  const plan = [];
  const unmapped = [];
  const laneCounts = {};

  for (const page of pages) {
    const name = title(page, titleProp);
    const { target, reason } = classify(page);
    if (!target) {
      if (reason && reason.startsWith("UNMAPPED")) unmapped.push(`${name}: ${reason}`);
      continue;
    }
    const changes = diff(page, target);
    const lane = target["PERSONAL Category"] || target["WORK Category"];
    laneCounts[lane] = (laneCounts[lane] || 0) + 1;
    if (Object.keys(changes).length === 0) continue;
    plan.push({ id: page.id, name, date: dateOf(page), from: sel(page, "Category"), changes });
  }

  console.log(`\n=== ${kind.toUpperCase()} — ${pages.length} rows, ${plan.length} to update ===`);
  for (const p of plan) {
    const to = Object.entries(p.changes).map(([k, v]) => `${k}=${v}`).join("  ");
    console.log(`  ${p.date || "          "}  ${p.name.padEnd(44).slice(0, 44)}  ${String(p.from).padEnd(20)} → ${to}`);
  }
  console.log(`  lanes: ${Object.entries(laneCounts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (unmapped.length) {
    console.log(`  ⚠️  UNMAPPED (${unmapped.length}):`);
    for (const u of unmapped) console.log(`     ${u}`);
  }

  if (!apply) return { updated: 0, unmapped: unmapped.length };

  let updated = 0;
  for (const p of plan) {
    const properties = {};
    for (const [k, v] of Object.entries(p.changes)) properties[k] = { select: { name: v } };
    await client.pages.update({ page_id: p.id, properties });
    updated++;
    if (updated % 25 === 0) console.log(`  … ${updated}/${plan.length}`);
    await sleep(350);
  }
  console.log(`  ✓ updated ${updated}`);
  return { updated, unmapped: unmapped.length };
}

async function main() {
  if (!TOKEN || !DBS.events || !DBS.trips) {
    console.error("Missing NOTION_TOKEN / NOTION_EVENTS_DATABASE_ID / NOTION_TRIPS_DATABASE_ID");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  console.log(apply ? "APPLY mode — writing to Notion" : "DRY RUN — pass --apply to write");
  const client = new Client({ auth: TOKEN });

  const e = await run(client, "events", "Event Name", classifyEvent, apply);
  const t = await run(client, "trips", "Trip Name", classifyTrip, apply);

  const unmapped = e.unmapped + t.unmapped;
  console.log(`\nDone. updated ${e.updated + t.updated} · unmapped ${unmapped}`);
  if (unmapped) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
