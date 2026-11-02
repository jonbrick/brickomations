/**
 * Calendar Mappings Configuration
 * Declarative configuration for mapping Notion records to Google Calendar IDs
 */

const { getSourceDataKeys } = require("../unified-sources");
const {
  CALENDARS,
  SUMMARY_GROUPS,
  FETCH_KEY_MAPPING,
  CALENDAR_KEY_MAPPING,
} = require("../unified-sources");

const calendarMappings = {
  /**
   * Sleep calendar mapping
   * Routes based on "Google Calendar" property value
   */
  sleep: {
    type: "property-based",
    sourceDatabase: "sleep",
    routingProperty: "Google Calendar",
    mappings: {
      "Normal Wake Up": process.env.NORMAL_WAKE_UP_CALENDAR_ID,
      "Sleep In": process.env.SLEEP_IN_CALENDAR_ID,
      Naps: process.env.NAPS_CALENDAR_ID,
    },
  },

  /**
   * Workouts calendar mapping
   * All workouts go to fitness calendar (direct mapping)
   */
  workouts: {
    type: "direct",
    sourceDatabase: "workouts",
    calendarId: process.env.WORKOUT_CALENDAR_ID,
  },

  /**
   * Steam gaming calendar mapping
   * All gaming sessions go to video games calendar (direct mapping)
   */
  steam: {
    type: "direct",
    sourceDatabase: "steam",
    calendarId: process.env.VIDEO_GAMES_CALENDAR_ID,
  },

  /**
   * GitHub Personal PRs calendar mapping
   * All personal PRs go to personal PRs calendar (direct mapping)
   */
  githubPersonal: {
    type: "direct",
    sourceDatabase: "githubPersonal",
    calendarId: process.env.PERSONAL_PRS_CALENDAR_ID,
  },

  /**
   * GitHub Work PRs calendar mapping
   * All work PRs go to work PRs calendar (direct mapping)
   */
  githubWork: {
    type: "direct",
    sourceDatabase: "githubWork",
    calendarId: process.env.WORK_PRS_CALENDAR_ID,
  },

  /**
   * Withings body weight calendar mapping
   * All body weight measurements go to body weight calendar (direct mapping)
   */
  bodyWeight: {
    type: "direct",
    sourceDatabase: "bodyWeight",
    calendarId: process.env.BODY_WEIGHT_CALENDAR_ID,
  },

  /**
   * Blood pressure calendar mapping
   * All blood pressure measurements go to blood pressure calendar (direct mapping)
   */
  bloodPressure: {
    type: "direct",
    sourceDatabase: "bloodPressure",
    calendarId: process.env.BLOOD_PRESSURE_CALENDAR_ID,
  },

  /**
   * Medications calendar mapping
   * All medication records go to medications calendar (direct mapping)
   */
  medications: {
    type: "direct",
    sourceDatabase: "medications",
    calendarId: process.env.MEDICATIONS_CALENDAR_ID,
  },

  /**
   * Supplements calendar mapping
   * All supplement records go to supplements calendar (direct mapping)
   */
  supplements: {
    type: "direct",
    sourceDatabase: "supplements",
    calendarId: process.env.SUPPLEMENTS_CALENDAR_ID,
  },

  /**
   * Events calendar mapping
   * All events go to events calendar (direct mapping)
   */
  events: {
    type: "direct",
    sourceDatabase: "events",
    calendarId: process.env.EVENTS_CALENDAR_ID,
  },

  /**
   * Trips calendar mapping
   * All trips go to trips calendar (direct mapping)
   */
  trips: {
    type: "direct",
    sourceDatabase: "trips",
    calendarId: process.env.TRIPS_CALENDAR_ID,
  },

  /**
   * Future calendar mappings (placeholders for upcoming integrations)
   */

  // Sober days calendar
  sober: {
    type: "direct",
    sourceDatabase: "sober",
    calendarId: process.env.SOBER_CALENDAR_ID,
  },

  // Alcohol calendar
  alcohol: {
    type: "direct",
    sourceDatabase: "alcohol",
    calendarId: process.env.DRINKING_CALENDAR_ID,
  },

  // Meditation calendar
  meditation: {
    type: "direct",
    sourceDatabase: "meditation",
    calendarId: process.env.MEDITATION_CALENDAR_ID,
  },

  // Reading calendar
  reading: {
    type: "direct",
    sourceDatabase: "reading",
    calendarId: process.env.READING_CALENDAR_ID,
  },

  // Art calendar
  art: {
    type: "direct",
    sourceDatabase: "art",
    calendarId: process.env.ART_CALENDAR_ID,
  },

  // Coding calendar
  coding: {
    type: "direct",
    sourceDatabase: "coding",
    calendarId: process.env.CODING_CALENDAR_ID,
  },

  // Personal Calendar with category-based mapping
  personalCalendar: {
    type: "category-based",
    sourceDatabase: "personalCalendar",
    routingProperty: "Category",
    mappings: {
      Personal: process.env.PERSONAL_CATEGORY_CALENDAR_ID,
      Interpersonal: process.env.INTERPERSONAL_CALENDAR_ID,
      Home: process.env.HOME_CALENDAR_ID,
      "Physical Health": process.env.PHYSICAL_HEALTH_CALENDAR_ID,
      "Mental Health": process.env.MENTAL_HEALTH_CALENDAR_ID,
    },
  },

  // Personal Tasks with category-based mapping
  personalTasks: {
    type: "category-based",
    sourceDatabase: "personalTasks",
    routingProperty: "Category",
    mappings: {
      Personal: process.env.PERSONAL_TASKS_CATEGORY_CALENDAR_ID,
      Interpersonal: process.env.INTERPERSONAL_TASKS_CALENDAR_ID,
      Home: process.env.HOME_TASKS_CALENDAR_ID,
      "Physical Health": process.env.PHYSICAL_HEALTH_TASKS_CALENDAR_ID,
      "Mental Health": process.env.MENTAL_HEALTH_TASKS_CALENDAR_ID,
    },
  },
};

