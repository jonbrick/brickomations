#!/usr/bin/env node

/**
 * Sync CLI
 * Runs the full Brickbot pipeline: tokens:refresh → collect → update → summarize → aggregate → pull → vault-sync
 * Called by launchd or manually via `yarn sync`
 *
 * Usage:
 *   yarn sync                                       # Run full pipeline for today (interactive where applicable)
 *   yarn sync --auto                                # Non-interactive (used by launchd) — default ±3 day window
 *   yarn sync --date=YYYY-MM-DD                     # Backfill a single past day end-to-end
 *   yarn sync --from=YYYY-MM-DD --to=YYYY-MM-DD     # Backfill a date range; summarize/aggregate fire once per unique week/month touched
 *
 * `--date` and `--from`/`--to` are forwarded to every date-aware child step so
 * each child applies the range at its own granularity (day/week/month).
 * Range backfills bypass the 15-min wall-clock cap (manual run, not on the wakelock).
 */

// NOTE: Do NOT load dotenv here. Each step runs as a child process that inherits
// this process's env. dotenv won't override existing vars, so if we load .env here,
// child processes get stale tokens even after tokens:refresh updates .env.
const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseDateRangeFromArgv, dateRangeFlags, defaultAutoRange } = require("../src/utils/cli");

const autoMode = process.argv.includes("--auto");

const { range: explicitRange, error: rangeError } = parseDateRangeFromArgv(process.argv);
if (rangeError) {
  console.error(rangeError);
  process.exit(1);
}
const isBackfill = !!explicitRange;
// In --auto with no explicit --from/--to, fall back to a centralized week-aligned
// window (last + this + next week) so every date-scoped step shares one window
// definition instead of each computing its own. Explicit --from/--to backfills
// pass through unchanged and keep isBackfill semantics (wall-clock-timeout bypass
// + backfill log name). The forwarded `--auto --from --to` flag shape is the same
// one backfills already use, so the steps' range handling is unchanged.
const range = explicitRange || (autoMode ? defaultAutoRange() : null);

const projectDir = path.resolve(__dirname, "..");
const logDir = path.join(projectDir, "local", "logs");
const lockFile = path.join(projectDir, "local", "sync.lock");
const today = new Date().toISOString().slice(0, 10);
const logFile = path.join(
  logDir,
  isBackfill ? `daily-${today}-backfill-${range.from}_to_${range.to}.log` : `daily-${today}.log`
);

// Use process.execPath so launchd child processes find node
// (launchd's shell PATH doesn't include /opt/homebrew/bin)
const NODE = process.execPath;

const DEFAULT_TIMEOUT = 3 * 60 * 1000; // 3 minutes per step
const WALL_CLOCK_TIMEOUT = 15 * 60 * 1000; // 15 minutes total — caps the caffeinate wakelock so a runaway pipeline can't hold the mini awake forever. See _automation/_automation-readme.md "Wakelock and timeout contract". Bypassed for --date/--from/--to backfills (manual runs, not on the wakelock).

const rangeFlag = dateRangeFlags(range);

// NOTE: `push` (local → Notion) is intentionally NOT in this pipeline. Nothing
// edits data/*.json between automated runs, so an auto push could only ever
// clobber Notion (the source of truth) with stale local state. `yarn push` is
// manual + push-skill invoked only. See harden-brickbot-sync-layer-brief §4a.4.
const STEPS = [
  { name: "tokens:refresh", cmd: `${NODE} cli/tokens/refresh.js --auto` },
  { name: "collect", cmd: `${NODE} cli/collect-data.js --auto${rangeFlag}` },
  // Events/Trips sync their full DB every run (syncEntireDb); give this step
  // headroom over the 3-min default. 6 min was breached on 2026-08-12 once the
  // Events DB reached 207 events (~340s of unconditional re-writes) — see the
  // change-detection fast path in workflows/notion-databases-to-calendar.js,
  // which is the actual fix. This margin stays as a backstop for the daily
  // full-resync run, which still writes everything.
  { name: "update", cmd: `${NODE} cli/update-calendar.js --auto${rangeFlag}`, timeout: 9 * 60 * 1000 },
  { name: "summarize", cmd: `${NODE} cli/summarize-week.js --auto${rangeFlag}` },
  { name: "aggregate", cmd: `${NODE} cli/aggregate-month.js --auto${rangeFlag}` },
  { name: "pull", cmd: `${NODE} cli/pull.js --auto`, timeout: 8 * 60 * 1000 },
  { name: "vault-sync", cmd: `${NODE} cli/vault-sync.js --auto` },
];

