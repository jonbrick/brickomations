/**
 * @layer 2 - Domain (Generic Async Helpers)
 *
 * Retry a read-only API call on transient failures.
 *
 * Backoff schedule and the retryable status list come from
 * config.sources.retryConfig — defined in the config refactor, never consumed
 * until now. The Mon 2026-11-02 5:00 PM `yarn sync` died on a single Notion
 * 502 during the summaries pull with no second attempt; the Wed 2026-10-15 run
 * lost six sources to "Notion is unavailable" the same way.
 *
 * Reads only. A write that 502s may have landed server-side, so retrying it
 * risks a duplicate. Callers wrap queries / retrieves / lists — never
 * creates / updates / deletes / appends.
 */

const config = require("../config");
const { delay } = require("./async");

// @notionhq/client errors that carry no HTTP status but mean "no answer came
// back" — safe to retry for a read.
const RETRYABLE_CLIENT_CODES = new Set(["notionhq_client_request_timeout"]);

/**
 * @param {Error} error
 * @param {number[]} retryableStatusCodes
 * @returns {boolean}
 */
function isRetryable(error, retryableStatusCodes) {
  if (!error) return false;
  if (typeof error.status === "number") {
    return retryableStatusCodes.includes(error.status);
  }
  return RETRYABLE_CLIENT_CODES.has(error.code);
}

/**
 * Honor a Retry-After header (seconds) when the API sends one — Notion does on
 * 429. Works with a fetch Headers instance or a plain object.
 *
 * @param {Error} error
 * @returns {number|null} milliseconds, or null when absent / unparseable
 */
function retryAfterMs(error) {
  const headers = error && error.headers;
  if (!headers) return null;
  const raw =
    typeof headers.get === "function"
      ? headers.get("retry-after")
      : headers["retry-after"];
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/**
 * Exponential backoff for retry number `attempt` (0-based), capped.
 *
 * @param {number} attempt
 * @param {{initialBackoffMs: number, backoffMultiplier: number, maxBackoffMs: number}} cfg
 * @returns {number} milliseconds
 */
function backoffMs(attempt, cfg) {
  return Math.min(
    cfg.initialBackoffMs * Math.pow(cfg.backoffMultiplier, attempt),
    cfg.maxBackoffMs
  );
}

/**
 * Run `fn`, retrying on transient failures.
 *
 * @param {(attempt: number) => Promise<any>} fn - The read to perform; gets the
 *   0-based attempt number
 * @param {Object} [options] - Overrides for config.sources.retryConfig
 *   (maxRetries, initialBackoffMs, maxBackoffMs, backoffMultiplier,
 *   retryableStatusCodes), plus `sleep` to swap the delay in tests
 * @returns {Promise<any>} Whatever `fn` resolves to
 * @throws The last error once retries are exhausted, or the first
 *   non-retryable error immediately
 */
async function withRetry(fn, options = {}) {
  const cfg = { ...config.sources.retryConfig, ...options };
  const sleep = options.sleep || delay;

  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (error) {
      const exhausted = attempt >= cfg.maxRetries;
      if (exhausted || !isRetryable(error, cfg.retryableStatusCodes)) {
        throw error;
      }
      const wait = retryAfterMs(error) ?? backoffMs(attempt, cfg);
      attempt++;
      await sleep(wait);
    }
  }
}

module.exports = { withRetry, isRetryable, retryAfterMs, backoffMs };