/**
 * Get data for a Personal Summary source
 * Derives data from DATA_SOURCES to avoid duplication
 * @param {string} sourceId - Source identifier (e.g., 'sleep', 'workout')
 * @returns {Array<string>} Array of data keys for this source
 */
function getSummarySourceData(sourceId) {
  return getSourceDataKeys(sourceId);
}

/**
 * Derive summary source configuration from a summary group
 * Builds the source object structure matching the existing hardcoded format
 * @param {string} groupId - The summary group ID
 * @param {Object} group - The summary group configuration from SUMMARY_GROUPS
 * @returns {Object} Source configuration object
 */
function deriveSummarySource(groupId, group) {
  // Handle Notion-based sources (tasks, workTasks)
  if (group.isNotionSource) {
    return {
      id: group.id,
      displayName: group.name,
      description: `Completed ${group.name.toLowerCase()} from Notion database`,
      required: false,
      sourceType: group.sourceType,
      isNotionSource: true,
      databaseId: process.env[group.databaseIdEnvVar],
    };
  }

  // Build calendar configs from group.calendars
  const calendarConfigs = group.calendars.map((calId) => {
    const calendar = CALENDARS[calId];
    if (!calendar) {
      throw new Error(`Calendar ${calId} not found in CALENDARS registry`);
    }
    const calendarKey = CALENDAR_KEY_MAPPING[calId] || calendar.id;
    return {
      id: calId,
      key: calendarKey,
      envVar: calendar.envVar,
      required: true,
      fetchKey: FETCH_KEY_MAPPING[calId] || calendar.id,
    };
  });

  // Build description from calendar names
  const calendarNames = group.calendars
    .map((calId) => CALENDARS[calId].name)
    .join(" and ");

  // Special description mappings for exact match with existing hardcoded values
  const descriptionMap = {
    sleep: "Sleep tracking from Normal Wake Up and Sleep In calendars",
    drinkingDays: "Alcohol tracking from Sober and Drinking calendars",
    workout: "Exercise tracking from Workout calendar",
    reading: "Reading time tracking",
    coding: "Personal coding time tracking",
    art: "Creative art time tracking",
    videoGames: "Gaming time tracking",
    meditation: "Meditation practice tracking",
    music: "Music practice/listening tracking",
    bodyWeight: "Body weight measurements",
    personalCalendar: "Main personal calendar events by category",
    personalPRs: "Personal GitHub pull requests",
    workCalendar: "Main work calendar events by category",
    workPRs: "Work GitHub pull requests",
  };

  // Build source object
  const source = {
    id: group.id,
    displayName: group.name,
    description:
      descriptionMap[groupId] ||
      (group.calendars.length > 1
        ? `${
            group.name.split(" (")[0]
          } tracking from ${calendarNames} calendars`
        : `${group.name} tracking from ${calendarNames} calendar`),
    required: false,
    sourceType: group.sourceType,
    calendars: calendarConfigs,
  };

  return source;
}

