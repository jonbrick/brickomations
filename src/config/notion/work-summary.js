/**
 * Work Summary Database Configuration
 * Properties are generated dynamically from unified-sources.js to ensure consistency
 */

const { generateWorkSummaryProperties } = require("../unified-sources");

// Generate properties dynamically from main.js
const properties = generateWorkSummaryProperties();

// Legacy read-only column: weekly summaries stopped writing Research 2026-08
// (🧪 Research merged into 💡 Exploration), but monthly recaps still read
// this column's pre-migration history.
properties.researchTaskDetails = {
  name: "Research Task Details",
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
  database: process.env.WORK_WEEK_SUMMARY__DATABASE_ID,
  properties,
  fieldMappings,
};
