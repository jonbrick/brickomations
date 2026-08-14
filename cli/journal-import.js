#!/usr/bin/env node
/**
 * Journal Import CLI
 * Imports 5 Minute Journal exports into data/journal.json (which lives in
 * ~/Documents/brickomations-data/ via the data/ symlink, outside the Obsidian vault).
 *
 * Inbox model (in iCloud Drive at ~/Documents/brickomations-data/, synced across machines):
 *   - Drop an unzipped 5MJ export into _journal-inbox/  (a dir containing index.json)
 *   - Run: yarn journal:import
 *   - The script reads the text into data/journal.json, copies the tiny index.json
 *     to journal-archive/<export-id>.json (the permanent record), and moves the
 *     bulky export out of the inbox to the Trash.
 *   - An empty inbox is a no-op: data/journal.json already holds every entry.
 *
 * _journal-inbox/ and journal-archive/ are symlinks to ~/Documents/brickomations-data/
 * (iCloud Drive, outside the vault), the same mechanism data/ uses — so
 * brickomations stays scripts-only and the journal data (Jon's manual exports) lives
 * beside the data cache.
 *
 * Usage: yarn journal:import [path-to-export-dir-or-json]
 *   - No arg: scan _journal-inbox/ (normal path; archives + clears the inbox)
 *   - Explicit path: ad-hoc import only (no archiving, no inbox changes)
 * Output: data/journal.json (2026 entries only)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(__dirname, "..", "data");
const INBOX_DIR = path.join(__dirname, "..", "_journal-inbox");
const ARCHIVE_DIR = path.join(__dirname, "..", "journal-archive");

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

/**
 * Find export directories in _journal-inbox/ (each a dir containing index.json).
 * Returns [{ name, dir, indexPath }], sorted oldest-first by name.
 */
