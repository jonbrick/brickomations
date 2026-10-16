// Guards the side → type grouping Events and Trips render with (restructured
// 2026-10-16: Category is the side, the type lives in PERSONAL Category /
// WORK Category for events and Subcategory for trips) and the type-first color
// precedence the calendar push uses. A type that falls out of first-record
// order silently scrambles the readout; a type color that loses to the side
// recolors ~240 calendar events on the next sync.

const { assert, assertEqual } = require("./helpers");
const {
  groupBySideAndType,
  sideTypeLines,
  typeTag,
  typeOf,
  NO_TYPE,
} = require("../cli/render-events-trips");
const {
  getColorIdForNotionEvent,
  getColorIdFromNotionCategory,
} = require("../src/config/calendar/color-mappings");

const ev = (o) => ({ "Event Name": "x", Status: "🟢 Done", ...o });

module.exports = {
  // --- grouping ---
  "sides come personal, work, n/a; types in first-record order"() {
    const g = groupBySideAndType([
      ev({ Category: "💼 Work", "WORK Category": "🏝️ Work OOO" }),
      ev({ Category: "🫥 N/A" }),
      ev({ Category: "🌱 Personal", "PERSONAL Category": "🩺 Medical" }),
      ev({ Category: "🌱 Personal", "PERSONAL Category": "🏈 Sports Event" }),
      ev({ Category: "🌱 Personal", "PERSONAL Category": "🩺 Medical" }),
      ev({ Category: "💼 Work", "WORK Category": "🍸 Work Social" }),
    ]);
    assertEqual(g.map((s) => s.key).join(","), "personal,work,na");
    assertEqual(g[0].types.map((t) => t.type).join(","), "🩺 Medical,🏈 Sports Event");
    assertEqual(g[0].types[0].items.length, 2);
    assertEqual(g[1].types.map((t) => t.type).join(","), "🏝️ Work OOO,🍸 Work Social");
    assertEqual(g[2].types[0].type, null, "n/a has no type heading");
  },
  "a record with no type lands under (no type), last"() {
    const g = groupBySideAndType([
      ev({ Category: "💼 Work" }),
      ev({ Category: "💼 Work", "WORK Category": "🚀 Work Milestone" }),
    ]);
    assertEqual(g[0].types.map((t) => t.type).join(","), `🚀 Work Milestone,${NO_TYPE}`);
  },
  "a trip's multi-select Subcategory is the type, joined"() {
    assertEqual(typeOf({ Category: "💼 Work", Subcategory: ["🌱 Personal Trip", "💼 Work Trip"] }), "🌱 Personal Trip · 💼 Work Trip");
    assertEqual(typeOf({ Category: "🌱 Personal", Subcategory: ["💜 Family Trip"] }), "💜 Family Trip");
    assertEqual(typeOf({ Category: "🌱 Personal", Subcategory: [] }), "");
  },
  "an empty side is omitted, a blank Category reads as personal"() {
    const g = groupBySideAndType([ev({ "PERSONAL Category": "🏠 Home Updates" })]);
    assertEqual(g.length, 1);
    assertEqual(g[0].key, "personal");
  },

  // --- tags ---
  "typeTag carries side · type · status"() {
    assertEqual(
      typeTag({ Category: "💼 Work", "WORK Category": "🚀 Work Milestone", Status: "🟢 Done" }),
      "💼 Work · 🚀 Work Milestone · 🟢 Done"
    );
    assertEqual(typeTag({ Category: "🫥 N/A", Status: "🟡 Scheduled" }), "🫥 N/A · 🟡 Scheduled");
    assertEqual(typeTag(null), "");
  },

  // --- rendering ---
  "sideTypeLines renders title → side → type → item with stepped indents"() {
    const lines = sideTypeLines(
      "EVENTS (2)",
      [
        ev({ "Event Name": "Kara last day", Category: "💼 Work", "WORK Category": "🚀 Work Milestone" }),
        ev({ "Event Name": "Mercury", Category: "🫥 N/A" }),
      ],
      (r) => r["Event Name"]
    );
    assertEqual(
      lines.join("\n"),
      ["EVENTS (2)", "  💼 work (1)", "    🚀 Work Milestone", "      Kara last day", "  🫥 n/a (1)", "    Mercury"].join("\n")
    );
  },
  "sideTypeLines honors a caller indent (UPCOMING nests one level deeper)"() {
    const lines = sideTypeLines("  Events (1)", [ev({ Category: "🌱 Personal", "PERSONAL Category": "🎸 Concerts" })], () => "item", "    ");
    assertEqual(lines[1], "    🌱 personal (1)");
    assertEqual(lines[2], "      🎸 Concerts");
    assertEqual(lines[3], "        item");
  },
  "sideTypeLines with no records is just the title"() {
    assertEqual(sideTypeLines("TRIPS (0)", [], () => "").join("\n"), "TRIPS (0)");
  },

  // --- color precedence (calendar push) ---
  "a type's color beats the side color"() {
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "💜 Family Event"), "3");
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "🏠 Home Updates"), "5");
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "🏃 Race"), "8");
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "😔 Wasted Day"), "11");
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "💜 Family Trip"), "3", "trip type");
  },
  "green and default types fall back to the side; work types ride Peacock"() {
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "🎸 Concerts"), null);
    assertEqual(getColorIdFromNotionCategory("🌱 Personal", "🩺 Medical"), null);
    assertEqual(getColorIdFromNotionCategory("💼 Work", "🏝️ Work OOO"), "7");
    assertEqual(getColorIdFromNotionCategory("💼 Work", null), "7");
    assertEqual(getColorIdFromNotionCategory(null, null), null);
  },
  "the status override still beats the type"() {
    assertEqual(getColorIdForNotionEvent("🌱 Personal", "💜 Family Event", "🫥 N/A"), "8");
    assertEqual(getColorIdForNotionEvent("🌱 Personal", "💜 Family Event", "🟢 Done"), "3");
    assert(true);
  },
};
