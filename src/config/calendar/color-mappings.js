/**
 * Color Mappings Configuration
 * Maps Google Calendar color IDs to category names for Personal and Work calendars
 *
 * This file preserves the color mappings even if the archive folder is deleted.
 * Based on Google Calendar's predefined color palette.
 */

// Personal Calendar Color Mappings
// Maps colorId (string) to category object with category key and display name
const PERSONAL_COLOR_MAPPING = {
  2: { category: "personal", displayName: "Personal" }, // Sage/Green (default)
  3: { category: "interpersonal", displayName: "Interpersonal" }, // Grape - Handled by interpersonal matcher for family/relationship split
  5: { category: "home", displayName: "Home" }, // Banana
  8: { category: "physicalHealth", displayName: "Physical Health" }, // Graphite
  9: { category: "ignore", displayName: "Ignore" }, // Blueberry
  11: { category: "mentalHealth", displayName: "Mental Health" }, // Tomato/Red
};

// Work Calendar Color Mappings (for future use)
// Maps colorId (string) to category object with category key and display name
// Color names below match Google's event-color palette (colorId → name) documented
// at the bottom of this file. colorId 1 (Lavender) is the calendar's default; work
// events left uncolored arrive as colorId=null and fall through to "meetings".
// Re-mapped 2026-08-17 to match the relabeled Google Calendar color legend
// (verified against live events: Design Crit=5, interviews=10, standups=4,
// A&G Update=9, OpEx iteration=2, Focus Lab=1).
const WORK_COLOR_MAPPING = {
  1: { category: "marketing", displayName: "Marketing & Branding" }, // Lavender (explicitly colored; uncolored events default to Meetings)
  2: { category: "design", displayName: "Design" }, // Sage
  3: { category: "marketing", displayName: "Marketing & Branding" }, // Grape (both purples map to marketing; keyword rule also catches uncolored)
  4: { category: "rituals", displayName: "Rituals" }, // Flamingo
  5: { category: "critique", displayName: "Critique" }, // Banana
  6: { category: "qa", displayName: "QA" }, // Tangerine
  7: { category: "coding", displayName: "Coding" }, // Peacock
  8: { category: "personal", displayName: "Personal" }, // Graphite
  9: { category: "workAdmin", displayName: "Work Admin" }, // Blueberry
  10: { category: "hiring", displayName: "Hiring" }, // Basil
  11: { category: "exploration", displayName: "Exploration & Research" }, // Tomato
};

// Keyword-based work category overrides (title-driven, color-independent).
// Google's event palette has only 11 colors and all are assigned above, so a 12th
// category ("Marketing & Branding") can't be keyed on colorId — these events also
// arrive uncolored (colorId=null) from the calendar app, which would otherwise
// bucket them into the "meetings" default. Matched by title before the color lookup.
// Ordered array: first matching rule wins.
const WORK_KEYWORD_CATEGORIES = [
  {
    category: "marketing",
    // "Focus Lab" = the brand agency engagement; "brand"/"branding"/"rebrand(ing)"/"visual
    // strategy" = the work itself. The trailing \b keeps the match to the brand word-family
    // (brand, branding, rebrand, rebranding) while excluding names like "Brandon"/"Brandy".
    pattern: /focus lab|brand(ing)?\b|visual strategy/i,
  },
];

// Events/Trips Category to Color Mapping
// Maps Notion category select values (with emojis) to Google Calendar color IDs
const EVENTS_TRIPS_CATEGORY_TO_COLOR = {
  "🍻 Interpersonal": "3", // Grape
  "💼 Work": "7", // Peacock
  "🌱 Personal": null, // Default
  "❤️ Mental Health": "11", // Tomato (red) — matches personal calendar
  "🏠 Home": "5", // Banana (yellow) — matches personal calendar
  "💪 Physical Health": "8", // Graphite — matches personal calendar
};

// Events Subcategory to Color Mapping (overrides category when set)
// Maps Notion Events Subcategory values to Google Calendar color IDs
const EVENTS_SUBCATEGORY_TO_COLOR = {
  "Wasted day": "11", // Tomato/red
};

// Events Status to Color Mapping (overrides subcategory + category when set)
// "🫥 N/A" = external context (Mercury retrograde, family in Baltimore, etc.)
// Note: "8" Graphite collides with physicalHealth in PERSONAL_COLOR_MAPPING, but
// that map only applies to reads from the personalCalendar — `events` calendar is
// not aggregated through it today. Revisit if personal summary starts ingesting
// the events calendar.
const EVENTS_STATUS_TO_COLOR = {
  "🫥 N/A": "8", // Graphite/grey
};

// Google Calendar event color palette — the one `event.colorId` uses.
// Source: https://developers.google.com/calendar/api/v3/reference/colors (colors.event)
//   "1"  Lavender    "5"  Banana     "9"  Blueberry
//   "2"  Sage        "6"  Tangerine  "10" Basil
//   "3"  Grape       "7"  Peacock    "11" Tomato
//   "4"  Flamingo    "8"  Graphite

/**
 * Get Personal Calendar category key by color ID
 * @param {string|null|undefined} colorId - Google Calendar color ID (e.g., "2", "3", "5", "8", "11")
 * @returns {string} Category key (e.g., "personal", "interpersonal", "home", "physicalHealth", "mentalHealth")
 */
