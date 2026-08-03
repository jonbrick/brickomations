#!/usr/bin/env node

/**
 * Vault Sync CLI
 * Syncs personal planning data from data/*.json to Obsidian vault as markdown.
 * Zero AI tokens — pure JS transformation with hash-based diff detection.
 *
 * Usage:
 *   yarn vault-sync                      # Run sync
 *   yarn vault-sync --auto               # Non-interactive (used by launchd via sync.js)
 *   yarn vault-sync --prune              # Sync, then delete vault files whose notion_id
 *                                        # is not in the canonical record set (orphans
 *                                        # from Notion deletes / status reverts / renames
 *                                        # that changed the slug)
 *   yarn vault-sync --prune --dry-run    # Report orphans without deleting
 *
 * @layer 0 - Local (Vault)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VAULT_DIR = path.join(
  process.env.HOME,
  "projects",
  "brickocampus",
  "personal"
);
const { readFileSyncRetry, writeFileSyncRetry } = require("../src/utils/fs-retry");
const DATA_DIR = path.join(__dirname, "..", "data");

// --- Helpers ---

/** Strip leading emoji characters from a string (e.g., "🔴 To Do" → "To Do") */
function stripEmoji(str) {
  if (!str) return "";
  return str.replace(/^[^\x00-\x7F]+\s*/, "").trim();
}

/** Convert a title to a kebab-case filename slug */
function slugify(title) {
  return title
    .replace(/^\?\?\?\s*/, "") // strip leading ???
    .replace(/\(([^)]+)\)/, "$1") // unwrap parenthetical
    .replace(/ Personal Retro$/i, "") // strip retro suffix
    .replace(/[^\w\s-]/g, "") // strip non-alphanumeric
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Read a record's title value via the collector-supplied `_titleKey`, so the
 * sync follows Notion's title column no matter what it's renamed to
 * (e.g. Goals "Goal" → "Name", Themes "Epic" → "Name"). pull.js tags
 * `_titleKey` with whichever property has type "title". Returns "" if absent.
 */
function titleOf(record) {
  const key = record && record._titleKey;
  return (key && record[key]) || "";
}

