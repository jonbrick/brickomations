// Orchestrates fetching calendar events and aggregating them into weekly data for Summary databases
// Supports both Personal and Work summary types via recapType parameter

const { fetchCalendarSummary } = require("../summarizers/summarize-calendar");
const config = require("../config");
// Import entire date module instead of destructuring to avoid module loading timing issues
const { parseWeekNumber } = require("../utils/date");
const { delay } = require("../utils/async");
// Import entire mappings module to avoid destructuring timing issues
const mappings = require("../config/calendar/mappings");
const { SUMMARY_GROUPS, CALENDARS } = require("../config/unified-sources");
const {
  getGroupShortName,
  getCategoryShortName,
} = require("../utils/display-names");
const { buildSuccessData } = require("../utils/workflow-output");

/**
 * Aggregate calendar data for a week and update Summary database
 *
 * @param {string} recapType - "personal" or "work"
 * @param {number} weekNumber - Week number (1-52/53)
 * @param {number} year - Year
 * @param {Object} options - Options
 * @param {string} options.accountType - "personal" or "work" (default: based on recapType)
 * @param {boolean} options.displayOnly - If true, only display results without updating Notion
 * @param {Array<string>} options.calendars - Array of calendar keys to include (default: all available)
 * @returns {Promise<Object>} Results object
 */
