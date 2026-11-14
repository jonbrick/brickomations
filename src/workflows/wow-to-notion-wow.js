// Syncs World of Warcraft sessions to the shared video games Notion DB
// (the Steam DB) with de-duplication on Activity ID.

const { syncIntegrationToNotion } = require("./helpers/sync-integration-to-notion");

/**
 * Sync multiple WoW activities to Notion
 *
 * @param {Array} activities - Array of processed WoW activities
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} Sync results
 */
async function syncWowToNotion(activities, options = {}) {
  return syncIntegrationToNotion(
    "wow",
    activities,
    (item) => item.activityId,
    (item) => item.gameName,
    options
  );
}

module.exports = {
  syncWowToNotion,
};
