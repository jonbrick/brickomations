#!/usr/bin/env node

// Test runner. Discovers test/*.test.js, runs every exported case, reports.
// Usage: yarn test [substring]   — substring filters by test name.

const fs = require("fs");
const path = require("path");

const filter = process.argv[2] || "";
const testDir = __dirname;

const files = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

let pass = 0;
let fail = 0;
const failures = [];

for (const file of files) {
  const cases = require(path.join(testDir, file));
  const names = Object.keys(cases).filter((n) => n.includes(filter));
  if (names.length === 0) continue;

  console.log(`\n${file}`);
  for (const name of names) {
    try {
      cases[name]();
      console.log(`  ✓ ${name}`);
      pass++;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`      ${error.message}`);
      failures.push(`${file} → ${name}: ${error.message}`);
      fail++;
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