function getPersonalCategoryByColor(colorId) {
  if (!colorId) {
    return "personal"; // Default to personal if no colorId
  }

  const colorInfo = PERSONAL_COLOR_MAPPING[String(colorId)];
  return colorInfo ? colorInfo.category : "personal"; // Default to personal if unmapped
}

/**
 * Get Personal Calendar category display name by color ID
 * @param {string|null|undefined} colorId - Google Calendar color ID (e.g., "2", "3", "5", "8", "11")
 * @returns {string} Category display name (e.g., "Personal", "Interpersonal", "Home", "Physical Health", "Mental Health")
 */
function getPersonalCategoryDisplayName(colorId) {
  if (!colorId) {
    return "Personal"; // Default to Personal if no colorId
  }

  const colorInfo = PERSONAL_COLOR_MAPPING[String(colorId)];
  return colorInfo ? colorInfo.displayName : "Personal"; // Default to Personal if unmapped
}

/**
 * Get enhanced category for personal calendar events
 * Handles interpersonal splitting into family/relationship/interpersonal
 *
 * @param {Object} event - Calendar event with colorId and summary
 * @param {number|null} currentWeekNumber - Current week number (1-53) for relationship matching
 * @param {Array<Object>} relationships - Array of relationship records with activeWeekNumbers
 * @returns {string} Category key
 */
function getEnhancedPersonalCategory(
  event,
  currentWeekNumber = null,
  relationships = [],
) {
  const {
    matchInterpersonalCategory,
  } = require("../../parsers/interpersonal-matcher");

  // Check if it's interpersonal color (3 = Grape)
  if (event.colorId === "3" || event.colorId === 3) {
    return matchInterpersonalCategory(event, currentWeekNumber, relationships);
  }

  // Use standard color mapping for all other colors
  return getPersonalCategoryByColor(event.colorId);
}

/**
 * Get Work Calendar category key by color ID
 * @param {string|null|undefined} colorId - Google Calendar color ID
 * @returns {string} Category key
 */
function getWorkCategoryByColor(colorId) {
  if (!colorId) {
    return "meetings";
  }

  const colorInfo = WORK_COLOR_MAPPING[String(colorId)];
  return colorInfo ? colorInfo.category : "meetings";
}

/**
 * Get Work Calendar category display name by color ID
 * @param {string|null|undefined} colorId - Google Calendar color ID
 * @returns {string} Category display name
 */
function getWorkCategoryDisplayName(colorId) {
  if (!colorId) {
    return "Meetings";
  }

  const colorInfo = WORK_COLOR_MAPPING[String(colorId)];
  return colorInfo ? colorInfo.displayName : "Meetings";
}

/**
 * Match a work event's title against keyword-based category rules.
 * @param {Object} event - Calendar event (uses event.summary)
 * @returns {string|null} Category key if a rule matches, else null
 */
function getWorkKeywordCategory(event) {
  const title = (event && event.summary) || "";
  if (!title) return null;
  const rule = WORK_KEYWORD_CATEGORIES.find((r) => r.pattern.test(title));
  return rule ? rule.category : null;
}

/**
 * Get the work category for an event, preferring a title-keyword match over color.
 * Keyword rules take precedence so color-less categories (e.g. "marketing") work;
 * everything else falls back to the standard colorId mapping.
 * @param {Object} event - Calendar event with summary and colorId
 * @returns {string} Category key
 */
function getEnhancedWorkCategory(event) {
  return getWorkKeywordCategory(event) || getWorkCategoryByColor(event.colorId);
}

/**
 * Get Google Calendar color ID from Notion category value (Events/Trips)
 * @param {string|null} category - Notion category value (e.g., "🍻 Interpersonal", "💼 Work", "🌱 Personal")
 * @returns {string|null} Google Calendar color ID or null if no color
 */
function getColorIdFromNotionCategory(category) {
  if (!category) return null;
  return EVENTS_TRIPS_CATEGORY_TO_COLOR[category] || null;
}

/**
 * Get Google Calendar color ID for a Notion Event
 * Precedence: Status > Subcategory > Category
 * @param {string|null} category - Notion Events Category value
 * @param {string|Array|null} subcategory - Notion Events Subcategory value (may be array from multi-select)
 * @param {string|null} status - Notion Events Status value (e.g., "🫥 N/A")
 * @returns {string|null} Google Calendar color ID or null if no color
 */
function getColorIdForNotionEvent(category, subcategory, status) {
  if (status != null && EVENTS_STATUS_TO_COLOR[status] !== undefined) {
    return EVENTS_STATUS_TO_COLOR[status];
  }
  const sub = Array.isArray(subcategory) ? subcategory[0] : subcategory;
  if (sub != null && EVENTS_SUBCATEGORY_TO_COLOR[sub] !== undefined) {
    return EVENTS_SUBCATEGORY_TO_COLOR[sub];
  }
  return getColorIdFromNotionCategory(category);
}

module.exports = {
  PERSONAL_COLOR_MAPPING,
  WORK_COLOR_MAPPING,
  EVENTS_TRIPS_CATEGORY_TO_COLOR,
  EVENTS_SUBCATEGORY_TO_COLOR,
  EVENTS_STATUS_TO_COLOR,
  getPersonalCategoryByColor,
  getPersonalCategoryDisplayName,
  getEnhancedPersonalCategory,
  getWorkCategoryByColor,
  getWorkCategoryDisplayName,
  getWorkKeywordCategory,
  getEnhancedWorkCategory,
  getColorIdFromNotionCategory,
  getColorIdForNotionEvent,
};
