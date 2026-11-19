/**
 * Work Summary Database Configuration
 * Properties are generated dynamically from unified-sources.js to ensure consistency
 */

const { generateWorkSummaryProperties } = require("../unified-sources");

// Generate properties dynamically from main.js
const properties = generateWorkSummaryProperties();

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
