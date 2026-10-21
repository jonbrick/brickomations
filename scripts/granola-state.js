#!/usr/bin/env node
/**
 * granola-state.js — read the Granola Sync plugin's state out of the vault for
 * scripts/heartbeat-watchdog.sh (the one pull-based heartbeat check).
 *
 * Why this is node and not bash: the vault is Obsidian's iCloud container and
 * macOS TCC guards it. A shell script run by launchd is a platform binary —
 * tccd never prompts for one and never checks its Files & Folders grants — so
 * every `ls` under <vault>/.obsidian/ is denied at the kernel ("Sandbox)
 * System Policy: bash deny file-read-data"). The watchdog read that as "no
 * debug log" every morning from Mon 2026-10-19 (check deployed) to Tue
 * 2026-10-20. Node is not a platform binary and already holds the grant on
 * the mini — it's what every other vault-touching job runs as. Verified
 * 2026-10-20 with a throwaway launchd agent: bash `ls` DENIED, node from
 * inside the same script ALLOWED.
 *
 * Rule of thumb: launchd shell scripts can't read the vault; vault reads go
 * through node. The watchdog keeps the thresholds and alert logic in bash and
 * delegates only the reads here.
 *
 * Usage: node scripts/granola-state.js <plugin-dir>
 *        (<plugin-dir> = <vault>/.obsidian/plugins/granola-sync)
 *
 * Prints key=value lines, one per key, always in this order — bash reads them
 * with `sed -n 's/^key=//p'`, so no JSON parsing on the way out:
 *
 *   data_json=0|1              data.json present
 *   latest_sync_ms=<int>       data.json latestSyncTime (ms since epoch); 0 if absent
 *   log_file=<path>            newest logs/*.log by mtime; empty if no logs dir / no logs
 *   log_mtime_epoch=<int>      its mtime in seconds; 0 if none
 *   block_started_epoch=<int>  epoch of the last "Sync started" line; 0 if none / unparsed
 *   block_listed=0|1           that block contains "Listed " (API listing succeeded)
 *   block_error=<text>         last [ERROR] line in that block, one line, ≤160 chars; else empty
 *
 * Exit 0 for any readable state, including "nothing there yet". Exit 1 only
 * when a read is refused (EACCES / EPERM) or the helper itself fails, with the
 * reason on stderr — the watchdog turns that into its own alert so a
 * permissions regression never masquerades as "no debug log" again.
 *
 * Never writes. Reads the log tail backwards in growing windows (1 MiB, ×4)
 * until the last "Sync started" line is fully inside the window, so a 50 MB
 * session log costs one small read every 5 minutes, not a full scan.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const SYNC_MARK = "Sync started";
const LISTED_MARK = "Listed ";
const ERROR_MARK = "[ERROR]";
const ERROR_MAX = 160;
const FIRST_WINDOW = 1024 * 1024;

function isRefused(err) {
  return Boolean(err) && (err.code === "EACCES" || err.code === "EPERM");
}

function readDataJson(pluginDir) {
  const file = path.join(pluginDir, "data.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return { present: false, latestSyncMs: 0 };
    throw err;
  }
  let latestSyncMs = 0;
  try {
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed.latestSyncTime)) latestSyncMs = Math.floor(parsed.latestSyncTime);
  } catch (_) {
    // Present but mid-write or corrupt: still "present" for the missing-file alert.
  }
  return { present: true, latestSyncMs };
}

function newestLog(pluginDir) {
  const logsDir = path.join(pluginDir, "logs");
  let names;
  try {
    names = fs.readdirSync(logsDir);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
    throw err;
  }
  let best = null;
  for (const name of names) {
    if (!name.endsWith(".log")) continue;
    const file = path.join(logsDir, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch (err) {
      if (err.code === "ENOENT") continue; // rotated away between readdir and stat
      throw err;
    }
    if (!st.isFile()) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { file, mtimeMs: st.mtimeMs, size: st.size };
  }
  return best;
}

function readRange(fd, start, length) {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = fs.readSync(fd, buf, got, length - got, start + got);
    if (n === 0) break;
    got += n;
  }
  return buf.subarray(0, got).toString("utf8");
}

// The last "Sync started" block: from that line to end of file. "" if none.
function lastBlock(file, size) {
  if (size === 0) return "";
  const fd = fs.openSync(file, "r");
  try {
    let window = Math.min(FIRST_WINDOW, size);
    for (;;) {
      const start = size - window;
      const text = readRange(fd, start, window);
      const idx = text.lastIndexOf(SYNC_MARK);
      if (idx !== -1) {
        const nl = text.lastIndexOf("\n", idx);
        // The whole first line must be in the window (or we're at byte 0) so
        // its timestamp parses; otherwise widen and look again.
        if (nl !== -1 || start === 0) return text.slice(nl + 1);
      }
      if (window >= size) return "";
      window = Math.min(window * 4, size);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function parseBlock(block) {
  if (!block) return { startedEpoch: 0, listed: 0, error: "" };
  const lines = block.split("\n");
  // Log lines start with an ISO-8601 UTC stamp: 2026-10-16T11:30:00.123Z
  const m = lines[0].match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  let startedEpoch = 0;
  if (m) {
    const ms = Date.parse(`${m[1]}Z`);
    if (Number.isFinite(ms)) startedEpoch = Math.floor(ms / 1000);
  }
  const listed = block.includes(LISTED_MARK) ? 1 : 0;
  let error = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(ERROR_MARK)) {
      error = lines[i];
      break;
    }
  }
  error = error.replace(/[\r\n]+/g, " ").slice(0, ERROR_MAX);
  return { startedEpoch, listed, error };
}

function main() {
  const pluginDir = process.argv[2];
  if (!pluginDir) {
    process.stderr.write("Usage: granola-state.js <plugin-dir>\n");
    process.exit(64);
  }
  const data = readDataJson(pluginDir);
  const log = newestLog(pluginDir);
  const block = parseBlock(log ? lastBlock(log.file, log.size) : "");
  const out = [
    `data_json=${data.present ? 1 : 0}`,
    `latest_sync_ms=${data.latestSyncMs}`,
    `log_file=${log ? log.file : ""}`,
    `log_mtime_epoch=${log ? Math.floor(log.mtimeMs / 1000) : 0}`,
    `block_started_epoch=${block.startedEpoch}`,
    `block_listed=${block.listed}`,
    `block_error=${block.error}`,
  ];
  process.stdout.write(`${out.join("\n")}\n`);
}

try {
  main();
} catch (err) {
  const code = err && err.code ? err.code : String(err);
  const where = err && err.path ? ` ${err.path}` : "";
  process.stderr.write(`granola-state: ${isRefused(err) ? "read refused" : "failed"} (${code})${where}\n`);
  process.exit(1);
}
