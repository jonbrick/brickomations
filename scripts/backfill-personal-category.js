#!/usr/bin/env node
/**
 * One-time backfill: tag existing 🌱 Personal tasks with the new Personal Category
 * (💻 Coding / 📝 Admin) using the keyword rules that previously lived in
 * CONTENT_SPLITS.summarize.personal.personal.
 *
 * Default is dry-run. Pass --apply to write to Notion.
 *
 * Reads from data/life.json (run `yarn pull` first to refresh).
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("@notionhq/client");

const DATA_PATH = path.join(__dirname, "..", "data", "life.json");
const TOKEN = process.env.NOTION_TOKEN;

const KEYWORDS = {
  coding: [
    "plugin:", "plugin/", "feat:", "feat/", "fix:", "fix/",
    "bug:", "bug/", "refactor:", "refactor/", "chore:", "chore/",
    "spike:", "spike/", "test:", "test/", "ci:", "ci/",
    "infra:", "infra/", "merge", "docs:", "docs/",
    "skill:", "skill/", "brickbot:", "brickbot/", "brickomations:", "brickomations/",
  ],
  admin: [
    "journals", "journal", "update", "retro", "plan", "recap",
    "2024", "2025", "2026",
  ],
};

const TARGET_OPTION = {
  coding: "💻 Coding",
  admin: "📝 Admin",
};

function classify(title) {
  if (!title) return null;
  for (const [target, words] of Object.entries(KEYWORDS)) {
    const hit = words.some((word) => {
      if (/\W$/.test(word)) {
        return title.toLowerCase().startsWith(word.toLowerCase());
      }
      return new RegExp(`\\b${word}\\b`, "i").test(title);
    });
    if (hit) return target;
  }
  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

  const life = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  const tasks = life.tasks || [];

  const candidates = tasks.filter(
    (t) =>
      t.Category === "🌱 Personal" &&
      (!t["Personal Category"] || t["Personal Category"] === "None")
  );

  const buckets = { coding: [], admin: [], unmatched: [] };
  for (const t of candidates) {
    const target = classify(t.Task);
    if (target) buckets[target].push(t);
    else buckets.unmatched.push(t);
  }

  console.log(`Total tasks in life.json: ${tasks.length}`);
  console.log(`🌱 Personal tasks with empty Personal Category: ${candidates.length}`);
  console.log();
  console.log(`  → 💻 Coding: ${buckets.coding.length}`);
  console.log(`  → 📝 Admin:  ${buckets.admin.length}`);
  console.log(`  → no match: ${buckets.unmatched.length} (will stay 🌱 Personal)`);
  console.log();

  for (const target of ["coding", "admin"]) {
    const sample = buckets[target].slice(0, 8);
    if (sample.length === 0) continue;
    console.log(`Sample → ${TARGET_OPTION[target]}:`);
    for (const t of sample) console.log(`  • ${t.Task}`);
    if (buckets[target].length > sample.length) {
      console.log(`  …and ${buckets[target].length - sample.length} more`);
    }
    console.log();
  }

  if (!apply) {
    console.log("DRY RUN — no Notion writes. Re-run with --apply to write.");
    return;
  }

  if (!TOKEN) {
    console.error("NOTION_TOKEN missing in env.");
    process.exit(1);
  }
  const notion = new Client({ auth: TOKEN });

  const writes = [
    ...buckets.coding.map((t) => [t, "coding"]),
    ...buckets.admin.map((t) => [t, "admin"]),
  ].slice(0, limit);

  console.log(`Applying ${writes.length} updates to Notion…`);
  let ok = 0;
  let fail = 0;
  for (const [task, target] of writes) {
    try {
      await notion.pages.update({
        page_id: task._notionId,
        properties: {
          "Personal Category": {
            select: { name: TARGET_OPTION[target] },
          },
        },
      });
      ok++;
      if (ok % 25 === 0) console.log(`  …${ok} updated`);
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      fail++;
      console.error(`  ✗ ${task._notionId} (${task.Task}): ${e.message}`);
    }
  }
  console.log();
  console.log(`Done. ${ok} updated, ${fail} failed.`);
  console.log("Run `yarn pull` to refresh data/life.json.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
