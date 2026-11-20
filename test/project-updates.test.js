// Pins the Linear project update → 📣 2026 Project Updates row shaping:
// absolute-date titles, health labels, and Linear upload images turned
// into links (they can't render in Notion without a Linear session).

const { assertEqual } = require("./helpers");
const {
  absoluteDate,
  bodyMarkdown,
  syncedValues,
} = require("../src/workflows/linear-to-notion-project-updates");

const update = {
  Id: "u-1",
  Project: "[PD] People at Cortex",
  "Project Id": "p-1",
  Author: "Jon Brick",
  Date: "2026-11-19",
  Health: "atRisk",
  Changes: "**Status**: Planned",
  Body: "Good meetings",
  URL: "https://linear.app/x",
};

module.exports = {
  "absoluteDate prefixes the weekday"() {
    assertEqual(absoluteDate("2026-11-19"), "Thu 2026-11-19", "Thursday");
    assertEqual(absoluteDate("2026-11-15"), "Sun 2026-11-15", "Sunday");
    assertEqual(absoluteDate(""), "", "empty");
  },

  "title is project plus absolute date"() {
    assertEqual(
      syncedValues(update, "abc").Name,
      "[PD] People at Cortex — Thu 2026-11-19",
      "Name"
    );
  },

  "health maps to labeled options; unknown clears"() {
    assertEqual(syncedValues(update, "abc").Health, "🟡 At risk", "atRisk");
    assertEqual(syncedValues({ ...update, Health: "onTrack" }, "abc").Health, "🟢 On track", "onTrack");
    assertEqual(syncedValues({ ...update, Health: "" }, "abc").Health, "", "none");
  },

  "changes drop markdown emphasis"() {
    assertEqual(
      syncedValues(
        { ...update, Changes: "**Status**: Planned\n\n*Progress since Nov 12*: 0% → 13%" },
        "abc"
      ).Changes,
      "Status: Planned\n\nProgress since Nov 12: 0% → 13%",
      "Changes"
    );
  },

  "author passes through; missing author clears"() {
    assertEqual(syncedValues(update, "abc").Author, "Jon Brick", "author");
    assertEqual(syncedValues({ ...update, Author: "" }, "abc").Author, "", "none");
  },

  "project lead syncs as Linear Lead; unassigned clears"() {
    const { syncedValues: projectValues } = require("../src/workflows/linear-to-notion-projects");
    const project = { Name: "[PD] Harness CI", State: "started", Id: "p-2", URL: "u" };
    assertEqual(projectValues({ ...project, Lead: "mykola.sem" })["Linear Lead"], "mykola.sem", "lead");
    assertEqual(projectValues(project)["Linear Lead"], "", "no lead");
  },

  "unresolved project leaves the relation empty"() {
    assertEqual(syncedValues(update, undefined).Project, "", "Project");
    assertEqual(syncedValues(update, "abc").Project, "abc", "Project");
  },

  "pre-formatted relations pass through the Notion formatter"() {
    const NotionDatabase = require("../src/databases/NotionDatabase");
    const formatted = NotionDatabase.prototype._formatProperties.call(
      {},
      { "💎 2026 Projects": { relation: [{ id: "abc" }] } }
    );
    assertEqual(
      JSON.stringify(formatted["💎 2026 Projects"]),
      JSON.stringify({ relation: [{ id: "abc" }] }),
      "relation"
    );
  },

  "images become links, plain links stay"() {
    assertEqual(
      bodyMarkdown("See ![shot.png](https://uploads.linear.app/a) and [Figma](https://figma.com/b)"),
      "See [🖼️ shot.png](https://uploads.linear.app/a) and [Figma](https://figma.com/b)",
      "body"
    );
    assertEqual(bodyMarkdown("![](https://u/a)"), "[🖼️ image](https://u/a)", "no alt");
    assertEqual(bodyMarkdown(""), "", "empty");
  },
};
