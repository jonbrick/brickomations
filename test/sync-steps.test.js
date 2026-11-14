// Pins the shape of `yarn sync`'s tiers and its Linear step.
//   morning / evening — heavy: every step, full Linear pull
//   hourly            — light: no summarize / aggregate / vault-sync / daily-records,
//                       Linear tasks-only
//   (none)            — every step, Linear tasks-only (manual runs, backfills)
// The Linear step always runs before `pull` (so the same run brings Linear
// changes down to data/life.json) and is soft (a Linear failure must not fail
// the run or its heartbeat).

const { assert, assertEqual } = require("./helpers");
const { buildSteps, TIERS } = require("../cli/sync");

const names = (steps) => steps.map((s) => s.name).join(",");
const linearOf = (steps) => steps.find((s) => s.name === "linear");

const HEAVY =
  "tokens:refresh,collect,update,summarize,aggregate,linear,pull,vault-sync,granola-logs,daily-records";
const LIGHT = "tokens:refresh,collect,update,linear,pull,granola-logs";

module.exports = {
  "tiers are morning, evening, hourly"() {
    assertEqual(TIERS.join(","), "morning,evening,hourly", "TIERS");
  },

  "morning and evening run every step"() {
    assertEqual(names(buildSteps("morning", "", "node")), HEAVY, "morning");
    assertEqual(names(buildSteps("evening", "", "node")), HEAVY, "evening");
  },

  "hourly is the light set"() {
    assertEqual(names(buildSteps("hourly", "", "node")), LIGHT, "hourly");
  },

  "an untiered run keeps every step"() {
    assertEqual(names(buildSteps(null, "", "node")), HEAVY, "untiered");
  },

  "morning and evening run the full Linear pull"() {
    for (const tier of ["morning", "evening"]) {
      const cmd = linearOf(buildSteps(tier, "", "node")).cmd;
      assertEqual(cmd, "node cli/pull-linear.js", `${tier} linear cmd`);
    }
  },

  "hourly and untiered runs are Linear tasks-only"() {
    for (const tier of ["hourly", null]) {
      const cmd = linearOf(buildSteps(tier, "", "node")).cmd;
      assertEqual(cmd, "node cli/pull-linear.js --tasks-only", `${tier} linear cmd`);
    }
  },

  "the linear step never takes the sync's date window"() {
    for (const tier of [...TIERS, null]) {
      const cmd = linearOf(buildSteps(tier, " --from=2026-11-01 --to=2026-11-21", "node")).cmd;
      assert(!/--(from|to|date|days)=/.test(cmd), `${tier}: ${cmd}`);
    }
  },

  "linear runs before pull and is the only soft step, in every tier"() {
    for (const tier of [...TIERS, null]) {
      const steps = buildSteps(tier, "", "node");
      const order = steps.map((s) => s.name);
      assert(order.indexOf("linear") < order.indexOf("pull"), `${tier}: ${order.join(" → ")}`);
      assertEqual(steps.filter((s) => s.soft).map((s) => s.name).join(","), "linear", `${tier} soft steps`);
    }
  },
};