function log(message) {
  const line = message + "\n";
  if (autoMode) {
    fs.appendFileSync(logFile, line);
  } else {
    process.stdout.write(line);
  }
}

function cleanOldLogs() {
  try {
    const files = fs.readdirSync(logDir).filter((f) => f.startsWith("daily-") && f.endsWith(".log"));
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}


// Cap to keep heartbeat iMessages and console output readable.
function capDetail(text) {
  return text.length > 240 ? text.slice(0, 237) + "..." : text;
}

// Pull a one-line summary out of a failed step's output so failures surface
// without log-grepping. Prefers lines marked with ❌ / ✗ or "Error:/Failed:";
// falls back to the last few non-empty lines.
//
// A step killed by its timeout (SIGTERM) prints no error marker at all — its last
// output is simply the progress line it had reached, which is usually a ✅. Passing
// that through verbatim produced the 2026-08-12 alert that read
// "status=failed: ... ✅ 2 records → 11 synced". So signal kills describe themselves
// by the signal, and ✅ lines are never eligible as a failure explanation.
function extractErrorDetail(err, step) {
  const text = (err.stderr || err.stdout || err.message || "").toString();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  if (err.signal) {
    const limitMin = Math.round((step?.timeout || DEFAULT_TIMEOUT) / 60000);
    const lastReached = lines[lines.length - 1];
    return capDetail(
      `killed by ${err.signal} after ${limitMin}min` +
        (lastReached ? ` (last reached: ${lastReached})` : "")
    );
  }

  if (lines.length === 0) return null;
  // ✗ is cli/pull.js's per-source failure marker; ❌ is used everywhere else.
  const failures = lines.filter(
    (l) =>
      l.includes("❌") ||
      l.includes("✗") ||
      /^(Error:|Failed:|TypeError:|ReferenceError:)/.test(l)
  );
  const picked =
    failures.length > 0
      ? failures
      : lines.filter((l) => !l.startsWith("✅")).slice(-3);
  if (picked.length === 0) return null;
  return capDetail(picked.join(" | "));
}

function sendNotification(title, message) {
  try {
    execSync(
      `osascript -e 'display notification "${message}" with title "${title}"'`,
      { stdio: "ignore" }
    );
  } catch {
    log("Warning: Failed to send notification");
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  try {
    const content = fs.readFileSync(lockFile, "utf8").trim();
    const pid = parseInt(content, 10);
    if (pid && isProcessRunning(pid)) {
      return pid; // Another sync is running
    }
    // Stale lock — process is gone, clean up and continue
  } catch {
    // No lock file — good to go
  }
  fs.writeFileSync(lockFile, String(process.pid));
  return null;
}

function releaseLock() {
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // Ignore — file may already be gone
  }
}

function main() {
  // Ensure log directory exists
  fs.mkdirSync(logDir, { recursive: true });

  // Prevent concurrent syncs
  const runningPid = acquireLock();
  if (runningPid) {
    const msg = `Sync already running (PID ${runningPid}), skipping.`;
    if (autoMode) {
      fs.appendFileSync(logFile, msg + "\n");
    } else {
      console.log(msg);
    }
    process.exit(0);
  }

  if (autoMode) {
    cleanOldLogs();
  }

  if (range) {
    const label = isBackfill ? "backfill" : "auto";
    const weekDesc = range.weeks.map((w) => `W${w.weekNumber}/${w.year}`).join(", ");
    const monthDesc = range.months.map((m) => `${m.month}/${m.year}`).join(", ");
    log(`=== Brickbot Run: ${new Date().toLocaleString()} [${label} ${range.from} → ${range.to}; weeks ${weekDesc}; months ${monthDesc}] ===`);
  } else {
    log(`=== Brickbot Run: ${new Date().toLocaleString()} ===`);
  }

  const errors = [];
  const errorDetails = {}; // step name → one-line failure summary
  const startTime = Date.now();

  for (const step of STEPS) {
    if (!isBackfill && Date.now() - startTime > WALL_CLOCK_TIMEOUT) {
      log(`ABORT: Wall-clock timeout (${WALL_CLOCK_TIMEOUT / 60000} min) exceeded before ${step.name}`);
      errors.push("wall-clock-timeout");
      break;
    }
    log(`--- ${step.name} ---`);
    try {
      const output = execSync(step.cmd, {
        cwd: projectDir,
        timeout: step.timeout || DEFAULT_TIMEOUT,
        encoding: "utf8",
        stdio: autoMode ? "pipe" : "inherit",
      });
      if (autoMode && output) {
        fs.appendFileSync(logFile, output);
      }
    } catch (err) {
      errors.push(step.name);
      if (autoMode && err.stdout) {
        fs.appendFileSync(logFile, err.stdout);
      }
      if (autoMode && err.stderr) {
        fs.appendFileSync(logFile, err.stderr);
      }
      const detail = extractErrorDetail(err, step);
      const exitInfo = err.signal ? `signal ${err.signal}` : `exit code ${err.status}`;
      // Signal kills already name themselves ("killed by SIGTERM after Nmin");
      // exit-code failures get the code prefixed so the heartbeat carries the
      // reason too, not just the log line.
      const exitCode = err.status ?? "?";
      const heartbeatDetail = err.signal
        ? detail
        : detail
        ? `exit ${exitCode}: ${detail}`
        : `exit ${exitCode}`;
      if (heartbeatDetail) errorDetails[step.name] = heartbeatDetail;
      log(`ERROR: ${step.name} failed (${exitInfo})${detail ? ` — ${detail}` : ""}`);
      if (step.name === "tokens:refresh") {
        log("Bailing: tokens:refresh failed — network or API likely down");
        break;
      }
    }
  }

  log(`=== Done: ${new Date().toLocaleString()} ===\n`);

  releaseLock();

  // Write heartbeat ping. Watchdog (com.brickbot.watchdog) reads this and alerts
  // via iMessage if the file is stale or status=failed. Silent on success.
  // See _automation/_automation-readme.md "Heartbeat design".
  const pingScript = path.join(projectDir, "scripts", "heartbeat-ping.sh");
  const pingStatus = errors.length > 0 ? "failed" : "ok";
  const pingArgs = ["yarn-sync", pingStatus];
  if (errors.length > 0) {
    const failedDescription = errors
      .map((s) => (errorDetails[s] ? `${s}: ${errorDetails[s]}` : s))
      .join("; ");
    pingArgs.push(`Failed: ${failedDescription}`);
  }
  try {
    execFileSync(pingScript, pingArgs, { stdio: "ignore" });
  } catch {
    log("Warning: heartbeat ping failed");
  }

  if (errors.length > 0) {
    const failedSteps = errors
      .map((s) => (errorDetails[s] ? `${s} (${errorDetails[s]})` : s))
      .join(", ");
    if (autoMode) {
      sendNotification("Brickbot", `Sync failed: ${failedSteps}. Check logs.`);
    }
    console.error(`Failed steps: ${failedSteps}`);
    process.exit(1);
  }
}

// Clean up lock on unexpected exit (Ctrl+C, kill, etc.)
process.on("SIGINT", () => { releaseLock(); process.exit(130); });
process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

// Only run the pipeline when invoked directly, so test/error-detail.test.js can
// require this file for extractErrorDetail without kicking off a sync.
if (require.main === module) {
  main();
}

module.exports = { extractErrorDetail };
