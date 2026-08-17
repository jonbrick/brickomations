// Converts raw Google Calendar events into aggregated weekly data for Personal Summary database

const { PERSONAL_SUMMARY_SOURCES } = require("../config/calendar/mappings");
const {
  CALENDARS,
  SUMMARY_GROUPS,
  FETCH_KEY_MAPPING,
} = require("../config/unified-sources");
const { PARSERS } = require("../parsers/calendar-parsers");
const {
  getDayAbbreviation,
  isDateInWeek,
  calculateCalendarData,
  formatBlocksWithTimeRanges,
  formatTasksByDay,
  stripKnownCalendarSummaryEmoji,
  filterEventsByContentFilters,
  filterTasksByContentFilters,
} = require("../utils/calendar-data-helpers");
const {
  matchInterpersonalCategory,
} = require("../parsers/interpersonal-matcher");

/**
 * Transform calendar events to weekly summary data
 * Filters events to only include those within the week date range
 *
 * @param {Object} calendarEvents - Object with calendar event arrays
 *   Example: {
 *     earlyWakeup: [...],
 *     sleepIn: [...],
 *     sober: [...],
 *     drinking: [...],
 *     workout: [...],
 *     reading: [...],
 *     coding: [...],
 *     art: [...],
 *     videoGames: [...],
 *     meditation: [...]
 *   }
 * @param {Date} weekStartDate - Start date of the week (Sunday)
 * @param {Date} weekEndDate - End date of the week (Saturday)
 * @param {Array<string>} selectedCalendars - Array of calendar keys to include (e.g., ["sleep", "sober", "drinking"])
 *   If not provided, calculates data for all calendars (backward compatible)
 * @param {Array<Object>} tasks - Array of completed tasks (default: [])
 * @returns {Object} Summary object with calendar data for selected calendars only
 */