/**
 * Personal Summary Data Sources Configuration
 * Defines which calendars feed into Personal Summary database and their metadata
 * Derived from unified-sources.js SUMMARY_GROUPS configuration
 * Note: Data is derived from DATA_SOURCES via getSummarySourceData() - do not hardcode here
 */
const PERSONAL_SUMMARY_SOURCES = Object.fromEntries(
  Object.entries(SUMMARY_GROUPS)
    .filter(([_, g]) => g.sourceType === "personal")
    .map(([id, g]) => [id, deriveSummarySource(id, g)])
);

/**
 * Work Summary Data Sources Configuration
 * Defines which calendars feed into Work Summary database and their metadata
 * Derived from unified-sources.js SUMMARY_GROUPS configuration
 * Note: Data is derived from DATA_SOURCES via getSummarySourceData() - do not hardcode here
 */
const WORK_SUMMARY_SOURCES = Object.fromEntries(
  Object.entries(SUMMARY_GROUPS)
    .filter(([_, g]) => g.sourceType === "work")
    .map(([id, g]) => [id, deriveSummarySource(id, g)])
);

/**
 * Get all available Summary sources
 * Filters sources to only include those with configured environment variables
 * @param {string} sourceType - "personal" or "work" (default: "personal")
 * @returns {Array<Object>} Array of available sources with metadata
 */
function getAvailableSummarySources(sourceType = "personal") {
  // Validate sourceType
  if (sourceType !== "personal" && sourceType !== "work") {
    throw new Error(
      `sourceType must be "personal" or "work", got "${sourceType}"`
    );
  }

  // Select the appropriate sources constant
  const sourcesConfig =
    sourceType === "personal" ? PERSONAL_SUMMARY_SOURCES : WORK_SUMMARY_SOURCES;

  return Object.entries(sourcesConfig)
    .filter(([_, config]) => {
      // Tasks is a special case (Notion database, not calendar)
      if (config.isNotionSource) {
        return !!config.databaseId;
      }

      // Check if all required calendars have env vars set
      return config.calendars.every((cal) => {
        const envValue = process.env[cal.envVar];
        return cal.required ? !!envValue : true;
      });
    })
    .map(([id, config]) => ({
      id,
      displayName: config.displayName,
      description: config.description,
      isNotionSource: config.isNotionSource || false,
      sourceType: config.sourceType || sourceType,
    }));
}

/**
 * Get calendar configuration for a specific source
 * @param {string} sourceId - Source identifier (e.g., 'sleep', 'workout')
 * @param {Object} sourcesConfig - Sources configuration object (default: PERSONAL_SUMMARY_SOURCES)
 * @returns {Object|null} Source configuration or null if not found
 */
function getSummarySourceConfig(
  sourceId,
  sourcesConfig = PERSONAL_SUMMARY_SOURCES
) {
  return sourcesConfig[sourceId] || null;
}

/**
 * Get calendar IDs for a specific source
 * @param {string} sourceId - Source identifier
 * @param {Object} sourcesConfig - Sources configuration object (default: PERSONAL_SUMMARY_SOURCES)
 * @returns {Object|null} Object mapping calendar keys to IDs, or null if not found
 */
