// Guards how work calendar events and tasks land in summary categories.
// Thu 2026-11-19: the work calendar moved to named event labels — Whiteboarding
// has no legacy colorId at all — and the old colorId table had drifted (bug
// bashes counted as Exploration, lunch as Work Admin). Every mapped value must
// also be a summary category, or the event/task drops out of the weekly
// summary without an error.

const { assert, assertEqual } = require("./helpers");
const {
  WORK_LABEL_MAPPING,
  WORK_COLOR_MAPPING,
  getEnhancedWorkCategory,
} = require("../src/config/calendar/color-mappings");
const {
  WORK_TASK_CATEGORY_MAPPING,
  PERSONAL_TASK_CATEGORY_MAPPING,
  getWorkCategoryKey,
  getPersonalCategoryKey,
} = require("../src/config/notion/task-categories");
const { CALENDARS } = require("../src/config/unified-sources");

const ev = (o) => ({ summary: "x", colorId: null, labelName: null, ...o });

module.exports = {
  // --- calendar ---
  "a label-only event (no colorId) classifies by label name"() {
    assertEqual(getEnhancedWorkCategory(ev({ labelName: "Whiteboarding" })), "whiteboarding");
  },
  "label name beats colorId"() {
    assertEqual(getEnhancedWorkCategory(ev({ labelName: "Research", colorId: "2" })), "research");
  },
  "an unmatched label name falls back to colorId"() {
    // "Exploration & Research" before its rename to "Research" — colorId 6
    assertEqual(getEnhancedWorkCategory(ev({ labelName: "Exploration & Research", colorId: "6" })), "research");
  },
  "colorIds match the live labels"() {
    const want = { 1: "marketing", 2: "design", 3: "coding", 4: "rituals", 5: "critique", 6: "research", 8: "workAdmin", 9: "personal", 10: "hiring", 11: "qa" };
    for (const [id, cat] of Object.entries(want)) {
      assertEqual(getEnhancedWorkCategory(ev({ colorId: id })), cat, `colorId ${id}`);
    }
  },
  "uncolored events are meetings"() {
    assertEqual(getEnhancedWorkCategory(ev({})), "meetings");
  },
  "a brand keyword still wins over label and color"() {
    assertEqual(getEnhancedWorkCategory(ev({ summary: "MC Brand Review", labelName: "Design", colorId: "2" })), "marketing");
  },
  "every label and colorId category is a work calendar category"() {
    const cats = CALENDARS.workCalendar.categories;
    for (const cat of Object.values(WORK_LABEL_MAPPING)) assert(cats[cat], `label → ${cat} missing`);
    for (const { category } of Object.values(WORK_COLOR_MAPPING)) assert(cats[category], `colorId → ${category} missing`);
  },

  // --- tasks ---
  "work task options map exactly, emoji included"() {
    assertEqual(getWorkCategoryKey("✏️ Whiteboarding"), "whiteboarding");
    assertEqual(getWorkCategoryKey("🧪 Research"), "research");
    assertEqual(getWorkCategoryKey("💡 Exploration"), null);
    assertEqual(getPersonalCategoryKey("🧪 Research"), "research");
  },
  "every task option maps to a summary category"() {
    for (const cat of Object.values(WORK_TASK_CATEGORY_MAPPING)) {
      assert(CALENDARS.workTasks.categories[cat], `work task → ${cat} missing`);
    }
    for (const cat of Object.values(PERSONAL_TASK_CATEGORY_MAPPING)) {
      assert(CALENDARS.tasks.categories[cat], `personal task → ${cat} missing`);
    }
  },
};