/** Escape double quotes for YAML frontmatter strings */
function yamlEscape(str) {
  return str.replace(/"/g, '\\"');
}

/** MD5 hash of markdown content (used for diff detection) */
function computeSyncHash(markdown) {
  return crypto.createHash("md5").update(markdown).digest("hex");
}

/** Read sync_hash from an existing vault file's frontmatter */
function readSyncHash(filePath) {
  try {
    const content = readFileSyncRetry(filePath, "utf8");
    const match = content.match(/^sync_hash:\s*"([a-f0-9]+)"/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Write file only if content has changed (returns true if written) */
function writeIfChanged(filePath, markdown) {
  const hash = computeSyncHash(markdown);
  const finalMarkdown = markdown.replace(
    'sync_hash: ""',
    `sync_hash: "${hash}"`
  );

  if (readSyncHash(filePath) === hash) return false;

  writeFileSyncRetry(filePath, finalMarkdown);
  return true;
}

/** Strip dashes and lowercase a Notion ID for normalized comparison */
function normalizeNotionId(input) {
  if (!input) return "";
  return String(input).replace(/-/g, "").toLowerCase();
}

/** Extract the 32-char Notion ID from a notion.so URL */
function extractNotionIdFromUrl(url) {
  if (!url) return "";
  const match = String(url).match(/([0-9a-f]{32})/i);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Parse YAML-style frontmatter from a markdown file.
 * Returns { hasFM, frontmatter (key→unquotedValue), lines (preserved order), body }.
 * Tokenizes line-by-line — handles flat scalar values only (sufficient for project schema).
 * Preserves comments, unknown keys, and ordering.
 */
function parseFrontmatter(content) {
  const result = { hasFM: false, frontmatter: {}, lines: [], body: content };

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return result;

  result.hasFM = true;
  result.body = fmMatch[2];

  for (const rawLine of fmMatch[1].split("\n")) {
    const m = rawLine.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (m) {
      const key = m[1];
      const valueRaw = m[2];
      const qm = valueRaw.match(/^"(.*)"$/);
      const value = qm ? qm[1] : valueRaw;
      result.frontmatter[key] = value;
      result.lines.push({ rawLine, key, valueRaw });
    } else {
      result.lines.push({ rawLine, key: null, valueRaw: null });
    }
  }

  return result;
}

/**
 * Serialize updated frontmatter back to a string, preserving line order,
 * comments, and unknown keys. Updates is a map of key → fully-formed YAML
 * value (e.g. '"Doing"' for a quoted string, 'now' for a bare select).
 * New keys not in original frontmatter are appended at end of FM block.
 */
function serializeFrontmatter(parsed, updates) {
  const newLines = [];
  const used = new Set();

  for (const line of parsed.lines) {
    if (line.key && Object.prototype.hasOwnProperty.call(updates, line.key)) {
      newLines.push(`${line.key}: ${updates[line.key]}`);
      used.add(line.key);
    } else {
      newLines.push(line.rawLine);
    }
  }

  for (const [key, val] of Object.entries(updates)) {
    if (!used.has(key)) {
      newLines.push(`${key}: ${val}`);
    }
  }

  return `---\n${newLines.join("\n")}\n---\n${parsed.body}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonSafe(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(readFileSyncRetry(filePath, "utf8"));
}

// --- Transformers ---

function transformRetro(record) {
  const title = record["Personal Retro"] || "";
  const weekMatch = title.match(/Week\s+(\d+)/);
  const weekNum = weekMatch ? parseInt(weekMatch[1], 10) : 0;
  const weekPadded = String(weekNum).padStart(2, "0");

  const frontmatter = [
    "---",
    `aliases: ["${yamlEscape(title)}"]`,
    "type: retro",
    `week: ${weekNum}`,
    `month: "${record["Month"] || ""}"`,
    `status: ${record["Status"] || "Not started"}`,
    `notion_id: "${record._notionId}"`,
    'sync_hash: ""',
    "---",
  ].join("\n");

  const sections = [];

  if (record["Personal Rocks"]) {
    sections.push(`## Rocks\n${record["Personal Rocks"]}`);
  }

  const reflections = [
    ["What Went Well", "What went well?"],
    ["What Did Not Go So Well", "What did not go so well?"],
    ["What Did I Learn", "What did I learn?"],
    ["My Retro", "My Retro"],
    ["AI Retro", "AI Retro"],
  ];
  for (const [heading, field] of reflections) {
    if (record[field]) sections.push(`## ${heading}\n${record[field]}`);
  }

  const summaries = [
    ["Habits", "Weekly Habits"],
    ["Time Blocks", "Weekly Blocks"],
    ["Tasks", "Weekly Tasks"],
    ["Trips & Events", "Personal Trips & Events"],
  ];
  for (const [heading, field] of summaries) {
    if (record[field]) sections.push(`## ${heading}\n${record[field]}`);
  }

  const markdown = frontmatter + "\n\n" + sections.join("\n\n") + "\n";
  return { slug: `week-${weekPadded}`, markdown };
}

function transformGoal(record, themeLookup) {
  const rawTitle = titleOf(record);
  const cleanTitle = rawTitle
    .replace(/^\?\?\?\s*/, "")
    .replace(/\(([^)]+)\)/, "$1")
    .trim();
  const slug = slugify(rawTitle);

  const themeIds = record["🏔️ 2026 Themes"] || [];
  const themeLinks = themeIds
    .map((id) => themeLookup[id])
    .filter(Boolean)
    .map((s) => `"[[${s}]]"`);

  const lines = [
    "---",
    `aliases: ["${yamlEscape(cleanTitle)}"]`,
    "type: goal",
    `status: "${stripEmoji(record["Status"] || "")}"`,
    `category: "${stripEmoji(record["Category"] || "")}"`,
    `goal_type: ${record["Goal Type"] || "Primary"}`,
    `themes: [${themeLinks.join(", ")}]`,
    record["Date"] ? `date: ${record["Date"]}` : null,
    record["Month"] ? `month: "${record["Month"]}"` : null,
    `notion_id: "${record._notionId}"`,
    'sync_hash: ""',
    "---",
  ];

  const frontmatter = lines.filter(Boolean).join("\n");
  const sections = [];

  if (record["Clarifying Statement"]) {
    sections.push(
      `## Clarifying Statement\n${record["Clarifying Statement"]}`
    );
  }

  const markdown =
    frontmatter + "\n\n" + (sections.length ? sections.join("\n\n") + "\n" : "");
  return { slug, markdown };
}

function transformTheme(record, goalLookup) {
  const title = titleOf(record);
  const slug = slugify(title);

  const goalIds = record["🏆 2026 Goals"] || [];
  const goalLinks = goalIds
    .map((id) => goalLookup[id])
    .filter(Boolean)
    .map((s) => `- [[${s}]]`);

  const frontmatter = [
    "---",
    `aliases: ["${yamlEscape(title)}"]`,
    "type: theme",
    `category: "${stripEmoji(record["Category"] || "")}"`,
    `theme_type: ${record["Theme Type"] || "Primary"}`,
    `notion_id: "${record._notionId}"`,
    'sync_hash: ""',
    "---",
  ].join("\n");

  const sections = [];

  if (record["Description"]) {
    sections.push(`## Description\n${record["Description"]}`);
  }
  if (goalLinks.length > 0) {
    sections.push(`## Goals\n${goalLinks.join("\n")}`);
  }

  const markdown =
    frontmatter + "\n\n" + (sections.length ? sections.join("\n\n") + "\n" : "");
  return { slug, markdown };
}

// --- Sync functions ---

function syncRetros(records) {
  const dir = path.join(VAULT_DIR, "retros");
  ensureDir(dir);
  const results = { written: 0, skipped: 0, errors: [] };

  const completed = records.filter((r) => r.Status === "Done");

  for (const record of completed) {
    try {
      const { slug, markdown } = transformRetro(record);
      const filePath = path.join(dir, `${slug}.md`);
      if (writeIfChanged(filePath, markdown)) {
        results.written++;
      } else {
        results.skipped++;
      }
    } catch (err) {
      results.errors.push(`${record["Personal Retro"]}: ${err.message}`);
    }
  }

  return results;
}

function syncGoals(goals, themes) {
  const dir = path.join(VAULT_DIR, "goals");
  ensureDir(dir);
  const results = { written: 0, skipped: 0, errors: [] };

  const themeLookup = {};
  for (const theme of themes) {
    themeLookup[theme._notionId] = slugify(titleOf(theme));
  }

  const seenSlugs = new Set();
  for (const record of goals) {
    try {
      let { slug, markdown } = transformGoal(record, themeLookup);
      if (seenSlugs.has(slug)) {
        slug = `${slug}-${record._notionId.slice(0, 8)}`;
        markdown = markdown.replace(
          'sync_hash: ""',
          'sync_hash: ""' // re-generate with corrected slug context
        );
      }
      seenSlugs.add(slug);

      const filePath = path.join(dir, `${slug}.md`);
      if (writeIfChanged(filePath, markdown)) {
        results.written++;
      } else {
        results.skipped++;
      }
    } catch (err) {
      results.errors.push(`${titleOf(record)}: ${err.message}`);
    }
  }

  return results;
}

function syncThemes(themes, goals) {
  const dir = path.join(VAULT_DIR, "themes");
  ensureDir(dir);
  const results = { written: 0, skipped: 0, errors: [] };

  const goalLookup = {};
  for (const goal of goals) {
    goalLookup[goal._notionId] = slugify(titleOf(goal));
  }

  for (const record of themes) {
    try {
      const { slug, markdown } = transformTheme(record, goalLookup);
      const filePath = path.join(dir, `${slug}.md`);
      if (writeIfChanged(filePath, markdown)) {
        results.written++;
      } else {
        results.skipped++;
      }
    } catch (err) {
      results.errors.push(`${titleOf(record)}: ${err.message}`);
    }
  }

  return results;
}

function syncPersonalProjects(projects, goals, { dryRun = false } = {}) {
  const dir = path.join(VAULT_DIR, "projects");
  if (!fs.existsSync(dir)) {
    return { written: 0, skipped: 0, warnings: [], errors: [] };
  }

  const goalLookup = {};
  for (const goal of goals) {
    goalLookup[normalizeNotionId(goal._notionId)] = slugify(titleOf(goal));
  }

  const projectLookup = {};
  for (const p of projects) {
    projectLookup[normalizeNotionId(p._notionId)] = p;
  }

  const results = { written: 0, skipped: 0, warnings: [], errors: [] };
  const matchedNotionIds = new Set();

  // Recursively find .md files under personal/projects/<Project Name>/<slug>.md.
  // Skip "_"-prefixed staging/system folders (e.g. _personal-project-inbox) —
  // pre-Notion staging, flat layout. Matches the skip convention in
  // scripts/migrate-projects-to-folders.js, so renaming the staging folder can't
  // reintroduce a gap where staging briefs get synced as real projects.
  const files = [];
  const walk = (subdir) => {
    for (const entry of fs.readdirSync(subdir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      const full = path.join(subdir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
    }
  };
  walk(dir);

  for (const filePath of files) {
    const file = path.basename(filePath);
    let content;
    try {
      content = readFileSyncRetry(filePath, "utf8");
    } catch (err) {
      results.errors.push(`${file}: ${err.message}`);
      continue;
    }

    const parsed = parseFrontmatter(content);
    if (!parsed.hasFM) {
      results.warnings.push(`${file}: no frontmatter — skipped`);
      continue;
    }

    const notionUrl = parsed.frontmatter.notion_url;
    if (!notionUrl) {
      results.warnings.push(`${file}: no notion_url — skipped`);
      continue;
    }

    const id = extractNotionIdFromUrl(notionUrl);
    if (!id) {
      results.warnings.push(`${file}: notion_url has no 32-char id — skipped`);
      continue;
    }

    const record = projectLookup[id];
    if (!record) {
      results.warnings.push(
        `${file}: notion_url has no matching record (deleted in Notion?) — skipped`
      );
      continue;
    }

    matchedNotionIds.add(id);

    // Build desired frontmatter values (fully-formed YAML strings)
    const desired = {};
    desired.status = `"${stripEmoji(record.Status || "")}"`;
    desired.start_date = record.Date || "";
    desired.end_date = record["Date End"] || record.Date || "";
    desired.priority = (record.Priority || "").toLowerCase();
    desired.description = record.Description
      ? `"${yamlEscape(record.Description)}"`
      : '""';
    desired.problem = record.Problem
      ? `"${yamlEscape(record.Problem)}"`
      : '""';
    desired.lead = record.Lead
      ? `"[[${yamlEscape(record.Lead)}]]"`
      : '""';

    const goalIds = record["🏆 Goal"] || [];
    const goalLinks = goalIds
      .map((id) => goalLookup[normalizeNotionId(id)])
      .filter(Boolean)
      .map((s) => `"[[${s}]]"`);
    desired.goal = `[${goalLinks.join(", ")}]`;

    // notion_name: only if Notion title diverges from filename slug
    const fileSlug = file.replace(/\.md$/, "");
    const notionTitleSlug = slugify(record.Project || "");
    if (notionTitleSlug && notionTitleSlug !== fileSlug) {
      desired.notion_name = `"${yamlEscape(record.Project)}"`;
    }

    // Diff: compare unquoted values
    const unquote = (s) => {
      if (s === undefined || s === null) return "";
      const m = String(s).match(/^"(.*)"$/);
      return m ? m[1] : String(s);
    };

    const updates = {};
    for (const [key, valQuoted] of Object.entries(desired)) {
      const currentUnq = unquote(parsed.frontmatter[key]);
      const desiredUnq = unquote(valQuoted);
      if (currentUnq !== desiredUnq) {
        updates[key] = valQuoted;
      }
    }

    if (Object.keys(updates).length === 0) {
      results.skipped++;
      continue;
    }

    if (dryRun) {
      const relPath = path.relative(VAULT_DIR, filePath);
      console.log(`  would update: ${relPath}`);
      for (const [key, valQuoted] of Object.entries(updates)) {
        const current = parsed.frontmatter[key];
        console.log(`    ${key}: ${JSON.stringify(current)} → ${valQuoted}`);
      }
      results.written++;
      continue;
    }

    try {
      const newContent = serializeFrontmatter(parsed, updates);
      writeFileSyncRetry(filePath, newContent);
      results.written++;
    } catch (err) {
      results.errors.push(`${file}: ${err.message}`);
    }
  }

  // Notion records that have no matching vault file
  for (const [id, record] of Object.entries(projectLookup)) {
    if (!matchedNotionIds.has(id)) {
      results.warnings.push(
        `Notion project "${record.Project}" has no vault file (auto-create not implemented v1)`
      );
    }
  }

  return results;
}

// --- Prune ---

/**
 * Delete vault files whose notion_id is not in the canonical record set
 * (deleted in Notion / retro status reverted from Done) OR whose slug doesn't
 * match the expected slug for that record's current title (stale rename).
 * Files without a notion_id frontmatter (manual notes) are left untouched.
 */
function pruneOrphans({ retroData, lifeData, dryRun }) {
  const expected = {
    goals: new Map(
      (lifeData?.goals || []).map((g) => [
        g._notionId,
        transformGoal(g, {}).slug,
      ])
    ),
    themes: new Map(
      (lifeData?.themes || []).map((t) => [
        t._notionId,
        transformTheme(t, {}).slug,
      ])
    ),
    retros: new Map(
      (retroData?.personalWeekly || [])
        .filter((r) => r.Status === "Done")
        .map((r) => [r._notionId, transformRetro(r).slug])
    ),
  };

  const results = { pruned: [], unmanaged: 0, kept: 0 };

  for (const type of Object.keys(expected)) {
    const dir = path.join(VAULT_DIR, type);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const content = readFileSyncRetry(fullPath, "utf8");
      const match = content.match(/^notion_id:\s*"([^"]+)"/m);

      if (!match) {
        // Files without notion_id are unmanaged (manual notes OR personal-project
        // files that use notion_url instead — both are intentionally skipped).
        results.unmanaged++;
        continue;
      }

      const notionId = match[1];
      const fileSlug = file.replace(/\.md$/, "");
      const expectedSlug = expected[type].get(notionId);

      if (expectedSlug === undefined) {
        results.pruned.push({ type, file, notionId, reason: "deleted" });
        if (!dryRun) fs.unlinkSync(fullPath);
      } else if (expectedSlug !== fileSlug) {
        results.pruned.push({ type, file, notionId, reason: "renamed" });
        if (!dryRun) fs.unlinkSync(fullPath);
      } else {
        results.kept++;
      }
    }
  }

  return results;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const PRUNE = args.includes("--prune");
  const DRY_RUN = args.includes("--dry-run");

  console.log("Vault Sync — syncing personal data to Brickocampus...\n");

  const retroData = readJsonSafe("retro.json");
  const lifeData = readJsonSafe("life.json");

  if (!retroData && !lifeData) {
    console.log("No data files found. Run yarn pull first.");
    process.exit(1);
  }

  const allResults = [];

  if (retroData?.personalWeekly) {
    const results = syncRetros(retroData.personalWeekly);
    allResults.push({ name: "Retros", ...results });
    console.log(
      `Retros: ${results.written} written, ${results.skipped} unchanged` +
        (results.errors.length ? `, ${results.errors.length} errors` : "")
    );
  }

  if (lifeData?.goals && lifeData?.themes) {
    const goalResults = syncGoals(lifeData.goals, lifeData.themes);
    allResults.push({ name: "Goals", ...goalResults });
    console.log(
      `Goals: ${goalResults.written} written, ${goalResults.skipped} unchanged` +
        (goalResults.errors.length
          ? `, ${goalResults.errors.length} errors`
          : "")
    );

    const themeResults = syncThemes(lifeData.themes, lifeData.goals);
    allResults.push({ name: "Themes", ...themeResults });
    console.log(
      `Themes: ${themeResults.written} written, ${themeResults.skipped} unchanged` +
        (themeResults.errors.length
          ? `, ${themeResults.errors.length} errors`
          : "")
    );
  }

  if (lifeData?.personalProjects) {
    if (DRY_RUN) console.log("Personal Projects (dry-run):");
    const r = syncPersonalProjects(
      lifeData.personalProjects,
      lifeData.goals || [],
      { dryRun: DRY_RUN }
    );
    allResults.push({ name: "Personal Projects", ...r });
    const verb = DRY_RUN ? "would update" : "written";
    console.log(
      `Personal Projects: ${r.written} ${verb}, ${r.skipped} unchanged` +
        (r.warnings.length ? `, ${r.warnings.length} warnings` : "") +
        (r.errors.length ? `, ${r.errors.length} errors` : "")
    );
    if (r.warnings.length > 0) {
      for (const w of r.warnings) console.log(`  ⚠ ${w}`);
    }
  }

  const totalWritten = allResults.reduce((sum, r) => sum + r.written, 0);
  const totalSkipped = allResults.reduce((sum, r) => sum + r.skipped, 0);
  const totalErrors = allResults.reduce((sum, r) => sum + r.errors.length, 0);

  console.log(
    `\nTotal: ${totalWritten} written, ${totalSkipped} unchanged, ${totalErrors} errors`
  );

  for (const r of allResults) {
    for (const err of r.errors) {
      console.error(`  Error [${r.name}]: ${err}`);
    }
  }

  if (PRUNE) {
    console.log(DRY_RUN ? "\nPrune (dry-run):" : "\nPrune:");
    const pruneResults = pruneOrphans({ retroData, lifeData, dryRun: DRY_RUN });

    if (pruneResults.pruned.length === 0) {
      console.log("  No orphans found");
    } else {
      for (const o of pruneResults.pruned) {
        const verb = DRY_RUN ? "would delete" : "deleted";
        console.log(
          `  ${verb}: ${o.type}/${o.file} [${o.reason}] (notion_id: ${o.notionId})`
        );
      }
      const verb = DRY_RUN ? "Would prune" : "Pruned";
      console.log(
        `\n  ${verb} ${pruneResults.pruned.length} orphan(s), kept ${pruneResults.kept} valid, ignored ${pruneResults.unmanaged} unmanaged`
      );
    }
  }

  if (totalErrors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
