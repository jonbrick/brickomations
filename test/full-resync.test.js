// The daily full resync is what makes trusting change detection safe: anything
// the comparison fails to notice is corrected within a day. These cases pin down
// that it fails toward resyncing in every direction, and that one `update` run
// shares a single decision across all its sources.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertEqual } = require("./helpers");
const { isFullResyncDue } = require("../src/workflows/notion-databases-to-calendar");

// Each case gets its own stamp path — the decision is memoized per path, which
// is exactly the production behavior we want to exercise, and it keeps the repo's
// real local/last-full-resync untouched.
let counter = 0;
function tempStamp(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brickomations-resync-"));
  const stamp = path.join(dir, `stamp-${counter++}`);
  if (contents !== undefined) fs.writeFileSync(stamp, contents);
  return stamp;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

module.exports = {
  "no stamp means resync, and the stamp is created"() {
    const stamp = tempStamp();
    assertEqual(isFullResyncDue(stamp), true, "first ever run must resync");
    assertEqual(fs.readFileSync(stamp, "utf8").trim(), localToday(), "stamp written");
  },

  "a stamp dated today allows the fast path"() {
    const stamp = tempStamp(localToday());
    assertEqual(isFullResyncDue(stamp), false);
  },

  "a stale stamp resyncs and is refreshed"() {
    const stamp = tempStamp("2026-01-01");
    assertEqual(isFullResyncDue(stamp), true);
    assertEqual(fs.readFileSync(stamp, "utf8").trim(), localToday(), "stamp refreshed");
  },

  "an unparseable stamp resyncs"() {
    assertEqual(isFullResyncDue(tempStamp("not-a-date\n")), true);
  },

  "an empty stamp resyncs"() {
    assertEqual(isFullResyncDue(tempStamp("")), true);
  },

  // A future-dated stamp (clock skew, hand-editing) must not disable the backstop
  // indefinitely. Only an exact match on today permits the fast path.
  "a future-dated stamp resyncs"() {
    assertEqual(isFullResyncDue(tempStamp("2099-12-31")), true);
  },

  "trailing whitespace in the stamp is tolerated"() {
    assertEqual(isFullResyncDue(tempStamp(`  ${localToday()}  \n`)), false);
  },

  // Events is source 2 and Trips is source 10 of the same `update` process. If
  // the first consumed the stamp, the rest would take the fast path on the run
  // that is supposed to write everything.
  "every source in one run shares the decision"() {
    const stamp = tempStamp("2026-01-01");
    assertEqual(isFullResyncDue(stamp), true, "first source");
    assertEqual(isFullResyncDue(stamp), true, "second source, memoized");
    assertEqual(isFullResyncDue(stamp), true, "third source, memoized");
  },

  "an unwritable stamp location still resyncs"() {
    // Directory that cannot be created — mkdir under a file path.
    const blocker = tempStamp("x");
    assertEqual(isFullResyncDue(path.join(blocker, "nested", "stamp")), true);
  },
};
