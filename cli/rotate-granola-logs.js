#!/usr/bin/env node
/**
 * rotate-granola-logs.js — trash every Granola Sync debug log except the newest.
 *
 * The Obsidian granola-sync plugin runs with "Enable debug logging" on because
 * the heartbeat watchdog reads the current session log for its liveness and
 * health checks (scripts/heartbeat-watchdog.sh → check_granola_sync). That
 * logging runs ~20 MB/day, and the logs live in the vault's iCloud container,
 * so they sync to every device: 367 MB across 8 files by Mon 2026-11-09.
 *
 * The watchdog only ever reads the newest log (scripts/granola-state.js →
 * newestLog, by mtime), so everything older is dead weight. This step moves
 * those to ~/.Trash (recoverable), suffixing on name collision. Turning debug
 * logging off instead would blind the watchdog: data.json latestSyncTime only
 * advances when a note is written, so it can't tell "no new meetings" from
 * "plugin dead" — the 36-day silent stall of 2026-09-10.
 *
 * Runs as a `yarn sync` step (node, not bash: launchd shell scripts are denied
 * vault reads by TCC — see the watchdog's Granola comment). Idempotent; a
 * missing logs folder is a no-op. A refused move fails the step loud.
 *
 * Usage: node cli/rotate-granola-logs.js [--auto]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const LOGS_DIR = path.join(
  process.env.BRICKOCAMPUS_DIR || path.join(os.homedir(), "projects", "brickocampus"),
  ".obsidian",
  "plugins",
  "granola-sync",
  "logs"
);

// Every *.log file in logsDir, newest mtime first. [] when the folder is missing.
function listLogs(logsDir) {
  let names;
  try {
    names = fs.readdirSync(logsDir);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return [];
    throw err;
  }
  const logs = [];
  for (const name of names) {
    if (!name.endsWith(".log")) continue;
    const file = path.join(logsDir, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch (err) {
      if (err.code === "ENOENT") continue;
      throw err;
    }
    if (st.isFile()) logs.push({ file, mtimeMs: st.mtimeMs, size: st.size });
  }
  return logs.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function moveToTrash(file, trashDir) {
  let dest = path.join(trashDir, path.basename(file));
  if (fs.existsSync(dest)) dest = `${dest}-${Date.now()}`;
  try {
    fs.renameSync(file, dest);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    fs.copyFileSync(file, dest);
    fs.unlinkSync(file);
  }
  return dest;
}

// Trash all logs but the newest. Returns { kept, trashed: [{ file, size }] }.
function rotate(logsDir, trashDir) {
  const [newest, ...older] = listLogs(logsDir);
  if (older.length > 0) fs.mkdirSync(trashDir, { recursive: true });
  const trashed = [];
  for (const log of older) {
    moveToTrash(log.file, trashDir);
    trashed.push({ file: log.file, size: log.size });
  }
  return { kept: newest ? newest.file : null, trashed };
}

function main() {
  const { kept, trashed } = rotate(LOGS_DIR, path.join(os.homedir(), ".Trash"));
  if (trashed.length === 0) {
    console.log(`granola logs: nothing to rotate${kept ? ` (keeping ${path.basename(kept)})` : ""}`);
    return;
  }
  const mb = (trashed.reduce((sum, t) => sum + t.size, 0) / 1024 / 1024).toFixed(1);
  console.log(`granola logs: trashed ${trashed.length} (${mb} MB), keeping ${path.basename(kept)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`❌ rotate-granola-logs failed: ${err.code || err.message}${err.path ? ` ${err.path}` : ""}`);
    process.exit(1);
  }
}

module.exports = { listLogs, rotate };