function findInboxExports() {
  ensureDir(INBOX_DIR);
  const exports = [];
  for (const e of fs.readdirSync(INBOX_DIR)) {
    if (e.startsWith(".")) continue; // skip .DS_Store etc.
    const dir = path.join(INBOX_DIR, e);
    let stat;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    const indexPath = path.join(dir, "index.json");
    if (stat.isDirectory() && fs.existsSync(indexPath)) {
      exports.push({ name: e, dir, indexPath });
    }
  }
  return exports.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Move a path to the macOS Trash (recoverable), suffixing on name collision.
 */
function moveToTrash(target) {
  const trashDir = path.join(os.homedir(), ".Trash");
  ensureDir(trashDir);
  let dest = path.join(trashDir, path.basename(target));
  if (fs.existsSync(dest)) dest = `${dest}-${Date.now()}`;
  try {
    fs.renameSync(target, dest);
  } catch (e) {
    if (e.code === "EXDEV") {
      // Cross-volume: copy then remove the original.
      fs.cpSync(target, dest, { recursive: true });
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
}

/**
 * Transform raw 5 Minute Journal export into clean records
 */
function transformRecords(rawRecords) {
  return rawRecords
    .filter((r) => r.date.startsWith("2026"))
    .map((r) => {
      const sections = r.content.sections;
      const morning = sections.find((s) => s.type === "morning");
      const evening = sections.find((s) => s.type === "evening");

      const getItems = (section, type) => {
        if (!section) return [];
        const item = section.items.find((i) => i.type === type);
        return item?.content?.text?.filter((t) => t.trim()) || [];
      };

      return {
        date: r.date,
        gratitude: getItems(morning, "gratitude"),
        greatness: getItems(morning, "greatness"),
        affirmation: getItems(morning, "affirmation").join(" "),
        amazingness: getItems(evening, "amazingness"),
        improvements: getItems(evening, "improvements"),
      };
    })
    .filter((r) => {
      // Skip completely empty entries
      return (
        r.gratitude.length > 0 ||
        r.greatness.length > 0 ||
        r.affirmation ||
        r.amazingness.length > 0 ||
        r.improvements.length > 0
      );
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Merge the given index.json paths into data/journal.json (record-level
 * idempotency: same-date records overwritten, dates not in the import kept).
 */
function importAndWrite(inputPaths) {
  let newRecords = [];
  for (const inputPath of inputPaths) {
    console.log(`\nImporting from: ${inputPath}`);
    const raw = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
    const records = transformRecords(raw.records);
    console.log(`   ${records.length} entries from this export`);
    newRecords.push(...records);
  }

  // Deduplicate across exports (later exports win for same date)
  const deduped = new Map();
  for (const r of newRecords) {
    deduped.set(r.date, r);
  }
  newRecords = Array.from(deduped.values());

  // Merge with existing journal data (record-level idempotency)
  const journalPath = path.join(DATA_DIR, "journal.json");
  let existing = { entries: [] };
  if (fs.existsSync(journalPath)) {
    existing = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  }

  // Build a map of existing entries by date
  const entryMap = new Map();
  for (const entry of existing.entries || []) {
    entryMap.set(entry.date, entry);
  }

  // Merge: new records overwrite existing by date, existing entries kept
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const entry of newRecords) {
    const prev = entryMap.get(entry.date);
    if (!prev) {
      added++;
    } else if (JSON.stringify(prev) !== JSON.stringify(entry)) {
      updated++;
    } else {
      unchanged++;
    }
    entryMap.set(entry.date, entry);
  }
  const kept = entryMap.size - added - updated - unchanged;

  // Sort all entries by date
  const allEntries = Array.from(entryMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const journal = {
    _meta: {
      source: "5 Minute Journal",
      totalEntries: allEntries.length,
      dateRange:
        allEntries.length > 0
          ? `${allEntries[0].date} to ${allEntries[allEntries.length - 1].date}`
          : "none",
    },
    entries: allEntries,
  };

  ensureDir(DATA_DIR);
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));

  console.log(`\n✅ data/journal.json written`);
  console.log(`   ${allEntries.length} total entries`);
  console.log(
    `   ${added} added, ${updated} updated, ${unchanged} unchanged, ${kept} kept from previous`
  );
  if (allEntries.length > 0) {
    console.log(
      `   ${allEntries[0].date} → ${allEntries[allEntries.length - 1].date}`
    );
  }

  // Stats
  const withGratitude = allEntries.filter((r) => r.gratitude.length > 0).length;
  const withEvening = allEntries.filter((r) => r.amazingness.length > 0).length;
  console.log(
    `   ${withGratitude} with morning entries, ${withEvening} with evening entries\n`
  );
}

// --- Main ---

function main() {
  // Explicit path: ad-hoc import only — no archiving, no inbox changes.
  if (process.argv[2]) {
    let inputPath = process.argv[2];
    if (fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory()) {
      inputPath = path.join(inputPath, "index.json");
    }
    if (!fs.existsSync(inputPath)) {
      console.error(`File not found: ${inputPath}`);
      process.exit(1);
    }
    importAndWrite([inputPath]);
    return;
  }

  // Inbox mode: import everything in _journal-inbox/, then archive + clear it.
  const exports = findInboxExports();
  if (exports.length === 0) {
    console.log(
      "Inbox empty — nothing new to import.\n" +
        "(data/journal.json already holds every imported entry; drop a 5MJ export\n" +
        " into _journal-inbox/ to add more.)"
    );
    return;
  }

  console.log(`Found ${exports.length} export(s) in _journal-inbox/`);
  importAndWrite(exports.map((e) => e.indexPath));

  // Archive the tiny index.json, then move the bulky export out to Trash.
  ensureDir(ARCHIVE_DIR);
  for (const exp of exports) {
    const archivePath = path.join(ARCHIVE_DIR, `${exp.name}.json`);
    fs.copyFileSync(exp.indexPath, archivePath);
    console.log(`📦 archived journal-archive/${exp.name}.json`);
    moveToTrash(exp.dir);
    console.log(`🗑️  cleared ${exp.name}/ from inbox → Trash`);
  }
  console.log("\n✅ Inbox empty. Archive holds the index.json record.\n");
}

main();