async function aggregateCalendarDataForWeek(
  recapType,
  weekNumber,
  year,
  options = {}
) {
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

  const sourcesConfig =
    recapType === "personal"
      ? mappings.PERSONAL_SUMMARY_SOURCES
      : mappings.WORK_SUMMARY_SOURCES;

  const defaultAccountType = recapType === "personal" ? "personal" : "work";
  const databaseName =
    recapType === "personal" ? "Personal Summary" : "Work Summary";

  const accountType = options.accountType || defaultAccountType;
  const displayOnly = options.displayOnly || false;
  const selectedCalendars = options.calendars || [];
  const errors = []; // Collect non-fatal warnings/errors
  let relationshipsLoaded = 0;
  const results = {
    weekNumber,
    year,
    summary: null,
    updated: false,
    error: null,
  };

  // Debug logging
  if (displayOnly || process.env.DEBUG) {
    console.log(`\n[DEBUG workflow] recapType: ${recapType}, weekNumber: ${weekNumber}, year: ${year}`);
    console.log(`[DEBUG workflow] selectedCalendars:`, selectedCalendars);
    console.log(`[DEBUG workflow] displayOnly: ${displayOnly}`);
  }

  try {
    // Calculate week date range
    const { startDate, endDate } = parseWeekNumber(weekNumber, year);

    // Get available sources
    const availableSources = mappings.getAvailableSummarySources(recapType);

    // Determine which calendars to fetch
    // If no calendars specified, default to all available (backward compatible)
    const calendarsToFetch =
      selectedCalendars.length > 0
        ? selectedCalendars
        : availableSources
            .filter((source) => !source.isNotionSource) // Exclude Notion sources for calendar fetch
            .map((source) => source.id);

    // Debug logging
    if (displayOnly || process.env.DEBUG) {
      console.log(`[DEBUG workflow] availableSources count: ${availableSources.length}`);
      console.log(`[DEBUG workflow] availableSources IDs:`, availableSources.map(s => s.id));
      console.log(`[DEBUG workflow] calendarsToFetch:`, calendarsToFetch);
    }

    // Build calendar fetch configurations
    const fetchConfigs = mappings.buildCalendarFetches(
      calendarsToFetch,
      accountType,
      sourcesConfig
    );

    // Debug logging
    if (displayOnly || process.env.DEBUG) {
      console.log(`[DEBUG workflow] fetchConfigs.length:`, fetchConfigs.length);
      if (fetchConfigs.length > 0) {
        console.log(`[DEBUG workflow] fetchConfigs keys:`, fetchConfigs.map(f => f.key));
      }
    }

    if (fetchConfigs.length === 0) {
      throw new Error("No calendars selected or available to fetch.");
    }

    // Execute all calendar fetches in parallel
    const calendarFetches = fetchConfigs.map((fetchConfig) => ({
      key: fetchConfig.key,
      promise: fetchCalendarSummary(
        fetchConfig.calendarId,
        startDate,
        endDate,
        {
          accountType: fetchConfig.accountType,
          ignoreAllDayEvents: fetchConfig.ignoreAllDayEvents,
          excludeKeywords: fetchConfig.excludeKeywords,
          excludePrefixes: fetchConfig.excludePrefixes,
          ignoreDeclinedEvents: fetchConfig.ignoreDeclinedEvents,
          calendarKey: fetchConfig.calendarKey,
        }
      ),
    }));

    const fetchResults = await Promise.all(
      calendarFetches.map((f) =>
        f.promise.catch((err) => ({ error: err.message }))
      )
    );

    // Map results to calendar keys
    const calendarEvents = {};
    fetchResults.forEach((result, index) => {
      const key = calendarFetches[index].key;
      if (result.error) {
        errors.push(`Error fetching ${key}: ${result.error}`);
        calendarEvents[key] = [];
      } else {
        calendarEvents[key] = result;
      }
    });

    // Warn if all calendar fetches failed
    const allFailed =
      fetchResults.length > 0 && fetchResults.every((r) => r.error);
    if (allFailed) {
      errors.push(
        "Warning: All calendar fetches failed. Please check your calendar IDs and permissions."
      );
    }

    // Rate limiting between API calls
    await delay(config.sources.rateLimits.googleCalendar.backoffMs);

    // Fetch relationships context for interpersonal matching (personal recap only)
    let relationshipsContext = null;
    if (recapType === "personal") {
      try {
        const NotionDatabase = require("../databases/NotionDatabase");
        const relationshipsDbId = config.notion.databases.relationships;

        if (relationshipsDbId) {
          const relationshipsDb = new NotionDatabase();
          const relationshipsProps = config.notion.properties.relationships;

          // Find current week's Personal Summary page to get its ID
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
              const nameProperty = page.properties[relationshipsProps.name.name];
              const name = nameProperty?.title?.[0]?.plain_text || "";

              const nicknamesProperty = page.properties[relationshipsProps.nicknames.name];
              const nicknames =
                nicknamesProperty?.rich_text?.[0]?.plain_text || "";

              // Extract relation property (array of page objects with id)
              const activeWeeksProperty = page.properties[relationshipsProps.activeWeeks.name];
              const activeWeekPageIds =
                activeWeeksProperty?.relation?.map((rel) => rel.id) || [];

              // Fetch each related week page to get its week number from title
              const activeWeekNumbers = [];
              for (const weekPageId of activeWeekPageIds) {
                try {
                  const weekPage =
                    await relationshipsDb.client.pages.retrieve({
                      page_id: weekPageId,
                    });
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

    // Calculate summary (only for selected calendars)
    // Note: tasks are handled by notion-tasks-to-notion-summaries workflow
    const summary = transformFunction(
      calendarEvents,
      startDate,
      endDate,
      calendarsToFetch,
      [], // No tasks in calendar workflow
      relationshipsContext
    );
    results.summary = summary;

    // Debug logging
    if (displayOnly || process.env.DEBUG) {
      console.log(`[DEBUG workflow] calendarEvents keys:`, Object.keys(calendarEvents));
      const eventCounts = Object.entries(calendarEvents).reduce((acc, [key, events]) => {
        acc[key] = Array.isArray(events) ? events.length : 'N/A';
        return acc;
      }, {});
      console.log(`[DEBUG workflow] calendarEvents counts:`, eventCounts);
      console.log(`[DEBUG workflow] summary keys:`, Object.keys(summary));
      console.log(`[DEBUG workflow] summary count: ${Object.keys(summary).length}`);
      if (Object.keys(summary).length > 0) {
        const sampleSummary = {};
        Object.keys(summary).slice(0, 10).forEach(key => {
          sampleSummary[key] = summary[key];
        });
        console.log(`[DEBUG workflow] summary sample:`, JSON.stringify(sampleSummary, null, 2).substring(0, 800));
      } else {
        console.log(`[DEBUG workflow] ⚠️  Summary is EMPTY!`);
      }
    }

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
        calendarEvents,
        summary,
        relationshipsLoaded,
      };
      results.counts = counts;
      results.errors = errors;
      results.selectedCalendars = calendarsToFetch;
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
    await summaryRepo.updateWeekSummary(weekSummary.id, summary, calendarsToFetch);

    // Also write to Personal Habits DB if this is a personal summary
    if (recapType === "personal") {
      const habitsRepo = new SummaryDatabase("personalHabits");
      const habitsWeekSummary = await habitsRepo.findWeekSummary(
        weekNumber,
        year,
        startDate,
        endDate
      );

      if (habitsWeekSummary) {
        await habitsRepo.updateWeekSummary(
          habitsWeekSummary.id,
          summary,
          calendarsToFetch
        );
        await delay(config.sources.rateLimits.notion.backoffMs);
      } else {
        errors.push("Week summary record not found in Personal Habits database");
      }
    }

    // Rate limiting
    await delay(config.sources.rateLimits.notion.backoffMs);

    results.updated = true;
    results.selectedCalendars = calendarsToFetch;

    // Build counts from summary data
    const counts = {};
    Object.keys(summary).forEach((key) => {
      const value = summary[key];
      if (typeof value === "number" && value > 0) {
        counts[key] = value;
      }
    });

    results.data = {
      calendarEvents,
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
  aggregateCalendarDataForWeek,
};
