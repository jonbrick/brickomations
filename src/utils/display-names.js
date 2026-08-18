/**
 * Display name utilities for CLI output
 * Provides short names for groups and categories with override support
 */

/**
 * Override lookup for short names where derivation doesn't work
 */
const SHORT_NAME_OVERRIDES = {
  // SUMMARY_GROUPS overrides
  drinkingDays: "Drinking",
  videoGames: "Games",
  bodyWeight: "Weight",
  bloodPressure: "BP",
  personalPRs: "PRs",
  workPRs: "PRs",
  personalCalendar: "Calendar",
  workCalendar: "Calendar",

  // Category overrides
  physicalHealth: "Physical",
  mentalHealth: "Mental",
  workAdmin: "Work Admin",

  // Field-specific overrides
  avgSystolic: "Systolic",
  avgDiastolic: "Diastolic",
};

/**
 * Get short display name for a SUMMARY_GROUP
 * @param {string} groupId - Group identifier (e.g., "sleep", "workout")
 * @param {string} fullName - Full name from group.name (e.g., "Sleep (Early Wakeup + Sleep In)")
 * @returns {string} Short name for display (e.g., "Sleep")
 */
function getGroupShortName(groupId, fullName) {
  if (SHORT_NAME_OVERRIDES[groupId]) {
    return SHORT_NAME_OVERRIDES[groupId];
  }
  // Derive: "Sleep (Early Wakeup + Sleep In)" → "Sleep"
  return fullName ? fullName.split(" (")[0] : groupId;
}

/**
 * Get short display name for a category or field
 * @param {string} key - Category key or field key (e.g., "physicalHealth", "avgSystolic")
 * @param {string} label - Label from dataField (e.g., "Physical Health Sessions")
 * @returns {string} Short name for display (e.g., "Physical")
 */
function getCategoryShortName(key, label) {
  if (SHORT_NAME_OVERRIDES[key]) {
    return SHORT_NAME_OVERRIDES[key];
  }
  // Derive: "Early Wakeup - Days" → "Early Wakeup"
  return label ? label.split(" - ")[0] : key;
}

/**
 * Format a record for logging output
 * @param {Object} record - Record object with displayName, name, or other identifying fields
 * @param {string} sourceType - Source type (e.g., "withings", "oura", "strava")
 * @returns {string} Formatted string for logging
 */
function formatRecordForLogging(record, sourceType) {
  // Prefer displayName if available (used by sync workflows)
  if (record.displayName) {
    return record.displayName;
  }
  
  // Fallback to name field
  if (record.name) {
    return record.name;
  }
  
  // Last resort: use source-specific identifiers
  switch (sourceType) {
    case "withings":
      return record.measurementId || "Unknown";
    case "oura":
      return record.sleepId || record.nightOf || "Unknown";
    case "strava":
      return record.activityId || "Unknown";
    case "steam":
      return record.gameName || "Unknown";
    case "github":
      return record.repository || "Unknown";
    default:
      return "Unknown";
  }
}

module.exports = {
  SHORT_NAME_OVERRIDES,
  getGroupShortName,
  getCategoryShortName,
  formatRecordForLogging,
};