function transformCalendarEventsToRecapData(
  calendarEvents,
  weekStartDate = null,
  weekEndDate = null,
  selectedCalendars = null,
  tasks = [],
  relationshipsContext = null
) {
  /**
   * Process standard activity calendar (Days, Sessions, HoursTotal, Blocks)
   * Used by: workout, reading, meditation, coding, art, music, videoGames, cooking
   */
  function processStandardActivity(
    calendarId,
    calendarEvents,
    summary,
    weekStartDate,
    weekEndDate
  ) {
    const fetchKey = FETCH_KEY_MAPPING[calendarId] || calendarId;
    const events = calendarEvents[fetchKey] || [];

    // Filter events by date range first
    const dateFilteredEvents = events.filter((event) =>
      isDateInWeek(event.date, weekStartDate, weekEndDate)
    );

    // Filter events by content filters BEFORE counting
    const filteredEvents = filterEventsByContentFilters(
      dateFilteredEvents,
      `${calendarId}Blocks`,
      "personal"
    );

    // Calculate counts using filtered events
    const data = calculateCalendarData(
      filteredEvents,
      weekStartDate,
      weekEndDate,
      true,
      true
    );

    summary[`${calendarId}Days`] = data.days || 0;
    summary[`${calendarId}Sessions`] =
      data.sessions !== undefined ? data.sessions : 0;
    summary[`${calendarId}HoursTotal`] =
      data.hoursTotal !== undefined ? data.hoursTotal : 0;

    // Calculate blocks (already filtered)
    summary[`${calendarId}Blocks`] = formatBlocksWithTimeRanges(filteredEvents);
  }

  /**
   * Process days-only calendar
   * Used by: sober
   */
  function processDaysOnly(
    calendarId,
    calendarEvents,
    summary,
    weekStartDate,
    weekEndDate
  ) {
    const fetchKey = FETCH_KEY_MAPPING[calendarId] || calendarId;
    const events = calendarEvents[fetchKey] || [];

    // Filter events by date range first
    const dateFilteredEvents = events.filter((event) =>
      isDateInWeek(event.date, weekStartDate, weekEndDate)
    );

    // Filter events by content filters BEFORE counting
    // Note: sober doesn't have blocks, so we use a generic column name
    const filteredEvents = filterEventsByContentFilters(
      dateFilteredEvents,
      `${calendarId}Blocks`,
      "personal"
    );

    // Calculate Days count from filtered events only
    const data = calculateCalendarData(
      filteredEvents,
      weekStartDate,
      weekEndDate,
      false,
      false
    );
    summary[`${calendarId}Days`] = data.days || 0;
  }

  /**
   * Process days with blocks (conditional hours display)
   * Used by: drinking
   */
  function processDaysWithBlocks(
    calendarId,
    calendarEvents,
    summary,
    weekStartDate,
    weekEndDate
  ) {
    const fetchKey = FETCH_KEY_MAPPING[calendarId] || calendarId;
    const events = calendarEvents[fetchKey] || [];

    // Filter events by date range first
    const dateFilteredEvents = events.filter((event) =>
      isDateInWeek(event.date, weekStartDate, weekEndDate)
    );

    // Filter events by content filters BEFORE counting
    const filteredEvents = filterEventsByContentFilters(
      dateFilteredEvents,
      `${calendarId}Blocks`,
      "personal"
    );

    // Calculate Days count from filtered events
    const data = calculateCalendarData(
      filteredEvents,
      weekStartDate,
      weekEndDate,
      false,
      false
    );
    summary[`${calendarId}Days`] = data.days || 0;

    // Calculate blocks (already filtered)
    summary[`${calendarId}Blocks`] = formatBlocksWithTimeRanges(filteredEvents);
  }

  /**
   * Process multi-calendar aggregate
   * Used by: sleep (combines earlyWakeup + sleepIn)
   */
  function processMultiCalendar(
    groupId,
    group,
    calendarEvents,
    summary,
    weekStartDate,
    weekEndDate
  ) {
    if (groupId === "sleep") {
      // Filter earlyWakeup events by date range first
      const earlyWakeupDateFiltered = (calendarEvents.earlyWakeup || []).filter(
        (event) => isDateInWeek(event.date, weekStartDate, weekEndDate)
      );
      // Filter by content filters (note: sleep doesn't have blocks, so we use a generic column name)
      const earlyWakeupFiltered = filterEventsByContentFilters(
        earlyWakeupDateFiltered,
        "sleepHoursTotal",
        "personal"
      );

      // Filter sleepIn events by date range first
      const sleepInDateFiltered = (calendarEvents.sleepIn || []).filter(
        (event) => isDateInWeek(event.date, weekStartDate, weekEndDate)
      );
      // Filter by content filters
      const sleepInFiltered = filterEventsByContentFilters(
        sleepInDateFiltered,
        "sleepHoursTotal",
        "personal"
      );

      // Calculate from filtered events
      const earlyWakeup = calculateCalendarData(
        earlyWakeupFiltered,
        weekStartDate,
        weekEndDate,
        true,
        false
      );
      const sleepIn = calculateCalendarData(
        sleepInFiltered,
        weekStartDate,
        weekEndDate,
        true,
        false
      );
      const sleepHoursTotal =
        (earlyWakeup.hoursTotal || 0) + (sleepIn.hoursTotal || 0);

      summary.earlyWakeupDays = earlyWakeup.days || 0;
      summary.sleepInDays = sleepIn.days || 0;
      summary.sleepHoursTotal = Math.round(sleepHoursTotal * 100) / 100;
    }
    // Add other multi-calendar patterns here if needed
  }

  /**
   * Truncate text to Notion's 2000 character limit
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length (default: 2000)
   * @returns {string} Truncated text
   */
  function truncateForNotion(text, maxLength = 2000) {
    if (!text || text.length <= maxLength) {
      return text;
    }
    // Truncate and add ellipsis with info about truncation
    return text.substring(0, maxLength - 20) + "... (truncated)";
  }

  /**
   * Process sessions with details (no hours)
   * Used by: personalPRs
   */
  function processSessionsDetails(
    calendarId,
    calendarEvents,
    summary,
    weekStartDate,
    weekEndDate
  ) {
    const fetchKey = FETCH_KEY_MAPPING[calendarId] || calendarId;
    const events = calendarEvents[fetchKey] || [];

    // Filter events by date range first
    const dateFilteredEvents = events.filter((event) =>
      isDateInWeek(event.date, weekStartDate, weekEndDate)
    );

    // Filter events by content filters BEFORE counting
    const filteredEvents = filterEventsByContentFilters(
      dateFilteredEvents,
      `${calendarId}Details`,
      "personal"
    );

    summary[`${calendarId}Sessions`] = filteredEvents.length || 0;

    const detailsText =
      filteredEvents
        .map((event) => {
          const eventName = stripKnownCalendarSummaryEmoji(event.summary) || "Untitled Event";
          const day = getDayAbbreviation(event.date);
          return `${eventName} (${day})`;
        })
        .join(", ") || "";

    // Truncate to Notion's 2000 character limit
    summary[`${calendarId}Details`] = truncateForNotion(detailsText);
  }

  // Helper to determine if a source should be calculated based on selection
  // Accepts source IDs (e.g., "sleep", "sober", "drinking", "workout")
  const shouldCalculate = (sourceId) => {
    // If no calendars selected, calculate all (backward compatible)
    if (!selectedCalendars || selectedCalendars.length === 0) {
      return true;
    }

    // Direct match: source ID is in selected calendars
    if (selectedCalendars.includes(sourceId)) {
      return true;
    }

    // Special case: "drinkingDays" source includes both "sober" and "drinking"
    if (sourceId === "sober" || sourceId === "drinking") {
      return selectedCalendars.includes("drinkingDays");
    }

    // Check if this source ID is part of any selected source's calendars
    // (for cases where a source might be referenced by its calendar fetchKey)
    return selectedCalendars.some((selectedSourceId) => {
      const source = PERSONAL_SUMMARY_SOURCES[selectedSourceId];
      if (!source) return false;

      // Check if any of the source's calendars match this source ID
      return source.calendars?.some((cal) => cal.fetchKey === sourceId);
    });
  };

  const summary = {};

  // ========================================
  // Config-driven calendar processing
  // ========================================
  // Process calendars using patterns defined in SUMMARY_GROUPS
  Object.entries(SUMMARY_GROUPS)
    .filter(([id, group]) => {
      // Filter to personal, non-Notion, non-category-based sources
      return (
        group.sourceType === "personal" &&
        !group.isNotionSource &&
        group.processingPattern !== "categoryBased" &&
        shouldCalculate(id)
      );
    })
    .forEach(([groupId, group]) => {
      const pattern = group.processingPattern;

      switch (pattern) {
        case "standardActivity":
          // Process single calendar with Days, Sessions, Hours, Blocks
          if (group.calendars && group.calendars.length > 0) {
            processStandardActivity(
              group.calendars[0],
              calendarEvents,
              summary,
              weekStartDate,
              weekEndDate
            );
          }
          break;

        case "daysWithBlocks":
          // Handle drinkingDays group which includes sober and drinking
          if (groupId === "drinkingDays") {
            // Process sober (days only) if selected
            if (shouldCalculate("sober") || shouldCalculate("drinkingDays")) {
              processDaysOnly(
                "sober",
                calendarEvents,
                summary,
                weekStartDate,
                weekEndDate
              );
            }
            // Process drinking (days with blocks) if selected
            if (
              shouldCalculate("drinking") ||
              shouldCalculate("drinkingDays")
            ) {
              processDaysWithBlocks(
                "drinking",
                calendarEvents,
                summary,
                weekStartDate,
                weekEndDate
              );
            }
          }
          break;

        case "multiCalendar":
          // Process aggregated calendars (sleep)
          processMultiCalendar(
            groupId,
            group,
            calendarEvents,
            summary,
            weekStartDate,
            weekEndDate
          );
          break;

        case "sessionsDetails":
          // Process PRs-style calendars
          if (group.calendars && group.calendars.length > 0) {
            processSessionsDetails(
              group.calendars[0],
              calendarEvents,
              summary,
              weekStartDate,
              weekEndDate
            );
          }
          break;

        case "customParser":
          // Use custom parser from registry
          if (group.parser && PARSERS[group.parser]) {
            // Create bound version of isDateInWeek for parsers
            const isDateInWeekFn = (dateStr) =>
              isDateInWeek(dateStr, weekStartDate, weekEndDate);
            const parserResult = PARSERS[group.parser](
              calendarEvents,
              isDateInWeekFn,
              group
            );
            Object.assign(summary, parserResult);
          }
          break;

        default:
          if (process.env.DEBUG) {
            console.warn(
              `Unknown processing pattern: ${pattern} for ${groupId}`
            );
          }
      }
    });

  // ========================================
  // Category-based processing (kept as-is)
  // ========================================

  // Personal Calendar blocks (only if "personalCalendar" is selected)
  if (shouldCalculate("personalCalendar")) {
    const {
      getEnhancedPersonalCategory,
    } = require("../config/calendar/color-mappings");

    // Extract relationship context
    const currentWeekNumber = relationshipsContext?.currentWeekNumber || null;
    const relationships = relationshipsContext?.relationships || [];

    // Get all events from the single Personal Calendar
    const personalCalendarEvents = calendarEvents.personalCalendar || [];

    // Filter events within week date range
    const filteredEvents = personalCalendarEvents.filter((event) =>
      isDateInWeek(event.date, weekStartDate, weekEndDate)
    );

    // Group events by category for per-category data
    const eventsByCategory = {};
    filteredEvents.forEach((event) => {
      const category = getEnhancedPersonalCategory(
        event,
        currentWeekNumber,
        relationships
      );
      if (!eventsByCategory[category]) {
        eventsByCategory[category] = [];
      }
      eventsByCategory[category].push(event);
    });

    // Calculate data for each category
    const categories = Object.keys(CALENDARS.personalCalendar.categories);

    categories.forEach((category) => {
      const categoryEvents = eventsByCategory[category] || [];

      // For "ignore" category, only calculate blocks
      if (category === "ignore") {
        // Calculate blocks
        summary[`${category}Blocks`] =
          formatBlocksWithTimeRanges(categoryEvents);
      } else {
        // Always include all fields for selected calendar (clean slate)
        // Calculate sessions (count of events)
        summary[`${category}Sessions`] = categoryEvents.length || 0;

        // Calculate hours total (sum of durationHours, rounded to 2 decimals)
        const hoursTotal = categoryEvents.reduce(
          (sum, event) => sum + (event.durationHours || 0),
          0
        );
        summary[`${category}HoursTotal`] = Math.round(hoursTotal * 100) / 100;

        // Calculate blocks
        summary[`${category}Blocks`] =
          formatBlocksWithTimeRanges(categoryEvents);
      }
    });
  }

  // Task data (only if "tasks" is selected)
  if (shouldCalculate("tasks") && tasks.length > 0) {
    const {
      getCategoryKey,
      getPersonalCategoryKey,
    } = require("../config/notion/task-categories");

    // Extract relationship context for interpersonal category splitting
    const currentWeekNumber = relationshipsContext?.currentWeekNumber || null;
    const relationships = relationshipsContext?.relationships || [];

    // Group tasks by category (with interpersonal splitting)
    const tasksByCategory = {};
    tasks.forEach((task) => {
      let categoryKey = getCategoryKey(task.category);

      // Personal sub-category (Hobbies, Home, Admin, …) overrides the
      // top-level Personal bucket. Category itself is now the binary
      // (💼 Work / 🌱 Personal) — subcategories live in PERSONAL Category.
      if (categoryKey === "personal") {
        const personalSubKey = getPersonalCategoryKey(task.personalCategory);
        if (personalSubKey) {
          categoryKey = personalSubKey;
        }
      }

      // Split interpersonal tasks into family/relationship/interpersonal
      // (must run after sub-category resolution)
      if (categoryKey === "interpersonal") {
        const pseudoEvent = { summary: task.title };
        categoryKey = matchInterpersonalCategory(
          pseudoEvent,
          currentWeekNumber,
          relationships
        );
      }

      if (categoryKey && categoryKey !== "work") {
        // Skip work tasks (not in CSV)
        if (!tasksByCategory[categoryKey]) {
          tasksByCategory[categoryKey] = [];
        }
        tasksByCategory[categoryKey].push(task);
      }
    });

    // Calculate data for each category
    const taskCategories = Object.keys(CALENDARS.tasks.categories);

    taskCategories.forEach((category) => {
      let categoryTasks = tasksByCategory[category] || [];

      // Filter tasks by content filters BEFORE counting
      categoryTasks = filterTasksByContentFilters(
        categoryTasks,
        `${category}TaskDetails`,
        "personal"
      );

      // Count completed tasks (only non-filtered)
      summary[`${category}TasksComplete`] = categoryTasks.length || 0;

      // Build task details string (format: day-grouped with newlines)
      summary[`${category}TaskDetails`] = formatTasksByDay(categoryTasks);
    });
  }

  return summary;
}

module.exports = {
  transformCalendarEventsToRecapData,
};