function getCalendarIdsForSource(
  sourceId,
  sourcesConfig = PERSONAL_SUMMARY_SOURCES
) {
  const source = sourcesConfig[sourceId];
  if (!source || source.isNotionSource) return null;

  return source.calendars.reduce((acc, cal) => {
    const calendarId = process.env[cal.envVar];
    if (calendarId) {
      acc[cal.key] = calendarId;
    }
    return acc;
  }, {});
}

/**
 * Build calendar fetch configuration for selected sources
 * @param {Array<string>} selectedSources - Array of source IDs to fetch
 * @param {string} accountType - "personal" or "work"
 * @param {Object} sourcesConfig - Sources configuration object (default: PERSONAL_SUMMARY_SOURCES)
 * @returns {Array<Object>} Array of fetch configurations
 */
function buildCalendarFetches(
  selectedSources,
  accountType = "personal",
  sourcesConfig = PERSONAL_SUMMARY_SOURCES
) {
  const fetches = [];

  for (const sourceId of selectedSources) {
    const source = sourcesConfig[sourceId];
    if (!source) {
      console.warn(`Unknown source: ${sourceId}`);
      continue;
    }

    // Skip Notion sources (handled separately)
    if (source.isNotionSource) {
      continue;
    }

    // Validate all required calendars are configured
    const missingCalendars = source.calendars
      .filter((cal) => cal.required && !process.env[cal.envVar])
      .map((cal) => cal.envVar);

    if (missingCalendars.length > 0) {
      throw new Error(
        `${source.displayName} requires: ${missingCalendars.join(", ")}`
      );
    }

    // Add fetch config for each calendar in this source
    for (const calendar of source.calendars) {
      const calendarId = process.env[calendar.envVar];
      if (!calendarId) continue;

      // Look up calendar definition to get filter properties from CALENDARS
      const calendarDef = CALENDARS[calendar.id];
      const ignoreAllDayEvents = calendarDef?.ignoreAllDayEvents ?? false;
      const excludeKeywords =
        calendarDef?.excludeKeywords ?? source.excludeKeywords ?? [];
      const excludePrefixes =
        calendarDef?.excludePrefixes ?? source.excludePrefixes ?? [];
      const ignoreDeclinedEvents =
        calendarDef?.ignoreDeclinedEvents ??
        source.ignoreDeclinedEvents ??
        false;

      fetches.push({
        key: calendar.fetchKey,
        calendarId,
        calendarKey: calendar.id,
        accountType,
        ignoreAllDayEvents,
        excludeKeywords,
        excludePrefixes,
        ignoreDeclinedEvents,
      });
    }
  }

  return fetches;
}

/**
 * Get display name for a fetchKey by looking it up in sources config
 * @param {string} fetchKey - The fetchKey from calendar events (e.g., "personalPRs", "earlyWakeup")
 * @param {Object} sourcesConfig - Sources configuration object (PERSONAL_SUMMARY_SOURCES or WORK_SUMMARY_SOURCES)
 * @returns {string} Display name from config, or fallback to DATA_SOURCES name, or fetchKey itself
 */
function getDisplayNameForFetchKey(fetchKey, sourcesConfig) {
  // Look through all sources to find which one has this fetchKey
  for (const [sourceId, source] of Object.entries(sourcesConfig)) {
    if (source.calendars) {
      const calendar = source.calendars.find(
        (cal) => cal.fetchKey === fetchKey
      );
      if (calendar) {
        return source.displayName;
      }
    }
  }

  // Fallback: try DATA_SOURCES directly if fetchKey matches sourceId
  const { DATA_SOURCES } = require("../unified-sources");
  if (DATA_SOURCES[fetchKey]?.name) {
    return DATA_SOURCES[fetchKey].name;
  }

  // Final fallback: return the fetchKey itself
  return fetchKey;
}

module.exports = {
  ...calendarMappings,
  PERSONAL_SUMMARY_SOURCES,
  WORK_SUMMARY_SOURCES,
  getAvailableSummarySources,
  getSummarySourceConfig,
  getCalendarIdsForSource,
  buildCalendarFetches,
  getSummarySourceData,
  getDisplayNameForFetchKey,
};
