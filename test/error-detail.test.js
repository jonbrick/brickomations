// Guards the heartbeat's failure message. On 2026-08-12 the `update` step was
// SIGTERM'd at its timeout and the alert read:
//
//   status=failed: Failed: update: [10/11] Trips | ✅ 2 records → 11 synced | ...
//
// A signal kill emits no error marker, so the extractor fell through to the last
// three stdout lines — which were success lines. An alert that reports success
// on failure is worse than no alert, so these cases pin the behavior down.

const { assert } = require("./helpers");
const { extractErrorDetail } = require("../cli/sync");

module.exports = {
  "a signal kill names the signal and timeout, not the trailing success line"() {
    const stdout = [
      "[10/11] Trips",
      "✅ 2 records → 11 synced | 4 skipped | 0 deleted",
      "",
      "[11/11] Withings (Body Weight)",
    ].join("\n");
    const detail = extractErrorDetail(
      { signal: "SIGTERM", stdout },
      { timeout: 9 * 60 * 1000 }
    );
    assert(detail.includes("SIGTERM"), `names the signal: ${detail}`);
    assert(detail.includes("9min"), `names the limit: ${detail}`);
    assert(!detail.startsWith("✅"), `does not lead with a success line: ${detail}`);
    assert(
      detail.includes("[11/11] Withings"),
      `reports where it died: ${detail}`
    );
  },

  "a signal kill falls back to the default timeout when the step has none"() {
    const detail = extractErrorDetail({ signal: "SIGKILL", stdout: "working" }, {});
    assert(detail.includes("SIGKILL"), detail);
    assert(/\d+min/.test(detail), `still reports a limit: ${detail}`);
  },

  // cli/pull.js marks per-source failures with ✗, not ❌.
  "the pull per-source failure marker is recognized"() {
    const detail = extractErrorDetail(
      {
        status: 1,
        stdout: "  ✓ 151 Restaurants\n  ✗ Museums: Could not find database\n  ✓ 82 Venues",
      },
      {}
    );
    assert(detail.includes("Museums"), detail);
    assert(!detail.includes("Restaurants"), `only the failure: ${detail}`);
  },

  "the standard failure marker still works"() {
    const detail = extractErrorDetail(
      { status: 1, stdout: "doing stuff\n❌ Token refresh failed" },
      {}
    );
    assert(detail.includes("Token refresh failed"), detail);
  },

  "thrown error prefixes are recognized"() {
    const detail = extractErrorDetail(
      { status: 1, stdout: "TypeError: cannot read property x of undefined" },
      {}
    );
    assert(detail.includes("TypeError"), detail);
  },

  "the fallback never reports a success line as the failure"() {
    const detail = extractErrorDetail(
      { status: 2, stdout: "connecting\n✅ 11 sources completed\n✅ Done!" },
      {}
    );
    assert(detail !== null, "should still say something");
    assert(!detail.includes("✅"), `no success lines: ${detail}`);
  },

  "all-success output with a bad exit code yields no bogus detail"() {
    const detail = extractErrorDetail({ status: 3, stdout: "✅ fine\n✅ also fine" }, {});
    assert(detail === null, `expected null, got: ${detail}`);
  },

  "empty output yields no detail"() {
    assert(extractErrorDetail({ status: 1, stdout: "" }, {}) === null);
  },

  "stderr is preferred over stdout"() {
    const detail = extractErrorDetail(
      { status: 1, stderr: "❌ real problem", stdout: "❌ noise" },
      {}
    );
    assert(detail.includes("real problem"), detail);
  },

  "detail stays iMessage-sized"() {
    const detail = extractErrorDetail(
      { signal: "SIGKILL", stdout: "x".repeat(900) },
      { timeout: 60000 }
    );
    assert(detail.length <= 240, `length ${detail.length}`);
  },
};
