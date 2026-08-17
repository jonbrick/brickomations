/**
 * Personal Summary Database Configuration
 * Properties are generated dynamically from unified-sources.js to ensure consistency
 */

const { generatePersonalSummaryProperties } = require("../unified-sources");

// Generate properties dynamically from main.js
const properties = generatePersonalSummaryProperties();

// Legacy read-only column: weekly summaries stopped writing personal coding
// 2026-08 (personal coding is now 🎸 Hobbies), but monthly recaps still fold
// this column's pre-migration history into Hobbies.
properties.codingTaskDetails = {
  name: "Coding Task Details",
  type: "text",
  enabled: true,
};

// Generate fieldMappings automatically (identity mappings)
const fieldMappings = {};
Object.keys(properties).forEach((key) => {
  if (key !== "title") {
    // Skip title as it's special
    fieldMappings[key] = key;
  }
});

module.exports = {
  database: process.env.PERSONAL_WEEK_SUMMARY_DATABASE_ID,
  properties,
  fieldMappings,
};
