// Guards the side → lane grouping Events and Trips render with (two-field
// category model, migrated 2026-10-16) and the lane-first color precedence
// the calendar push uses. The asymmetry that matters: a lane that falls out
// of canonical order silently flattens the readout, and a lane color that
// loses to the side recolors ~240 calendar events on the next sync.

const { assert, assertEqual } = require("./helpers");
const {
  groupBySideAndLane,
  sideLaneLines,
  laneTag,
  PERSONAL_LANES,
  WORK_LANES,
  NO_LANE,
} = require("../cli/render-events-trips");
const {
  getColorIdForNotionEvent,
  getColorIdFromNotionCategory,
} = require("../src/config/calendar/color-mappings");

const ev = (o) => ({ "Event Name": "x", Status: "🟢 Done", ...o });

module.exports = {
  // --- grouping ---
  "lane order follows the task-category maps (one source of truth)"() {
    assertEqual(PERSONAL_LANES[0], "🎸 Hobbies");
    assertEqual(PERSONAL_LANES[PERSONAL_LANES.length - 1], "🌱 Admin");
    assertEqual(WORK_LANES[0], "🎨 Design");
    assertEqual(WORK_LANES[WORK_LANES.length - 1], "💼 Admin");
  },
  "sides come personal, work, n/a; lanes in canonical order"() {
    const g = groupBySideAndLane([
      ev({ Category: "💼 Work", "WORK Category": "💼 Admin" }),
      ev({ Category: "🫥 N/A" }),
      ev({ Category: "🌱 Personal", "PERSONAL Category": "❤️ Mental Health" }),
      ev({ Category: "🌱 Personal", "PERSONAL Category": "🎸 Hobbies" }),
      ev({ Category: "💼 Work", "WORK Category": "🤝 Hiring & Team" }),
    ]);
    assertEqual(g.map((s) => s.key).join(","), "personal,work,na");
    assertEqual(g[0].lanes.map((l) => l.lane).join(","), "🎸 Hobbies,❤️ Mental Health");
    assertEqual(g[1].lanes.map((l) => l.lane).join(","), "🤝 Hiring & Team,💼 Admin");
    assertEqual(g[2].lanes[0].lane, null, "n/a has no lane heading");
    assertEqual(g[2].count, 1);
  },
  "a record with no lane lands under (no lane), after the canonical lanes"() {
    const g = groupBySideAndLane([
      ev({ Category: "🌱 Personal" }),
      ev({ Category: "🌱 Personal", "PERSONAL Category": "🌱 Admin" }),
    ]);
    assertEqual(g[0].lanes.map((l) => l.lane).join(","), `🌱 Admin,${NO_LANE}`);
  },
  "an empty side is omitted, not rendered as (0)"() {
    const g = groupBySideAndLane([ev({ Category: "💼 Work", "WORK Category": "🎨 Design" })]);
    assertEqual(g.length, 1);
    assertEqual(g[0].key, "work");
  },
  "a blank Category reads as personal"() {
    const g = groupBySideAndLane([ev({ "PERSONAL Category": "🏠 Home" })]);
    assertEqual(g[0].key, "personal");
  },
  "items keep input order inside a lane (callers sort by date first)"() {
    const g = groupBySideAndLane([
      ev({ "Event Name": "b", Category: "🌱 Personal", "PERSONAL Category": "🎸 Hobbies" }),
      ev({ "Event Name": "a", Category: "🌱 Personal", "PERSONAL Category": "🎸 Hobbies" }),
    ]);
    assertEqual(g[0].lanes[0].items.map((r) => r["Event Name"]).join(""), "ba");
  },

  // --- tags ---
  "laneTag carries side · lane · type · status, flattening a multi-select"() {
    assertEqual(
      laneTag({
        Category: "🌱 Personal",
        "PERSONAL Category": "🍻 Interpersonal",
        Subcategory: ["💜 Family Trip", "🎄 Family Holidays"],
        Status: "🟢 Done",
      }),
      "🌱 Personal · 🍻 Interpersonal · 💜 Family Trip · 🎄 Family Holidays · 🟢 Done"
    );
    assertEqual(
      laneTag({ Category: "💼 Work", "WORK Category": "🤝 Hiring & Team" }),
      "💼 Work · 🤝 Hiring & Team"
    );
    assertEqual(laneTag(null), "");
  },

  // --- rendering ---
  "sideLaneLines renders title → side → lane → item with stepped indents"() {
    const lines = sideLaneLines(
      "EVENTS (2)",
      [
        ev({ "Event Name": "Kara last day", Category: "💼 Work", "WORK Category": "🤝 Hiring & Team" }),
        ev({ "Event Name": "Mercury", Category: "🫥 N/A" }),
      ],
      (r) => r["Event Name"]
    );
    assertEqual(
      lines.join("\n"),
      [
        "EVENTS (2)",
        "  💼 work (1)",
        "    🤝 Hiring & Team",
        "      Kara last day",
        "  🫥 n/a (1)",
        "    Mercury",
      ].join("\n")
    );
  },
  "sideLaneLines honors a caller indent (UPCOMING nests one level deeper)"() {
    const lines = sideLaneLines(
      "  Events (1)",
      [ev({ "Event Name": "x", Category: "🌱 Personal", "PERSONAL Category": "🏠 Home" })],
      () => "item",
      "    "
    );
    assertEqual(lines[1], "    🌱 personal (1)");
    assertEqual(lines[2], "      🏠 Home");
    assertEqual(lines[3], "        item");
  },
  "sideLaneLines with no records is just the title"() {
    assertEqual(sideLaneLines("TRIPS (0)", [], () => "").join("\n"), "TRIPS (0)");
  },

  // --- color precedence (calendar push) ---
  "lane color beats the side color"() {
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "🍻 Interpersonal"), "3");
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "❤️ Mental Health"), "11");
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "🏠 Home"), "5");
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "💪 Physical Health"), "8");
  },
  "a lane with no legend color falls back to the side"() {
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "🎸 Hobbies"), null);
    assertEqual(getColorIdFromNotionCategory("💼 Work", "💡 Exploration"), "7");
    assertEqual(getColorIdFromNotionCategory("💼 Work", null), "7");
    assertEqual(getColorIdFromNotionCategory(null, null), null);
  },
  "status and subcategory overrides still beat the lane"() {
    assertEqual(getColorIdForNotionEvent("🌱 Personal", null, "🫥 N/A", "🍻 Interpersonal"), "8");
    assertEqual(getColorIdForNotionEvent("🌱 Personal", "😔 Wasted Day", "🟢 Done", "🎸 Hobbies"), "11");
    assertEqual(getColorIdForNotionEvent("🌱 Personal", "🏈 Sports Event", "🟢 Done", "💪 Physical Health"), "8");
    assertEqual(getColorIdForNotionEvent("🌱 Personal", ["🍻 Friends Trip"], "🟢 Done", "🍻 Interpersonal"), "3");
  },
  "work events ride one color regardless of lane"() {
    for (const lane of WORK_LANES) {
      assertEqual(getColorIdForNotionEvent("💼 Work", "🏝️ Work OOO", "🟢 Done", lane), "7", lane);
    }
    assert(true);
  },
};
