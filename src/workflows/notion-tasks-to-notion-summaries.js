// Syncs completed tasks from Notion Tasks database to Summary databases
// Supports both Personal and Work summary types via recapType parameter

const { fetchCompletedTasks } = require("../summarizers/summarize-tasks");
const config = require("../config");
const { parseWeekNumber } = require("../utils/date");
const { delay } = require("../utils/async");
const {
  SUMMARY_GROUPS,
  CALENDARS,
  getTaskCompletionFields,
} = require("../config/unified-sources");
const { getCategoryShortName } = require("../utils/display-names");

/**
 * Summarize a week's Notion database data and update Summary database
 *
 * @param {string} recapType - "personal" or "work"
 * @param {number} weekNumber - Week number (1-52/53)
 * @param {number} year - Year
 * @param {Object} options - Options
 * @param {boolean} options.displayOnly - If true, only display results without updating Notion
 * @param {Array<string>} options.sources - Array of source keys to include (e.g., ["tasks"] or ["workTasks"])
 * @returns {Promise<Object>} Results object
 */
async function summarizeWeek(recapType, weekNumber, year, options = {}) {
  // Validate recapType
  if (recapType !== "personal" && recapType !== "work") {
    throw new Error(
      `recapType must be "personal" or "work", got "${recapType}"`
    );
  }

  // Use unified SummaryDatabase with recapType parameter
  const SummaryDatabase = require("../databases/SummaryDatabase");

  const transformFunction =
    recapType === "personal"
      ? require("../transformers/transform-calendar-to-notion-personal-summary")
          .transformCalendarEventsToRecapData
      : require("../transformers/transform-calendar-to-notion-work-summary")
          .transformCalendarEventsToRecapData;

  const taskSourceKey = recapType === "personal" ? "tasks" : "workTasks";
  const databaseName =
    recapType === "personal" ? "Personal Summary" : "Work Summary";

  // Get task completion fields from config
  const successMessageFields = getTaskCompletionFields(recapType);

  const displayOnly = options.displayOnly || false;
  const selectedSources = options.sources || [];
  const errors = []; // Collect non-fatal warnings/errors
  let relationshipsLoaded = 0;
  const results = {
    weekNumber,
    year,
    summary: null,
    updated: false,
    error: null,
  };

  try {
    // Calculate week date range
    const { startDate, endDate } = parseWeekNumber(weekNumber, year);

    // Determine which sources to fetch
    const sourcesToFetch = selectedSources.length > 0 ? selectedSources : [];

    if (sourcesToFetch.length === 0) {
      throw new Error("No Notion sources selected or available to fetch.");
    }

    // Fetch tasks if task source key is selected
    let tasks = [];
    if (sourcesToFetch.includes(taskSourceKey)) {
      if (!process.env.TASKS_DATABASE_ID) {
        throw new Error("TASKS_DATABASE_ID is not configured.");
      }
      tasks = await fetchCompletedTasks(startDate, endDate);
      await delay(config.sources.rateLimits.notion.backoffMs);
    }

    // Fetch relationships context for personal recap (needed for task categorization)
    let relationshipsContext = null;
    if (recapType === "personal") {
      try {
        const NotionDatabase = require("../databases/NotionDatabase");
        const relationshipsDbId = config.notion.databases.relationships;

        if (relationshipsDbId) {
          const relationshipsDb = new NotionDatabase();
          const relationshipsProps = config.notion.properties.relationships;

          // Find current week's Personal Summary page
          const summaryRepo = new SummaryDatabase(recapType);
          const weekSummary = await summaryRepo.findWeekSummary(
            weekNumber,
            year,
            startDate,
            endDate
          );

          // Fetch all relationships
          const relationshipsPages = await relationshipsDb.queryDatabaseAll(
            relationshipsDbId
          );

          // Extract relationship data with active week numbers
          const relationships = await Promise.all(
            relationshipsPages.map(async (page) => {
              const nameProperty =
                page.properties[relationshipsProps.name.name];
              const name = nameProperty?.title?.[0]?.plain_text || "";

              const nicknamesProperty =
                page.properties[relationshipsProps.nicknames.name];
              const nicknames =
                nicknamesProperty?.rich_text?.[0]?.plain_text || "";

              // Extract relation property (array of page objects with id)
              const activeWeeksProperty =
                page.properties[relationshipsProps.activeWeeks.name];
              const activeWeekPageIds =
                activeWeeksProperty?.relation?.map((rel) => rel.id) || [];

              // Fetch each related week page to get its week number from title
              const activeWeekNumbers = [];
              for (const weekPageId of activeWeekPageIds) {
                try {
                  const weekPage = await relationshipsDb.getPage(weekPageId);
                  // Extract week number from title like "Week 05" -> 5
                  const weeksProps = config.notion.properties.weeks;
                  const titlePropName = config.notion.getPropertyName(weeksProps.week);
                  const titleProp = weekPage.properties[titlePropName];
                  const title = titleProp?.title?.[0]?.plain_text || "";
                  const match = title.match(/Week (\d+)/i);
                  if (match) {
                    activeWeekNumbers.push(parseInt(match[1], 10));
                  }
                } catch (error) {
                  // Skip if we can't fetch the page
                  errors.push(`Could not fetch week page ${weekPageId}`);
                }
              }

              return {
                name,
                nicknames,
                activeWeekNumbers,
              };
            })
          );

          relationshipsContext = {
            currentWeekNumber: weekNumber,
            currentYear: year,
            relationships,
          };

          if (relationships.length > 0) {
            relationshipsLoaded = relationships.length;
          }
        }
      } catch (error) {
        errors.push(`Could not fetch relationships: ${error.message}`);
        // Continue without relationships context
      }
    }

    // Calculate summary (empty calendar events, just tasks)
    const calendarEvents = {}; // Empty since this is Notion-only workflow
    const summary = transformFunction(
      calendarEvents,
      startDate,
      endDate,
      sourcesToFetch,
      tasks,
      relationshipsContext
    );
    results.summary = summary;

    // If display only, return early without updating Notion
    if (displayOnly) {
      const counts = {};
      Object.keys(summary).forEach((key) => {
        const value = summary[key];
        if (typeof value === "number" && value > 0) {
          counts[key] = value;
        }
      });
      results.data = {
        tasks,
        summary,
        relationshipsLoaded,
      };
      results.counts = counts;
      results.errors = errors;
      results.selectedSources = sourcesToFetch;
      return results;
    }

    // Find or get week summary record
    const summaryRepo = new SummaryDatabase(recapType);
    const weekSummary = await summaryRepo.findWeekSummary(
      weekNumber,
      year,
      startDate,
      endDate
    );

    if (!weekSummary) {
      results.error = "Week summary record not found";
      return results;
    }

    // Update week summary
    await summaryRepo.updateWeekSummary(
      weekSummary.id,
      summary,
      sourcesToFetch
    );

    // Rate limiting
    await delay(config.sources.rateLimits.notion.backoffMs);

    results.updated = true;
    results.selectedSources = sourcesToFetch;

    // Build counts from summary data
    const counts = {};
    Object.keys(summary).forEach((key) => {
      const value = summary[key];
      if (typeof value === "number" && value > 0) {
        counts[key] = value;
      }
    });

    results.data = {
      tasks,
      summary,
      relationshipsLoaded,
    };
    results.counts = counts;
    results.errors = errors;

    return results;
  } catch (error) {
    results.error = error.message;
    throw error;
  }
}

module.exports = {
  summarizeWeek,
};
