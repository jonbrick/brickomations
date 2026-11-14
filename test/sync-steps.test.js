// Pins the shape of the 2-hourly `yarn sync` Linear step: tasks-only, before
// `pull` (so the same run brings Linear changes down to data/life.json), and
// soft (a Linear failure must not fail the run or its heartbeat).

const { assert, assertEqual } = require("./helpers");
const { STEPS } = require("../cli/sync");

const names = STEPS.map((s) => s.name);
const linear = STEPS.find((s) => s.name === "linear");

module.exports = {
  "sync has a linear step"() {
    assert(linear, `steps: ${names.join(", ")}`);
  },

  "the linear step runs before pull"() {
    assert(names.indexOf("linear") < names.indexOf("pull"), `order: ${names.join(" → ")}`);
  },

  "the linear step is tasks-only on its default window"() {
    assert(linear.cmd.includes("cli/pull-linear.js --tasks-only"), linear.cmd);
    assert(!/--(from|to|date|days)=/.test(linear.cmd), `no window flags: ${linear.cmd}`);
  },

  "the linear step is the only soft step"() {
    assertEqual(linear.soft, true, "linear.soft");
    const soft = STEPS.filter((s) => s.soft).map((s) => s.name);
    assertEqual(soft.join(","), "linear", "soft steps");
  },
};
