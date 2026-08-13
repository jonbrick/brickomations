/**
 * Synchronous fs read/write with retry on transient errors.
 *
 * The data plane (~/Documents/brickomations-data/) and the Brickocampus vault
 * (Obsidian iCloud container) are both iCloud-synced. When a scheduled sync
 * opens a file at the exact moment iCloud is re-syncing it, the read/write can
 * fail with a transient "Unknown system error -11" (EDEADLK) / EAGAIN / EBUSY.
 * These clear within milliseconds, so a short synchronous retry makes the
 * pipeline resilient to iCloud contention instead of failing the whole run.
 *
 * Transparent for non-contended files: the first attempt succeeds, so wrapping
 * repo-local reads/writes costs nothing.
 */
const fs = require("fs");

const RETRYABLE_CODES = new Set(["EDEADLK", "EAGAIN", "EBUSY"]);

function isTransient(err) {
  return (
    err.errno === -11 ||
    RETRYABLE_CODES.has(err.code) ||
    /system error -11/i.test(err.message || "")
  );
}

// Synchronous sleep — brickbot's fs calls are sync; avoids restructuring callers.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withRetry(fn, { attempts = 5, baseMs = 150 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      if (!isTransient(err)) throw err;
      lastErr = err;
      if (i < attempts - 1) sleepSync(baseMs * 2 ** i); // 150, 300, 600, 1200ms
    }
  }
  throw lastErr;
}

function readFileSyncRetry(file, options) {
  return withRetry(() => fs.readFileSync(file, options));
}

function writeFileSyncRetry(file, data, options) {
  return withRetry(() => fs.writeFileSync(file, data, options));
}

module.exports = { readFileSyncRetry, writeFileSyncRetry, withRetry, isTransient };
