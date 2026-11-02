// Guards the Notion read-retry. On Mon 2026-11-02 the 5:00 PM `yarn sync`
// died on one 502 during the summaries pull:
//
//   ❌ Error: Failed to query database with pagination: Request to Notion API
//   failed with status: 502
//
// @notionhq/client makes one attempt; config.sources.retryConfig existed but
// nothing read it. These cases pin the schedule, the retryable set, and — the
// part that matters for data safety — that writes still never retry.

const { assert, assertEqual } = require("./helpers");
const { withRetry, isRetryable, backoffMs } = require("../src/utils/retry");
const NotionDatabase = require("../src/databases/NotionDatabase");

// Mirrors config.sources.retryConfig so a config edit can't silently move
// these expectations; `sleep` records waits instead of sleeping.
function harness(overrides = {}) {
  const waits = [];
  const options = {
    maxRetries: 3,
    initialBackoffMs: 1000,
    maxBackoffMs: 10000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    sleep: async (ms) => waits.push(ms),
    ...overrides,
  };
  return { waits, options };
}

// Shapes match @notionhq/client: UnknownHTTPResponseError carries `status`;
// RequestTimeoutError carries only `code`.
function httpError(status, extra = {}) {
  return Object.assign(
    new Error(`Request to Notion API failed with status: ${status}`),
    { code: "notionhq_client_response_error", status, ...extra }
  );
}

function failingThen(errors, value = "ok") {
  const calls = { count: 0 };
  const fn = async () => {
    calls.count++;
    if (errors.length > 0) throw errors.shift();
    return value;
  };
  return { fn, calls };
}

// Bypasses the constructor (which needs a Notion token) and installs a fake
// client, so the wiring inside the real methods is what gets exercised.
function fakeDb(client) {
  const db = Object.create(NotionDatabase.prototype);
  db.client = client;
  db.retryOptions = { sleep: async () => {} };
  return db;
}

