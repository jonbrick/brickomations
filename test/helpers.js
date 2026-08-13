// Minimal assertion helpers. Deliberately dependency-free — brickbot has no test
// framework and adding one for a handful of pure functions isn't worth the
// install. Each test file exports an array of [name, fn] and throws to fail.

function assert(condition, message) {
  if (!condition) throw new Error(message || "assertion failed");
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message || "assertEqual"}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`
    );
  }
}

module.exports = { assert, assertEqual };
