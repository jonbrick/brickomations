// Guards the weekly rollup's title filter. `Planned:` blocks are /plan-week's
// intent markers on the main personal calendar — the actuals live on the habit
// calendars — so the summarizer must drop them, or a planned workout counts as
// a workout (weeks 29 and 38 of 2026 froze that way before this filter). The
// prefix test is deliberately not a substring test: "Unplanned hang" is a real
// event.
//
// Requires the repo's .env (src/config validates env on load), same as the
// summarizer itself.

const { assert, assertEqual } = require("./helpers");
const { isExcludedSummary } = require("../src/summarizers/summarize-calendar");
const { CALENDARS } = require("../src/config/unified-sources");

// The live personal-calendar config, so a config regression fails here too.
const PERSONAL = {
  excludeKeywords: CALENDARS.personalCalendar.excludeKeywords,
  excludePrefixes: CALENDARS.personalCalendar.excludePrefixes,
};

module.exports = {
  "the personal calendar config carries the Planned: prefix"() {
    assert(
      (CALENDARS.personalCalendar.excludePrefixes || []).includes("Planned:"),
      "personalCalendar.excludePrefixes must include Planned:"
    );
  },
  "a Planned: block is dropped from the personal rollup"() {
    for (const title of [
      "Planned: Workout",
      "Planned: Early wake-up",
      "Planned: Bed",
      "Planned: Dinner out",
      "planned: Cook — Roast chicken",
      "  Planned: 💪 Personal Training with Randy",
    ]) {
      assertEqual(isExcludedSummary(title, PERSONAL), true, title);
    }
  },
  "a title that merely contains 'planned' survives"() {
    for (const title of [
      "Unplanned hang with Sarika",
      "Review what we planned",
      "Planned obsolescence doc read",
    ]) {
      assertEqual(isExcludedSummary(title, PERSONAL), false, title);
    }
  },
  "keyword excludes still match anywhere in the title"() {
    assertEqual(isExcludedSummary("Afternoon nap", PERSONAL), true, "nap");
    assertEqual(isExcludedSummary("Sleep in", PERSONAL), true, "sleep");
    assertEqual(isExcludedSummary("Afternoon Workout", PERSONAL), false, "workout");
  },
  "no options means nothing is excluded"() {
    assertEqual(isExcludedSummary("Planned: Workout"), false);
    assertEqual(isExcludedSummary("Afternoon nap", {}), false);
  },
  "an empty or missing title never throws"() {
    assertEqual(isExcludedSummary("", PERSONAL), false);
    assertEqual(isExcludedSummary(null, PERSONAL), false);
    assertEqual(isExcludedSummary(undefined, PERSONAL), false);
  },
};