module.exports = {
  async "a 502 gets a second try and the read succeeds"() {
    const { waits, options } = harness();
    const { fn, calls } = failingThen([httpError(502)]);
    const result = await withRetry(fn, options);
    assertEqual(result, "ok", "resolves with the eventual answer");
    assertEqual(calls.count, 2, "one retry");
    assertEqual(waits.join(","), "1000", "waited the initial backoff");
  },

  async "backoff doubles each retry and the last error surfaces unchanged"() {
    const { waits, options } = harness();
    const last = httpError(503);
    const { fn, calls } = failingThen([
      httpError(502),
      httpError(500),
      httpError(504),
      last,
    ]);
    let thrown;
    try {
      await withRetry(fn, options);
    } catch (error) {
      thrown = error;
    }
    assert(thrown === last, "rethrows the final error object as-is");
    assertEqual(calls.count, 4, "1 try + 3 retries");
    assertEqual(waits.join(","), "1000,2000,4000", "1s → 2s → 4s");
  },

  "backoff caps at maxBackoffMs"() {
    const cfg = { initialBackoffMs: 1000, backoffMultiplier: 2, maxBackoffMs: 10000 };
    assertEqual(backoffMs(0, cfg), 1000);
    assertEqual(backoffMs(3, cfg), 8000);
    assertEqual(backoffMs(4, cfg), 10000, "16s is capped to 10s");
    assertEqual(backoffMs(9, cfg), 10000);
  },

  async "a 4xx validation error is not retried"() {
    const { waits, options } = harness();
    const { fn, calls } = failingThen([
      httpError(400, { code: "validation_error" }),
    ]);
    let thrown;
    try {
      await withRetry(fn, options);
    } catch (error) {
      thrown = error;
    }
    assertEqual(thrown && thrown.status, 400, "surfaces the 400");
    assertEqual(calls.count, 1, "no retry");
    assertEqual(waits.length, 0, "no wait");
  },

  async "an error with no status and no known code is not retried"() {
    const { options } = harness();
    const { fn, calls } = failingThen([new TypeError("boom")]);
    let thrown;
    try {
      await withRetry(fn, options);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof TypeError, "surfaces the original error");
    assertEqual(calls.count, 1, "no retry");
  },

  async "a client-side request timeout is retried"() {
    const { options } = harness();
    const timeout = Object.assign(new Error("Request to Notion API has timed out"), {
      code: "notionhq_client_request_timeout",
    });
    const { fn, calls } = failingThen([timeout]);
    const result = await withRetry(fn, options);
    assertEqual(result, "ok");
    assertEqual(calls.count, 2, "one retry");
  },

  async "a 429 honors Retry-After over the backoff schedule"() {
    const { waits, options } = harness();
    const headers = new Map([["retry-after", "7"]]);
    const { fn } = failingThen([
      httpError(429, { code: "rate_limited", headers }),
    ]);
    await withRetry(fn, options);
    assertEqual(waits.join(","), "7000", "waited the header's 7 seconds");
  },

  async "a plain-object Retry-After header works too"() {
    const { waits, options } = harness();
    const { fn } = failingThen([
      httpError(429, { headers: { "retry-after": "2" } }),
    ]);
    await withRetry(fn, options);
    assertEqual(waits.join(","), "2000");
  },

  "isRetryable keys on status first, then known client codes"() {
    const codes = [429, 500, 502, 503, 504];
    assert(isRetryable(httpError(502), codes), "502");
    assert(isRetryable(httpError(429), codes), "429");
    assert(!isRetryable(httpError(404), codes), "404 is final");
    assert(!isRetryable(httpError(401), codes), "401 is final");
    assert(
      isRetryable({ code: "notionhq_client_request_timeout" }, codes),
      "request timeout"
    );
    assert(!isRetryable({ code: "validation_error" }, codes), "unknown code");
    assert(!isRetryable(null, codes), "null");
  },

  async "maxRetries: 0 means one attempt"() {
    const { waits, options } = harness({ maxRetries: 0 });
    const { fn, calls } = failingThen([httpError(502)]);
    let thrown;
    try {
      await withRetry(fn, options);
    } catch (error) {
      thrown = error;
    }
    assertEqual(thrown && thrown.status, 502);
    assertEqual(calls.count, 1);
    assertEqual(waits.length, 0);
  },

  // --- Wiring inside NotionDatabase -------------------------------------

  async "queryDatabaseAll survives a 502 mid-pagination"() {
    const pages = [
      { results: [{ id: "a" }], has_more: true, next_cursor: "c1" },
      { results: [{ id: "b" }], has_more: false, next_cursor: null },
    ];
    let calls = 0;
    const db = fakeDb({
      databases: {
        query: async (opts) => {
          calls++;
          if (calls === 2) throw httpError(502);
          return opts.start_cursor === "c1" ? pages[1] : pages[0];
        },
      },
    });
    const results = await db.queryDatabaseAll("db-id");
    assertEqual(results.map((r) => r.id).join(","), "a,b", "both pages, no duplicates");
    assertEqual(calls, 3, "page 1, failed page 2, retried page 2");
  },

  async "queryDatabaseAll still fails loud once retries are exhausted"() {
    let calls = 0;
    const db = fakeDb({
      databases: {
        query: async () => {
          calls++;
          throw httpError(502);
        },
      },
    });
    let thrown;
    try {
      await db.queryDatabaseAll("db-id");
    } catch (error) {
      thrown = error;
    }
    assert(
      thrown && thrown.message.startsWith("Failed to query database with pagination: "),
      `keeps the caller-facing prefix: ${thrown && thrown.message}`
    );
    assert(thrown.message.includes("status: 502"), "keeps the cause");
    assertEqual(calls, 4, "1 try + 3 retries, then gives up");
  },

  async "getPage and getPageBlocks retry"() {
    let retrieves = 0;
    let lists = 0;
    const db = fakeDb({
      pages: {
        retrieve: async () => {
          retrieves++;
          if (retrieves === 1) throw httpError(503);
          return { id: "p" };
        },
      },
      blocks: {
        children: {
          list: async () => {
            lists++;
            if (lists === 1) throw httpError(502);
            return { results: [{ id: "blk", has_children: false }], has_more: false };
          },
        },
      },
    });
    assertEqual((await db.getPage("p")).id, "p");
    assertEqual(retrieves, 2);
    assertEqual((await db.getPageBlocks("p")).length, 1);
    assertEqual(lists, 2);
  },

  async "writes never retry: a 502 on archivePage throws after one call"() {
    let updates = 0;
    const db = fakeDb({
      pages: {
        update: async () => {
          updates++;
          throw httpError(502);
        },
      },
    });
    let thrown;
    try {
      await db.archivePage("p");
    } catch (error) {
      thrown = error;
    }
    assert(thrown, "throws");
    assertEqual(updates, 1, "exactly one attempt — no duplicate risk");
  },

  async "writes never retry: a 502 on createPage throws after one call"() {
    let creates = 0;
    const db = fakeDb({
      pages: {
        create: async () => {
          creates++;
          throw httpError(502);
        },
      },
    });
    let thrown;
    try {
      await db.createPage("db-id", {});
    } catch (error) {
      thrown = error;
    }
    assert(thrown, "throws");
    assertEqual(creates, 1, "exactly one attempt");
  },
};
