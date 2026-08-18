/**
 * Unified Sources Configuration
 * Three-registry architecture for calendars, summary groups, and integrations
 */

/**
 * FIELD_TEMPLATES - Reusable field pattern factories
 * Eliminates ~200 lines of repetitive dataField definitions
 *
 * Each template returns an array of field definition objects with:
 * - type: "count" | "decimal" | "optionalText"
 * - label: Human-readable label for Notion
 * - notionProperty: Camel-case property name
 */
const FIELD_TEMPLATES = {
  /**
   * Standard activity pattern: Days, Sessions, Hours, Blocks
   * Used by: workout, reading, meditation, cooking, art, coding, music, videoGames
   *
   * Example: standardActivity("meditation", "Meditation")
   * Generates: meditationDays, meditationSessions, meditationHoursTotal, meditationBlocks
   */
  standardActivity: (id, name) => [
    { type: "count", label: `${name} Days`, notionProperty: `${id}Days` },
    {
      type: "count",
      label: `${name} Sessions`,
      notionProperty: `${id}Sessions`,
    },
    {
      type: "decimal",
      label: `${name} Hours Total`,
      notionProperty: `${id}HoursTotal`,
    },
    {
      type: "optionalText",
      label: `${name} Blocks`,
      notionProperty: `${id}Blocks`,
    },
  ],

  /**
   * Simple counter pattern: Just days
   * Used by: normalWakeUp, sober
   */
  simpleCounter: (id, name) => [
    { type: "count", label: `${name} Days`, notionProperty: `${id}Days` },
  ],

  /**
   * Counter with blocks pattern: Days + Blocks (no hours/sessions)
   * Used by: drinking
   */
  counterWithBlocks: (id, name) => [
    { type: "count", label: `${name} Days`, notionProperty: `${id}Days` },
    {
      type: "optionalText",
      label: `${name} Blocks`,
      notionProperty: `${id}Blocks`,
    },
  ],

  /**
   * Sleep days pattern: Just days (hours handled at summary level)
   * Used by: sleepIn (with special sleepHoursTotal added separately)
   */
  sleepDays: (id, name) => [
    { type: "count", label: `${name} Days`, notionProperty: `${id}Days` },
  ],

  /**
   * Category activity pattern: Sessions, Hours, Blocks (no Days)
   * Used by: personalCalendar categories, workCalendar categories
   */
  categoryActivity: (id, name) => [
    {
      type: "count",
      label: `${name} Sessions`,
      notionProperty: `${id}Sessions`,
    },
    {
      type: "decimal",
      label: `${name} Hours Total`,
      notionProperty: `${id}HoursTotal`,
    },
    {
      type: "optionalText",
      label: `${name} Blocks`,
      notionProperty: `${id}Blocks`,
    },
  ],

  /**
   * Task category pattern: Tasks Complete + Task Details
   * Used by: tasks categories, workTasks categories
   */
  taskCategory: (id, name) => [
    {
      type: "count",
      label: `${name} Tasks Complete`,
      notionProperty: `${id}TasksComplete`,
    },
    {
      type: "optionalText",
      label: `${name} Task Details`,
      notionProperty: `${id}TaskDetails`,
    },
  ],
};

/**
 * CALENDARS - The atomic units
 * Each calendar represents a single Google Calendar
 */
const CALENDARS = {
  normalWakeUp: {
    id: "normalWakeUp",
    envVar: "NORMAL_WAKE_UP_CALENDAR_ID",
    name: "Normal Wake Up",
    emoji: "☀️",
    ignoreAllDayEvents: true,
    dateLogic: "end",
    dataFields: FIELD_TEMPLATES.simpleCounter("earlyWakeup", "Early Wakeup"),
  },
  sleepIn: {
    id: "sleepIn",
    envVar: "SLEEP_IN_CALENDAR_ID",
    name: "Sleep In",
    emoji: "🌙",
    ignoreAllDayEvents: true,
    dateLogic: "end",
    // Special case: sleepHoursTotal is aggregated across both normalWakeUp + sleepIn
    // That's why it uses "sleepHoursTotal" instead of "sleepInHoursTotal"
    dataFields: [
      ...FIELD_TEMPLATES.sleepDays("sleepIn", "Sleep In"),
      {
        type: "decimal",
        label: "Sleep Hours Total",
        notionProperty: "sleepHoursTotal",
      },
    ],
  },
  naps: {
    id: "naps",
    envVar: "NAPS_CALENDAR_ID",
    name: "Naps",
    emoji: "💤",
    ignoreAllDayEvents: true,
    dateLogic: "end",
    // Naps are context-only — no Weekly Summary fields. Stays off the
    // sleep-trend counters (sleepInDays / earlyWakeupDays / sleepHoursTotal).
    dataFields: [],
  },
  workout: {
    id: "workout",
    envVar: "WORKOUT_CALENDAR_ID",
    name: "Workout",
    emoji: "💪",
    dataFields: FIELD_TEMPLATES.standardActivity("workout", "Workout"),
  },
  sober: {
    id: "sober",
    envVar: "SOBER_CALENDAR_ID",
    name: "Sober",
    emoji: "💧",
    dataFields: FIELD_TEMPLATES.simpleCounter("sober", "Sober"),
  },
  drinking: {
    id: "drinking",
    envVar: "DRINKING_CALENDAR_ID",
    name: "Drinking",
    emoji: "🍷",
    dataFields: FIELD_TEMPLATES.counterWithBlocks("drinking", "Drinking"),
  },
  reading: {
    id: "reading",
    envVar: "READING_CALENDAR_ID",
    name: "Reading",
    emoji: "📖",
    dataFields: FIELD_TEMPLATES.standardActivity("reading", "Reading"),
  },
  meditation: {
    id: "meditation",
    envVar: "MEDITATION_CALENDAR_ID",
    name: "Meditation",
    emoji: "🧘",
    dataFields: FIELD_TEMPLATES.standardActivity("meditation", "Meditation"),
  },
  cooking: {
    id: "cooking",
    envVar: "COOKING_CALENDAR_ID",
    name: "Cooking",
    emoji: "🍗",
    dataFields: FIELD_TEMPLATES.standardActivity("cooking", "Cooking"),
  },
  art: {
    id: "art",
    envVar: "ART_CALENDAR_ID",
    name: "Art",
    emoji: "🎨",
    dataFields: FIELD_TEMPLATES.standardActivity("art", "Art"),
  },
  coding: {
    id: "coding",
    envVar: "CODING_CALENDAR_ID",
    name: "Coding",
    emoji: "🖥️",
    dataFields: FIELD_TEMPLATES.standardActivity("coding", "Coding"),
  },
  music: {
    id: "music",
    envVar: "MUSIC_CALENDAR_ID",
    name: "Music",
    emoji: "🎸",
    dataFields: FIELD_TEMPLATES.standardActivity("music", "Music"),
  },
  videoGames: {
    id: "videoGames",
    envVar: "VIDEO_GAMES_CALENDAR_ID",
    name: "Video Games",
    emoji: "🎮",
    dataFields: FIELD_TEMPLATES.standardActivity("videoGames", "Video Games"),
  },
  bodyWeight: {
    id: "bodyWeight",
    envVar: "BODY_WEIGHT_CALENDAR_ID",
    name: "Body Weight",
    emoji: "⚖️",
    dataFields: [
      {
        type: "decimal",
        label: "Body Weight Average",
        notionProperty: "bodyWeightAverage",
      },
    ],
  },
  bloodPressure: {
    id: "bloodPressure",
    envVar: "BLOOD_PRESSURE_CALENDAR_ID",
    name: "Blood Pressure",
    emoji: "🫀",
    dataFields: [
      {
        type: "decimal",
        label: "Blood Pressure Systolic Average",
        notionProperty: "avgSystolic",
      },
      {
        type: "decimal",
        label: "Blood Pressure Diastolic Average",
        notionProperty: "avgDiastolic",
      },
    ],
  },
  personalPRs: {
    id: "personalPRs",
    envVar: "PERSONAL_PRS_CALENDAR_ID",
    name: "Personal PRs",
    emoji: "💾",
    dataFields: [
      {
        type: "count",
        label: "Personal PRs Sessions",
        notionProperty: "personalPRsSessions",
      },
      {
        type: "optionalText",
        label: "Personal PRs Details",
        notionProperty: "personalPRsDetails",
      },
    ],
  },
  workPRs: {
    id: "workPRs",
    envVar: "WORK_PRS_CALENDAR_ID",
    name: "Work PRs",
    emoji: "💾",
    dataFields: [
      {
        type: "count",
        label: "Work PRs Sessions",
        notionProperty: "workPRsSessions",
      },
      {
        type: "optionalText",
        label: "Work PRs Details",
        notionProperty: "workPRsDetails",
      },
    ],
  },
  personalCalendar: {
    ignoreDeclinedEvents: true,
    ignoreAllDayEvents: true,
    excludeKeywords: ["sleep", "nap"],
    id: "personalCalendar",
    envVar: "PERSONAL_MAIN_CALENDAR_ID",
    name: "Personal Calendar",
    emoji: "📅",
    dataFields: [
      // Note: Personal calendar has nested categories handled at DATA_SOURCES level
      // This represents the atomic calendar unit
    ],
    categories: {
      personal: {
        emoji: "🌱",
        dataFields: FIELD_TEMPLATES.categoryActivity("personal", "Personal"),
      },
      family: {
        emoji: "💜",
        dataFields: FIELD_TEMPLATES.categoryActivity("family", "Family"),
      },
      relationship: {
        emoji: "🩵",
        dataFields: FIELD_TEMPLATES.categoryActivity(
          "relationship",
          "Relationship",
        ),
      },
      interpersonal: {
        emoji: "🍻",
        dataFields: FIELD_TEMPLATES.categoryActivity(
          "interpersonal",
          "Interpersonal",
        ),
      },
      home: {
        emoji: "🏠",
        dataFields: FIELD_TEMPLATES.categoryActivity("home", "Home"),
      },
      physicalHealth: {
        emoji: "💪",
        dataFields: FIELD_TEMPLATES.categoryActivity(
          "physicalHealth",
          "Physical Health",
        ),
      },
      mentalHealth: {
        emoji: "❤️",
        dataFields: FIELD_TEMPLATES.categoryActivity(
          "mentalHealth",
          "Mental Health",
        ),
      },
      ignore: {
        emoji: "🚫",
        dataFields: [
          {
            type: "optionalText",
            label: "Ignore Blocks",
            notionProperty: "ignoreBlocks",
          },
        ],
      },
    },
  },
  workCalendar: {
    ignoreDeclinedEvents: true,
    ignoreAllDayEvents: true,
    id: "workCalendar",
    envVar: "WORK_MAIN_CALENDAR_ID",
    name: "Work Calendar",
    emoji: "📅",
    dataFields: [
      // Note: Work calendar has nested categories handled at DATA_SOURCES level
      // This represents the atomic calendar unit
    ],
    categories: {
      meetings: {
        emoji: "💼",
        dataFields: FIELD_TEMPLATES.categoryActivity("meetings", "Meetings"),
      },
      design: {
        emoji: "🎨",
        dataFields: FIELD_TEMPLATES.categoryActivity("design", "Design"),
      },
      coding: {
        emoji: "🖥️",
        dataFields: FIELD_TEMPLATES.categoryActivity("coding", "Coding"),
      },
      critique: {
        emoji: "⚠️",
        dataFields: FIELD_TEMPLATES.categoryActivity("critique", "Critique"),
      },
      exploration: {
        emoji: "💡",
        dataFields: FIELD_TEMPLATES.categoryActivity(
          "exploration",
          "Exploration",
        ),
      },
      personal: {
        emoji: "🌱",
        dataFields: FIELD_TEMPLATES.categoryActivity("personal", "Personal"),
      },
      rituals: {
        emoji: "🔁",
        dataFields: FIELD_TEMPLATES.categoryActivity("rituals", "Rituals"),
      },
      qa: {
        emoji: "🔎",
        dataFields: FIELD_TEMPLATES.categoryActivity("qa", "QA"),
      },
      hiring: {
        emoji: "🤝",
        dataFields: FIELD_TEMPLATES.categoryActivity("hiring", "Hiring"),
      },
      workAdmin: {
        emoji: "💼",
        dataFields: FIELD_TEMPLATES.categoryActivity("workAdmin", "Work Admin"),
      },
      marketing: {
        emoji: "📣",
        dataFields: FIELD_TEMPLATES.categoryActivity(
          "marketing",
          "Marketing & Branding",
        ),
      },
    },
  },
  tasks: {
    id: "tasks",
    envVar: "TASKS_DATABASE_ID",
    name: "Personal Tasks",
    emoji: "🌱",
    dataFields: [],
    categories: {
      personal: {
        emoji: "🌱",
        dataFields: FIELD_TEMPLATES.taskCategory("personal", "Personal"),
      },
      family: {
        emoji: "💜",
        dataFields: FIELD_TEMPLATES.taskCategory("family", "Family"),
      },
      relationship: {
        emoji: "🩵",
        dataFields: FIELD_TEMPLATES.taskCategory(
          "relationship",
          "Relationship",
        ),
      },
      interpersonal: {
        emoji: "🍻",
        dataFields: FIELD_TEMPLATES.taskCategory(
          "interpersonal",
          "Interpersonal",
        ),
      },
      home: {
        emoji: "🏠",
        dataFields: FIELD_TEMPLATES.taskCategory("home", "Home"),
      },
      physicalHealth: {
        emoji: "💪",
        dataFields: FIELD_TEMPLATES.taskCategory(
          "physicalHealth",
          "Physical Health",
        ),
      },
      mentalHealth: {
        emoji: "❤️",
        dataFields: FIELD_TEMPLATES.taskCategory(
          "mentalHealth",
          "Mental Health",
        ),
      },
      personalAdmin: {
        emoji: "🌱",
        dataFields: FIELD_TEMPLATES.taskCategory("personalAdmin", "Personal Admin"),
      },
      hobbies: {
        emoji: "🎸",
        dataFields: FIELD_TEMPLATES.taskCategory("hobbies", "Hobbies"),
      },
      cooking: {
        emoji: "🍗",
        dataFields: FIELD_TEMPLATES.taskCategory("cooking", "Cooking"),
      },
    },
  },
  workTasks: {
    id: "workTasks",
    envVar: "TASKS_DATABASE_ID",
    name: "Work Tasks",
    emoji: "💼",
    dataFields: [],
    categories: {
      exploration: {
        emoji: "💡",
        dataFields: FIELD_TEMPLATES.taskCategory("exploration", "Exploration"),
      },
      design: {
        emoji: "🎨",
        dataFields: FIELD_TEMPLATES.taskCategory("design", "Design"),
      },
      coding: {
        emoji: "🖥️",
        dataFields: FIELD_TEMPLATES.taskCategory("coding", "Coding"),
      },
      critique: {
        emoji: "⚠️",
        dataFields: FIELD_TEMPLATES.taskCategory("critique", "Critique"),
      },
      qa: {
        emoji: "🔎",
        dataFields: FIELD_TEMPLATES.taskCategory("qa", "QA"),
      },
      hiring: {
        emoji: "🤝",
        dataFields: FIELD_TEMPLATES.taskCategory("hiring", "Hiring"),
      },
      workAdmin: {
        emoji: "💼",
        dataFields: FIELD_TEMPLATES.taskCategory("workAdmin", "Work Admin"),
      },
    },
  },
};

/**
 * SUMMARY_GROUPS - How calendars combine for reporting
 * Each group defines which calendars feed into a summary metric
 */
const SUMMARY_GROUPS = {
  sleep: {
    id: "sleep",
    name: "Sleep (Early Wakeup + Sleep In)",
    emoji: "🛏️",
    calendars: ["normalWakeUp", "sleepIn"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "multiCalendar",
  },
  drinkingDays: {
    id: "drinkingDays",
    name: "Drinking Days (Sober + Drinking)",
    emoji: "🍷",
    calendars: ["sober", "drinking"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "daysWithBlocks",
  },
  workout: {
    id: "workout",
    name: "Workout",
    emoji: "💪",
    calendars: ["workout"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "standardActivity",
  },
  reading: {
    id: "reading",
    name: "Reading",
    emoji: "📖",
    calendars: ["reading"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "standardActivity",
  },
  meditation: {
    id: "meditation",
    name: "Meditation",
    emoji: "🧘",
    calendars: ["meditation"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "standardActivity",
  },
  cooking: {
    id: "cooking",
    name: "Cooking",
    emoji: "🍗",
    calendars: ["cooking"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "standardActivity",
  },
  art: {
    id: "art",
    name: "Art",
    emoji: "🎨",
    calendars: ["art"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "standardActivity",
  },
  coding: {
    id: "coding",
    name: "Coding",
    emoji: "🖥️",
    calendars: ["coding"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "standardActivity",
  },
  music: {
    id: "music",
    name: "Music",
    emoji: "🎸",
    calendars: ["music"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "standardActivity",
  },
  videoGames: {
    id: "videoGames",
    name: "Video Games",
    emoji: "🎮",
    calendars: ["videoGames"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "standardActivity",
  },
  bodyWeight: {
    id: "bodyWeight",
    name: "Body Weight",
    emoji: "⚖️",
    calendars: ["bodyWeight"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "customParser",
    parser: "weightParser",
  },
  bloodPressure: {
    id: "bloodPressure",
    name: "Blood Pressure",
    emoji: "🫀",
    calendars: ["bloodPressure"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "customParser",
    parser: "bloodPressureParser",
  },
  personalPRs: {
    id: "personalPRs",
    name: "Personal PRs",
    emoji: "💾",
    calendars: ["personalPRs"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "sessionsDetails",
  },
  workPRs: {
    id: "workPRs",
    name: "Work PRs",
    emoji: "💾",
    calendars: ["workPRs"],
    sourceType: "work",
    isNotionSource: false,
    summarize: true,
    processingPattern: "sessionsDetails",
  },
  personalCalendar: {
    ignoreDeclinedEvents: true,
    id: "personalCalendar",
    name: "Personal Calendar",
    emoji: "📅",
    calendars: ["personalCalendar"],
    sourceType: "personal",
    isNotionSource: false,
    summarize: true,
    processingPattern: "categoryBased",
  },
  workCalendar: {
    ignoreDeclinedEvents: true,
    id: "workCalendar",
    name: "Work Calendar",
    emoji: "📅",
    calendars: ["workCalendar"],
    sourceType: "work",
    isNotionSource: false,
    summarize: true,
    processingPattern: "categoryBased",
  },
  tasks: {
    id: "tasks",
    name: "Personal Tasks",
    emoji: "🌱",
    isNotionSource: true,
    databaseIdEnvVar: "TASKS_DATABASE_ID",
    sourceType: "personal",
    summarize: true,
    processingPattern: "categoryBased",
  },
  workTasks: {
    id: "workTasks",
    name: "Work Tasks",
    emoji: "💼",
    isNotionSource: true,
    databaseIdEnvVar: "TASKS_DATABASE_ID",
    sourceType: "work",
    summarize: true,
    processingPattern: "categoryBased",
  },
};

/**
 * HABITS_GROUP_IDS - Groups that belong to Personal Habits database
 * These groups are excluded from Personal Summary (they have their own database)
 */
const HABITS_GROUP_IDS = [
  "workout",
  "reading",
  "meditation",
  "cooking",
  "art",
  "coding",
  "music",
  "videoGames",
  "bodyWeight",
  "bloodPressure",
  "sleep",
  "drinkingDays",
];

/**
 * TIME_BLOCKED_HABITS_IDS - Time-blocked habits that have Blocks/HoursTotal fields
 * These are activities tracked with time blocks and should have Blocks/HoursTotal in Personal Summary
 * Excludes counter-based habits (sleep, drinkingDays) and integration metrics (bodyWeight, bloodPressure)
 */
const TIME_BLOCKED_HABITS_IDS = [
  "workout",
  "reading",
  "meditation",
  "cooking",
  "art",
  "coding",
  "music",
  "videoGames",
];

/**
 * INTEGRATIONS - API → Notion
 * Each integration defines which Notion database it uses and which calendars it syncs to
 */
const INTEGRATIONS = {
  oura: {
    id: "oura",
    name: "Oura (Sleep)",
    notionDbEnvVar: "NOTION_SLEEP_DATABASE_ID",
    calendarRouting: ["normalWakeUp", "sleepIn", "naps"],
    collect: true,
    displayMetadata: {
      tableTitle: "OURA SLEEP DATA",
      emptyMessage: "⚠️  No sleep data found for this date range\n",
      displayType: "oura",
    },
    updateCalendar: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No sleep records found without calendar events\n",
      sourceType: "sleep",
      eventType: "dateTime",
      displayNameProperty: "nightOfDate",
      displayNameFormat: "date",
      skipReason: "Missing bedtime or wake time",
      transformerFile: "../transformers/notion-oura-to-calendar-sleep.js",
      transformerFunction: "transformSleepToCalendarEvent",
      displayFields: [
        { key: "nightOf", property: "nightOfDate" },
        { key: "bedtime", property: "bedtime" },
        { key: "wakeTime", property: "wakeTime" },
        { key: "duration", property: "sleepDuration" },
        { key: "efficiency", property: "efficiency" },
        { key: "calendar", property: "googleCalendar", default: "Unknown" },
      ],
      tableTitle: "📊 SLEEP RECORDS TO SYNC",
      displayFormat: (record) =>
        `📅 ${record.nightOf}: Sleep - ${record.duration}hrs (${record.efficiency}% efficiency) → ${record.calendar}`,
      recordLabel: "sleep record",
    },
    databaseConfig: {
      dateProperty: "nightOfDate",
      uniqueIdProperty: "sleepId",
      uniqueIdType: "text",
      calendarCreatedProperty: "calendarCreated",
    },
  },
  strava: {
    id: "strava",
    name: "Strava (Workouts)",
    notionDbEnvVar: "NOTION_WORKOUTS_DATABASE_ID",
    calendarRouting: ["workout"],
    collect: true,
    displayMetadata: {
      tableTitle: "STRAVA ACTIVITIES",
      emptyMessage: "⚠️  No Strava activities found for this date range\n",
      displayType: "strava",
    },
    updateCalendar: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No workout records found without calendar events\n",
      sourceType: "strava",
      eventType: "dateTime",
      displayNameProperty: "name",
      displayNameFormat: "text",
      skipReason: "Missing date, start time, or duration",
      transformerFile: "../transformers/notion-strava-to-calendar-workouts.js",
      transformerFunction: "transformWorkoutToCalendarEvent",
      displayFields: [
        { key: "name", property: "name" },
        { key: "date", property: "date" },
        {
          key: "startTime",
          property: "startTime",
          format: (val) => (val ? new Date(val).toLocaleString() : "N/A"),
        },
        { key: "duration", property: "duration" },
        { key: "type", property: "type" },
      ],
      tableTitle: "🏋️  WORKOUT RECORDS TO SYNC",
      displayFormat: (record) =>
        `🏋️  ${record.date} ${record.startTime}: ${record.name} (${record.duration} min) - ${record.type}`,
      recordLabel: "workout record",
    },
    databaseConfig: {
      dateProperty: "date",
      uniqueIdProperty: "activityId",
      uniqueIdType: "number",
      calendarCreatedProperty: "calendarCreated",
    },
  },
  githubPersonal: {
    id: "githubPersonal",
    name: "GitHub Personal (Activity)",
    notionDbEnvVar: "NOTION_PERSONAL_PRS_DATABASE_ID",
    calendarRouting: ["personalPRs"],
    collect: true,
    displayMetadata: {
      tableTitle: "GITHUB PERSONAL ACTIVITIES",
      emptyMessage:
        "⚠️  No GitHub personal activities found for this date range\n",
      displayType: "githubPersonal",
    },
    updateCalendar: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No personal PR records found without calendar events\n",
      sourceType: "githubPersonal",
      eventType: "allDay",
      displayNameProperty: "repository",
      displayNameFormat: "repoDate",
      skipReason: "Missing date",
      transformerFile: "../transformers/notion-githubPersonal-to-calendar.js",
      transformerFunction: "transformGithubPersonalToCalendarEvent",
      useMultipleCalendarServices: true,
      displayFields: [
        {
          key: "repository",
          property: "repository",
          format: (val) => {
            if (!val) return "Unknown Repository";
            const repoMatch = val.match(/^([^\s-]+)/);
            if (repoMatch) {
              const repoPath = repoMatch[1];
              const parts = repoPath.split("/");
              return parts[parts.length - 1];
            }
            return val;
          },
        },
        { key: "date", property: "date" },
        { key: "commitsCount", property: "commitsCount", default: 0 },
        { key: "totalLinesAdded", property: "totalLinesAdded", default: 0 },
        { key: "totalLinesDeleted", property: "totalLinesDeleted", default: 0 },
        {
          key: "linesAdded",
          property: null, // Computed field - alias for totalLinesAdded
          compute: (record) => record.totalLinesAdded || 0,
        },
        {
          key: "linesDeleted",
          property: null, // Computed field - alias for totalLinesDeleted
          compute: (record) => record.totalLinesDeleted || 0,
        },
      ],
      tableTitle: "💻 GITHUB PERSONAL PR RECORDS TO SYNC",
      displayFormat: (record) =>
        `💻 ${record.date}: ${record.repository} - ${
          record.commitsCount
        } commit${record.commitsCount === 1 ? "" : "s"} (+${
          record.linesAdded
        }/-${record.linesDeleted} lines)`,
      recordLabel: "PR record",
    },
    databaseConfig: {
      dateProperty: "date",
      uniqueIdProperty: "uniqueId",
      uniqueIdType: "text",
      calendarEventIdProperty: "calendarEventId",
      calendarCreatedProperty: "calendarCreated",
    },
  },
  githubWork: {
    id: "githubWork",
    name: "GitHub Work (PRs)",
    notionDbEnvVar: "NOTION_WORK_PRS_DATABASE_ID",
    calendarRouting: ["workPRs"],
    collect: true,
    displayMetadata: {
      tableTitle: "GITHUB WORK PRS",
      emptyMessage: "⚠️  No GitHub work PRs found for this date range\n",
      displayType: "githubWork",
    },
    updateCalendar: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No work PR records found without calendar events\n",
      sourceType: "githubWork",
      eventType: "allDay",
      displayNameProperty: "prTitle",
      displayNameFormat: "text",
      skipReason: "Missing merge date",
      transformerFile: "../transformers/notion-githubWork-to-calendar.js",
      transformerFunction: "transformGithubWorkToCalendarEvent",
      useMultipleCalendarServices: true,
      displayFields: [
        {
          key: "prTitle",
          property: "prTitle",
          format: (val) => val || "Unknown PR",
        },
        {
          key: "repository",
          property: "repository",
          format: (val) => {
            if (!val) return "Unknown Repository";
            const repoMatch = val.match(/^([^\s-]+)/);
            if (repoMatch) {
              const repoPath = repoMatch[1];
              const parts = repoPath.split("/");
              return parts[parts.length - 1];
            }
            return val;
          },
        },
        { key: "mergeDate", property: "mergeDate" },
        { key: "prNumber", property: "prNumber", default: 0 },
        { key: "commitsCount", property: "commitsCount", default: 0 },
        { key: "totalLinesAdded", property: "totalLinesAdded", default: 0 },
        { key: "totalLinesDeleted", property: "totalLinesDeleted", default: 0 },
        {
          key: "linesAdded",
          property: null, // Computed field - alias for totalLinesAdded
          compute: (record) => record.totalLinesAdded || 0,
        },
        {
          key: "linesDeleted",
          property: null, // Computed field - alias for totalLinesDeleted
          compute: (record) => record.totalLinesDeleted || 0,
        },
      ],
      tableTitle: "💻 GITHUB WORK PR RECORDS TO SYNC",
      displayFormat: (record) =>
        `💻 ${record.mergeDate}: ${record.prTitle} (#${record.prNumber}) - ${
          record.commitsCount
        } commit${record.commitsCount === 1 ? "" : "s"} (+${
          record.linesAdded
        }/-${record.linesDeleted} lines)`,
      recordLabel: "PR record",
    },
    databaseConfig: {
      dateProperty: "mergeDate",
      uniqueIdProperty: "uniqueId",
      uniqueIdType: "text",
      calendarEventIdProperty: "calendarEventId",
      calendarCreatedProperty: "calendarCreated",
    },
  },
  steam: {
    id: "steam",
    name: "Steam (Video Games)",
    notionDbEnvVar: "NOTION_VIDEO_GAMES_DATABASE_ID",
    calendarRouting: ["videoGames"],
    collect: true,
    displayMetadata: {
      tableTitle: "STEAM GAMING ACTIVITIES",
      emptyMessage:
        "⚠️  No Steam gaming activities found for this date range\n",
      displayType: "steam",
    },
    updateCalendar: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No gaming records found without calendar events\n",
      sourceType: "steam",
      eventType: "dateTime",
      displayNameProperty: "gameName",
      displayNameFormat: "text",
      skipReason: "Missing date, start time, or end time",
      transformerFile: "../transformers/notion-steam-to-calendar-games.js",
      transformerFunction: "transformSteamToCalendarEvent",
      displayFields: [
        { key: "gameName", property: "gameName" },
        { key: "date", property: "date" },
        { key: "minutesPlayed", property: "minutesPlayed" },
        { key: "startTimeDisplay", property: "startTimeDisplay" },
        { key: "endTimeDisplay", property: "endTimeDisplay" },
        {
          key: "playtime",
          property: null,
          compute: (record) => {
            const minutes = record.minutesPlayed || 0;
            if (minutes >= 60) {
              const hours = Math.floor(minutes / 60);
              const mins = minutes % 60;
              return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
            }
            return `${minutes}m`;
          },
        },
      ],
      tableTitle: "🎮 STEAM GAMING RECORDS TO SYNC",
      displayFormat: (record) =>
        `🎮 ${record.date}: ${record.gameName} (${record.playtime}) ${record.startTimeDisplay}-${record.endTimeDisplay}`,
      recordLabel: "gaming record",
    },
    databaseConfig: {
      dateProperty: "date",
      uniqueIdProperty: "activityId",
      uniqueIdType: "text",
      calendarCreatedProperty: "calendarCreated",
    },
  },
  withings: {
    id: "withings",
    name: "Withings (Body Weight)",
    notionDbEnvVar: "NOTION_BODY_WEIGHT_DATABASE_ID",
    calendarRouting: ["bodyWeight"],
    collect: true,
    displayMetadata: {
      tableTitle: "WITHINGS MEASUREMENTS",
      emptyMessage: "⚠️  No Withings measurements found for this date range\n",
      displayType: "withings",
    },
    updateCalendar: true,
    // Aggregate raw scale measurements (N per day) into one averaged calendar
    // event per day. Custom syncFn lives at workflows/withings-daily-calendar-sync.js.
    aggregateByDay: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No body weight records found without calendar events\n",
      sourceType: "withings",
      eventType: "allDay",
      displayNameProperty: "name",
      displayNameFormat: "text",
      skipReason: "Missing date",
      displayFields: [
        { key: "name", property: "name" },
        { key: "date", property: "date" },
        { key: "weight", property: "weight" },
        { key: "fatPercentage", property: "fatPercentage" },
        { key: "muscleMass", property: "muscleMass" },
      ],
      tableTitle: "⚖️  BODY WEIGHT RECORDS TO SYNC",
      displayFormat: (record) =>
        `⚖️  ${record.date}: ${record.weight} lbs (${record.fatPercentage}% fat, ${record.muscleMass} lbs muscle)`,
      recordLabel: "body weight record",
    },
    databaseConfig: {
      dateProperty: "date",
      uniqueIdProperty: "measurementId",
      uniqueIdType: "text",
      calendarCreatedProperty: "calendarCreated",
    },
  },
  bloodPressure: {
    id: "bloodPressure",
    name: "Blood Pressure",
    notionDbEnvVar: "NOTION_BLOOD_PRESSURE_DATABASE_ID",
    calendarRouting: ["bloodPressure"],
    collect: true,
    updateCalendar: true,
    // Aggregate raw cuff readings (N per day) into one averaged calendar event
    // per day. Custom syncFn lives at workflows/bloodPressure-daily-calendar-sync.js.
    aggregateByDay: true,
    calendarSyncMetadata: {
      emptyMessage:
        "✅ No blood pressure records found without calendar events\n",
      sourceType: "bloodPressure",
      eventType: "allDay",
      displayNameProperty: "name",
      displayNameFormat: "text",
      skipReason: "Missing date",
      displayFields: [
        { key: "name", property: "name" },
        { key: "date", property: "date" },
        { key: "systolicPressure", property: "systolicPressure" },
        { key: "diastolicPressure", property: "diastolicPressure" },
        { key: "pulse", property: "pulse" },
      ],
      tableTitle: "🩺 BLOOD PRESSURE RECORDS TO SYNC",
      displayFormat: (record) =>
        `🩺 ${record.date}: BP ${record.systolicPressure}/${record.diastolicPressure} (Pulse: ${record.pulse} bpm)`,
      recordLabel: "blood pressure record",
    },
    databaseConfig: {
      dateProperty: "date",
      uniqueIdProperty: "measurementId",
      uniqueIdType: "text",
      calendarCreatedProperty: "calendarCreated",
    },
  },
  medications: {
    id: "medications",
    name: "Medications",
    notionDbEnvVar: "NOTION_MEDICATIONS_DATABASE_ID",
    calendarRouting: ["medications"],
    collect: false,
    updateCalendar: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No medication records found without calendar events\n",
      sourceType: "medications",
      eventType: "allDay",
      displayNameProperty: "date",
      displayNameFormat: "date",
      skipReason: "Missing date, No meds checked, or neither AM/PM logged",
      transformerFile: "../transformers/notion-medications-to-calendar.js",
      transformerFunction: "transformMedicationToCalendarEvent",
      displayFields: [{ key: "date", property: "Date" }],
      tableTitle: "💊 MEDICATION RECORDS TO SYNC",
      displayFormat: (record) => `💊 ${record.date}: Medications`,
      recordLabel: "medication record",
    },
    databaseConfig: {
      dateProperty: "date",
      uniqueIdProperty: null,
      uniqueIdType: null,
      calendarEventIdProperty: "Calendar Event ID",
      cleanupOrphans: true,
    },
  },
  supplements: {
    id: "supplements",
    name: "Supplements",
    notionDbEnvVar: "NOTION_SUPPLEMENTS_DATABASE_ID",
    calendarRouting: ["supplements"],
    collect: false,
    updateCalendar: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No supplement records found without calendar events\n",
      sourceType: "supplements",
      eventType: "allDay",
      displayNameProperty: "date",
      displayNameFormat: "date",
      skipReason: "Missing date, No Supps checked, or neither AM/PM logged",
      transformerFile: "../transformers/notion-supplements-to-calendar.js",
      transformerFunction: "transformSupplementToCalendarEvent",
      displayFields: [{ key: "date", property: "Date" }],
      tableTitle: "🍬 SUPPLEMENT RECORDS TO SYNC",
      displayFormat: (record) => `🍬 ${record.date}: Supplements`,
      recordLabel: "supplement record",
    },
    databaseConfig: {
      dateProperty: "date",
      uniqueIdProperty: null,
      uniqueIdType: null,
      calendarEventIdProperty: "Calendar Event ID",
      cleanupOrphans: true,
    },
  },
  events: {
    id: "events",
    name: "Events",
    notionDbEnvVar: "NOTION_EVENTS_DATABASE_ID",
    calendarRouting: ["events"],
    collect: false,
    updateCalendar: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No event records found without calendar events\n",
      sourceType: "events",
      eventType: "allDay",
      displayNameProperty: "eventName",
      displayNameFormat: "text",
      skipReason: "Missing date or event name",
      displayFields: [
        { key: "eventName", property: "Event Name" },
        { key: "category", property: "Category" },
        { key: "date", property: "Date" },
        { key: "subcategory", property: "Subcategory" },
      ],
      transformerFile: "../transformers/notion-events-to-calendar-events.js",
      transformerFunction: "transformEventToCalendarEvent",
      tableTitle: "📅 EVENT RECORDS TO SYNC",
      displayFormat: (record) => `📅 ${record.date}: ${record.eventName}`,
      recordLabel: "event record",
    },
    databaseConfig: {
      dateProperty: "Date",
      calendarEventIdProperty: "Calendar Event ID",
      useHybridPattern: true,
      cleanupOrphans: true,
      syncEntireDb: true,
    },
  },
  trips: {
    id: "trips",
    name: "Trips",
    notionDbEnvVar: "NOTION_TRIPS_DATABASE_ID",
    calendarRouting: ["trips"],
    collect: false,
    updateCalendar: true,
    calendarSyncMetadata: {
      emptyMessage: "✅ No trip records found without calendar events\n",
      sourceType: "trips",
      eventType: "allDay",
      displayNameProperty: "tripName",
      displayNameFormat: "text",
      skipReason: "Missing date or trip name",
      displayFields: [
        { key: "tripName", property: "Trip Name" },
        { key: "category", property: "Category" },
        { key: "date", property: "Date" },
        { key: "emoji", property: "Emoji" },
      ],
      transformerFile: "../transformers/notion-trips-to-calendar-trips.js",
      transformerFunction: "transformTripToCalendarEvent",
      tableTitle: "✈️ TRIP RECORDS TO SYNC",
      displayFormat: (record) => `✈️ ${record.date}: ${record.tripName}`,
      recordLabel: "trip record",
    },
    databaseConfig: {
      dateProperty: "Date",
      calendarEventIdProperty: "Calendar Event ID",
      useHybridPattern: true,
      cleanupOrphans: true,
      syncEntireDb: true,
    },
  },
};

/**
 * Fetch key mapping for calendars
 * Maps calendar IDs to their fetch keys used in PERSONAL_SUMMARY_SOURCES/WORK_SUMMARY_SOURCES
 */
const FETCH_KEY_MAPPING = {
  normalWakeUp: "earlyWakeup",
  sleepIn: "sleepIn",
  naps: "naps",
  workout: "workout",
  sober: "sober",
  drinking: "drinking",
  reading: "reading",
  meditation: "meditation",
  cooking: "cooking",
  art: "art",
  coding: "coding",
  music: "music",
  videoGames: "videoGames",
  bodyWeight: "bodyWeight",
  bloodPressure: "bloodPressure",
  personalPRs: "personalPRs",
  workPRs: "workPRs",
  personalCalendar: "personalCalendar",
  workCalendar: "workCalendar",
};

/**
 * Calendar key mapping for calendars with different keys in recap sources
 * Maps calendar IDs to their keys used in PERSONAL_SUMMARY_SOURCES/WORK_SUMMARY_SOURCES
 */
const CALENDAR_KEY_MAPPING = {
  personalCalendar: "personalMain",
  workCalendar: "workMain",
};

/**
 * Verify derivation function
 * Derives the equivalent of PERSONAL_SUMMARY_SOURCES and WORK_SUMMARY_SOURCES from the three registries
 * Optionally compares to existing sources if provided as parameters
 * @param {Object|null} personalSources - Existing PERSONAL_SUMMARY_SOURCES to compare against (optional)
 * @param {Object|null} workSources - Existing WORK_SUMMARY_SOURCES to compare against (optional)
 */
function verifyDerivation(personalSources = null, workSources = null) {
  console.log("🔍 Verifying unified sources derivation...\n");

  // Derive PERSONAL_SUMMARY_SOURCES and WORK_SUMMARY_SOURCES equivalent from the three registries
  const derivedPersonal = {};
  const derivedWork = {};

  Object.entries(SUMMARY_GROUPS).forEach(([groupId, group]) => {
    // Skip Notion-based sources - handle separately
    if (group.isNotionSource) {
      const derivedGroup = {
        id: group.id,
        displayName: group.name,
        description: `Completed ${group.name.toLowerCase()} from Notion database`,
        required: false,
        sourceType: group.sourceType,
        isNotionSource: true,
        databaseId: process.env[group.databaseIdEnvVar],
      };

      if (group.sourceType === "personal") {
        derivedPersonal[groupId] = derivedGroup;
      } else {
        derivedWork[groupId] = derivedGroup;
      }
      return;
    }

    const calendarConfigs = group.calendars.map((calId) => {
      const calendar = CALENDARS[calId];
      if (!calendar) {
        throw new Error(`Calendar ${calId} not found in CALENDARS registry`);
      }
      const calendarKey = CALENDAR_KEY_MAPPING[calId] || calendar.id;
      return {
        key: calendarKey,
        envVar: calendar.envVar,
        required: true,
        fetchKey: FETCH_KEY_MAPPING[calId] || calendar.id,
      };
    });

    // Build display name from calendar names
    const calendarNames = group.calendars
      .map((calId) => CALENDARS[calId].name)
      .join(" + ");

    const derivedGroup = {
      id: group.id,
      displayName:
        group.calendars.length > 1
          ? `${group.name.split(" (")[0]} (${calendarNames})`
          : group.name,
      description: `${group.name} tracking from ${calendarNames} calendars`,
      required: false,
      sourceType: group.sourceType,
      calendars: calendarConfigs,
    };

    if (group.sourceType === "personal") {
      derivedPersonal[groupId] = derivedGroup;
    } else {
      derivedWork[groupId] = derivedGroup;
    }
  });

  // If no sources provided for comparison, just return derived structure
  if (personalSources === null && workSources === null) {
    console.log("📊 Derived Sources Structure:\n");
    console.log("Derived PERSONAL_SUMMARY_SOURCES structure:");
    console.log(JSON.stringify(derivedPersonal, null, 2));
    console.log("\nDerived WORK_SUMMARY_SOURCES structure:");
    console.log(JSON.stringify(derivedWork, null, 2));

    return {
      success: true,
      errors: [],
      warnings: [],
      derivedPersonal,
      derivedWork,
    };
  }

  // Compare with existing sources
  const existingPersonal = personalSources || {};
  const existingWork = workSources || {};
  const errors = [];
  const warnings = [];

  // Check personal recap sources
  const expectedPersonalGroups = Object.keys(SUMMARY_GROUPS).filter(
    (id) => SUMMARY_GROUPS[id].sourceType === "personal",
  );

  expectedPersonalGroups.forEach((groupId) => {
    if (!existingPersonal[groupId]) {
      errors.push(`❌ Missing group in PERSONAL_SUMMARY_SOURCES: ${groupId}`);
      return;
    }

    const derivedGroup = derivedPersonal[groupId];
    const existingGroup = existingPersonal[groupId];

    compareGroups(groupId, derivedGroup, existingGroup, errors, warnings);
  });

  // Check work recap sources
  const expectedWorkGroups = Object.keys(SUMMARY_GROUPS).filter(
    (id) => SUMMARY_GROUPS[id].sourceType === "work",
  );

  expectedWorkGroups.forEach((groupId) => {
    if (!existingWork[groupId]) {
      errors.push(`❌ Missing group in WORK_SUMMARY_SOURCES: ${groupId}`);
      return;
    }

    const derivedGroup = derivedWork[groupId];
    const existingGroup = existingWork[groupId];

    compareGroups(groupId, derivedGroup, existingGroup, errors, warnings);
  });

  // Report results
  console.log("📊 Comparison Results:\n");

  if (errors.length === 0 && warnings.length === 0) {
    console.log("✅ All derivations match existing SUMMARY_SOURCES!\n");
    console.log("Derived PERSONAL_SUMMARY_SOURCES structure:");
    console.log(JSON.stringify(derivedPersonal, null, 2));
    console.log("\nDerived WORK_SUMMARY_SOURCES structure:");
    console.log(JSON.stringify(derivedWork, null, 2));
  } else {
    if (errors.length > 0) {
      console.log("❌ ERRORS FOUND:\n");
      errors.forEach((error) => console.log(error));
      console.log();
    }

    if (warnings.length > 0) {
      console.log("⚠️  WARNINGS:\n");
      warnings.forEach((warning) => console.log(warning));
      console.log();
    }

    console.log("Derived PERSONAL_SUMMARY_SOURCES structure:");
    console.log(JSON.stringify(derivedPersonal, null, 2));
    console.log("\nExisting PERSONAL_SUMMARY_SOURCES structure:");
    console.log(
      JSON.stringify(
        expectedPersonalGroups.reduce((acc, key) => {
          if (existingPersonal[key]) acc[key] = existingPersonal[key];
          return acc;
        }, {}),
        null,
        2,
      ),
    );
    console.log("\nDerived WORK_SUMMARY_SOURCES structure:");
    console.log(JSON.stringify(derivedWork, null, 2));
    console.log("\nExisting WORK_SUMMARY_SOURCES structure:");
    console.log(
      JSON.stringify(
        expectedWorkGroups.reduce((acc, key) => {
          if (existingWork[key]) acc[key] = existingWork[key];
          return acc;
        }, {}),
        null,
        2,
      ),
    );
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    derivedPersonal,
    derivedWork,
    existingPersonal: expectedPersonalGroups.reduce((acc, key) => {
      if (existingPersonal[key]) acc[key] = existingPersonal[key];
      return acc;
    }, {}),
    existingWork: expectedWorkGroups.reduce((acc, key) => {
      if (existingWork[key]) acc[key] = existingWork[key];
      return acc;
    }, {}),
  };
}

/**
 * Helper function to compare derived and existing groups
 */
function compareGroups(groupId, derivedGroup, existingGroup, errors, warnings) {
  // Compare id
  if (derivedGroup.id !== existingGroup.id) {
    errors.push(
      `❌ ID mismatch for ${groupId}: derived="${derivedGroup.id}", existing="${existingGroup.id}"`,
    );
  }

  // Compare sourceType
  if (derivedGroup.sourceType !== existingGroup.sourceType) {
    errors.push(
      `❌ sourceType mismatch for ${groupId}: derived="${derivedGroup.sourceType}", existing="${existingGroup.sourceType}"`,
    );
  }

  // Handle Notion-based sources
  if (derivedGroup.isNotionSource) {
    if (!existingGroup.isNotionSource) {
      errors.push(
        `❌ Expected ${groupId} to be Notion source but existing is not`,
      );
      return;
    }
    if (derivedGroup.databaseId !== existingGroup.databaseId) {
      warnings.push(
        `⚠️  databaseId differs for ${groupId}: derived uses ${
          derivedGroup.databaseId ? "env var" : "undefined"
        }, existing uses ${existingGroup.databaseId ? "env var" : "undefined"}`,
      );
    }
    return;
  }

  // Compare calendars array length
  if (!derivedGroup.calendars || !existingGroup.calendars) {
    if (derivedGroup.calendars !== existingGroup.calendars) {
      errors.push(
        `❌ Calendar array mismatch for ${groupId}: one is missing calendars array`,
      );
    }
    return;
  }

  if (derivedGroup.calendars.length !== existingGroup.calendars.length) {
    errors.push(
      `❌ Calendar count mismatch for ${groupId}: derived=${derivedGroup.calendars.length}, existing=${existingGroup.calendars.length}`,
    );
  } else {
    // Compare each calendar config
    derivedGroup.calendars.forEach((derivedCal, index) => {
      const existingCal = existingGroup.calendars[index];

      if (derivedCal.key !== existingCal.key) {
        errors.push(
          `❌ Calendar key mismatch for ${groupId}[${index}]: derived="${derivedCal.key}", existing="${existingCal.key}"`,
        );
      }

      if (derivedCal.envVar !== existingCal.envVar) {
        errors.push(
          `❌ Calendar envVar mismatch for ${groupId}[${index}]: derived="${derivedCal.envVar}", existing="${existingCal.envVar}"`,
        );
      }

      // fetchKey might differ - this is a warning, not an error
      if (derivedCal.fetchKey !== existingCal.fetchKey) {
        warnings.push(
          `⚠️  Calendar fetchKey differs for ${groupId}[${index}]: derived="${derivedCal.fetchKey}", existing="${existingCal.fetchKey}"`,
        );
      }
    });
  }
}

/**
 * Data field types and their display formatting
 */
const FIELD_TYPES = {
  // Numbers (integers)
  count: {
    format: (value) => value,
    default: 0,
    validate: (value) => typeof value === "number" && value >= 0,
  },

  // Decimals (floating point)
  decimal: {
    format: (value) => value.toFixed(2),
    default: 0,
    validate: (value) => typeof value === "number" && value >= 0,
  },

  // Text/Rich text (blocks, details, etc.)
  text: {
    format: (value) => value || "",
    default: "",
    validate: (value) => typeof value === "string",
  },

  // Optional text (only show if non-empty)
  optionalText: {
    format: (value) => value || null,
    default: null,
    validate: (value) => value === null || typeof value === "string",
  },
};

/**
 * Map display field type to Notion property type
 * @param {string} displayType - Field type ('count', 'decimal', 'text', 'optionalText')
 * @returns {string} Notion property type ('number', 'text')
 */
function mapToNotionType(displayType) {
  const typeMap = {
    count: "number",
    decimal: "number",
    text: "text",
    optionalText: "text",
  };
  return typeMap[displayType] || "text";
}

/**
 * Derive properties from unified sources configuration
 * Collects all dataFields (including categories) from CALENDARS based on SUMMARY_GROUPS
 * @param {string} sourceType - "personal" or "work"
 * @returns {Object} Properties object compatible with summary.js format
 */
function derivePropertiesFromUnified(sourceType) {
  const properties = {
    // Special metadata properties (not in data sources)
    title: { name: "Week Summary", type: "title", enabled: true },
    date: { name: "Date", type: "date", enabled: true },
    weekNumber: { name: "Week Number", type: "number", enabled: true },
    year: { name: "Year", type: "number", enabled: true },
  };

  // Filter SUMMARY_GROUPS by sourceType
  const groups = Object.values(SUMMARY_GROUPS).filter((group) => {
    if (group.sourceType !== sourceType) return false;
    // Exclude habits groups from personal summary (they go to habits DB)
    if (sourceType === "personal" && HABITS_GROUP_IDS.includes(group.id))
      return false;
    return true;
  });

  // For each group, collect dataFields from CALENDARS
  groups.forEach((group) => {
    // Handle Notion sources (tasks, workTasks)
    if (group.isNotionSource) {
      const calendar = CALENDARS[group.id];
      if (calendar && calendar.categories) {
        // Collect dataFields from all categories
        Object.values(calendar.categories).forEach((category) => {
          if (category.dataFields) {
            category.dataFields.forEach((field) => {
              // Skip Sessions fields
              if (field.notionProperty.endsWith("Sessions")) {
                return;
              }
              properties[field.notionProperty] = {
                name: field.label,
                type: mapToNotionType(field.type),
                enabled: true,
              };
            });
          }
        });
      }
      return;
    }

    // Handle calendar-based groups
    if (group.calendars && Array.isArray(group.calendars)) {
      group.calendars.forEach((calendarId) => {
        const calendar = CALENDARS[calendarId];
        if (!calendar) return;

        // Collect direct dataFields
        if (calendar.dataFields && Array.isArray(calendar.dataFields)) {
          calendar.dataFields.forEach((field) => {
            // Skip Sessions fields
            if (field.notionProperty.endsWith("Sessions")) {
              return;
            }
            properties[field.notionProperty] = {
              name: field.label,
              type: mapToNotionType(field.type),
              enabled: true,
            };
          });
        }

        // Collect category-based dataFields
        if (calendar.categories) {
          Object.values(calendar.categories).forEach((category) => {
            if (category.dataFields && Array.isArray(category.dataFields)) {
              category.dataFields.forEach((field) => {
                // Skip Sessions fields
                if (field.notionProperty.endsWith("Sessions")) {
                  return;
                }
                properties[field.notionProperty] = {
                  name: field.label,
                  type: mapToNotionType(field.type),
                  enabled: true,
                };
              });
            }
          });
        }
      });
    }
  });

  // For Personal Summary: Add Blocks and HoursTotal fields from habits groups
  if (sourceType === "personal") {
    // Get time-blocked habits groups from SUMMARY_GROUPS
    const habitsGroups = Object.values(SUMMARY_GROUPS).filter(
      (group) =>
        TIME_BLOCKED_HABITS_IDS.includes(group.id) &&
        group.sourceType === "personal" &&
        group.calendars,
    );

    // For each habits group, add Blocks and HoursTotal fields
    habitsGroups.forEach((group) => {
      group.calendars.forEach((calendarId) => {
        const calendar = CALENDARS[calendarId];
        if (!calendar || !calendar.dataFields) return;

        // Only add fields ending in "Blocks" or "HoursTotal"
        calendar.dataFields.forEach((field) => {
          const propName = field.notionProperty;
          if (propName.endsWith("Blocks") || propName.endsWith("HoursTotal")) {
            properties[propName] = {
              name: field.label,
              type: mapToNotionType(field.type),
              enabled: true,
            };
          }
        });
      });
    });
  }

  return properties;
}

/**
 * Generate Personal Summary properties object from data sources
 * This becomes the source of truth for Notion property definitions
 * @returns {Object} Properties object compatible with personal-summary.js format
 */
function generatePersonalSummaryProperties() {
  return derivePropertiesFromUnified("personal");
}

/**
 * Generate Work Summary properties object from work data sources
 * This becomes the source of truth for Notion property definitions
 * @returns {Object} Properties object compatible with work-summary.js format
 */
function generateWorkSummaryProperties() {
  return derivePropertiesFromUnified("work");
}

/**
 * Generate Personal Habits properties object from habits-related data sources
 * This includes activities, health metrics, sleep, and drinking (excluding Blocks fields)
 * @returns {Object} Properties object compatible with personal-habits.js format
 */
function generateHabitsProperties() {
  const properties = {
    // Special metadata properties (not in data sources)
    title: { name: "Week Summary", type: "title", enabled: true },
    date: { name: "Date", type: "date", enabled: true },
    weekNumber: { name: "Week Number", type: "number", enabled: true },
    year: { name: "Year", type: "number", enabled: true },
  };

  // Filter SUMMARY_GROUPS to only include habits-related groups
  const groups = Object.values(SUMMARY_GROUPS).filter(
    (group) =>
      HABITS_GROUP_IDS.includes(group.id) && group.sourceType === "personal",
  );

  // For each group, collect dataFields from CALENDARS
  groups.forEach((group) => {
    // Handle calendar-based groups
    if (group.calendars && Array.isArray(group.calendars)) {
      group.calendars.forEach((calendarId) => {
        const calendar = CALENDARS[calendarId];
        if (!calendar) return;

        // Collect direct dataFields (excluding Blocks)
        if (calendar.dataFields && Array.isArray(calendar.dataFields)) {
          calendar.dataFields.forEach((field) => {
            // Skip Blocks fields
            if (field.notionProperty.endsWith("Blocks")) {
              return;
            }
            properties[field.notionProperty] = {
              name: field.label,
              type: mapToNotionType(field.type),
              enabled: true,
            };
          });
        }

        // Collect category-based dataFields (though habits groups don't use categories)
        if (calendar.categories) {
          Object.values(calendar.categories).forEach((category) => {
            if (category.dataFields && Array.isArray(category.dataFields)) {
              category.dataFields.forEach((field) => {
                // Skip Blocks fields
                if (field.notionProperty.endsWith("Blocks")) {
                  return;
                }
                properties[field.notionProperty] = {
                  name: field.label,
                  type: mapToNotionType(field.type),
                  enabled: true,
                };
              });
            }
          });
        }
      });
    }
  });

  return properties;
}

/**
 * Derive DATA_SOURCES structure from CALENDARS + SUMMARY_GROUPS
 * This replaces the hardcoded DATA_SOURCES in main.js
 * @returns {Object} DATA_SOURCES object matching the exact structure expected by downstream code
 */
function deriveDataSources() {
  const dataSources = {};

  Object.entries(SUMMARY_GROUPS).forEach(([groupId, group]) => {
    const source = {
      id: group.id,
      name: group.name,
      emoji: group.emoji,
    };

    // Handle Notion database sources
    if (group.isNotionSource) {
      source.type = "notion_database";
      source.apiSource = "notion";
      source.database = process.env[group.databaseIdEnvVar];

      // Get calendar config (tasks/workTasks calendar has same id as group)
      const calendar = CALENDARS[groupId];
      if (calendar && calendar.categories) {
        source.categories = {};
        Object.entries(calendar.categories).forEach(([catId, category]) => {
          source.categories[catId] = {
            // Preserve emoji if present in category
            ...(category.emoji && { emoji: category.emoji }),
            data: {},
          };

          // Convert dataFields array to data object
          if (category.dataFields) {
            category.dataFields.forEach((field) => {
              source.categories[catId].data[field.notionProperty] = {
                label: field.label,
                type: field.type,
                notionProperty: field.notionProperty,
              };
            });
          }
        });
      }
    } else {
      // Handle calendar-based sources
      source.type = "calendar";
      source.apiSource = "google_calendar";

      // Build calendars object mapping calendar IDs to env vars
      if (group.calendars && Array.isArray(group.calendars)) {
        source.calendars = {};
        group.calendars.forEach((calId) => {
          const calendar = CALENDARS[calId];
          if (calendar) {
            // Use CALENDAR_KEY_MAPPING if exists, otherwise use calendar id as key
            const calendarKey = CALENDAR_KEY_MAPPING[calId] || calId;
            source.calendars[calendarKey] = process.env[calendar.envVar];
          }
        });

        // Determine if we need categories or flat data structure
        const hasCategories = group.calendars.some(
          (calId) => CALENDARS[calId]?.categories,
        );

        if (hasCategories) {
          // Calendar with categories (e.g., personalCalendar, workCalendar)
          // Only one calendar in group for category-based sources
          const calendar = CALENDARS[group.calendars[0]];
          if (calendar && calendar.categories) {
            source.categories = {};
            Object.entries(calendar.categories).forEach(([catId, category]) => {
              source.categories[catId] = {
                data: {},
              };

              // Convert dataFields array to data object
              if (category.dataFields) {
                category.dataFields.forEach((field) => {
                  source.categories[catId].data[field.notionProperty] = {
                    label: field.label,
                    type: field.type,
                    notionProperty: field.notionProperty,
                  };
                });
              }
            });
          }
        } else {
          // Flat data structure - combine dataFields from all calendars
          source.data = {};
          group.calendars.forEach((calId) => {
            const calendar = CALENDARS[calId];
            if (calendar && calendar.dataFields) {
              calendar.dataFields.forEach((field) => {
                source.data[field.notionProperty] = {
                  // Inherit calendar emoji to data field
                  ...(calendar.emoji && { emoji: calendar.emoji }),
                  label: field.label,
                  type: field.type,
                  notionProperty: field.notionProperty,
                };
              });
            }
          });

          // Special case: bodyWeightAverage has suffix
          if (groupId === "bodyWeight" && source.data.bodyWeightAverage) {
            source.data.bodyWeightAverage.suffix = " lbs";
          }

          // Special case: blood pressure averages have suffixes
          if (groupId === "bloodPressure") {
            if (source.data.avgSystolic) {
              source.data.avgSystolic.suffix = " mmHg";
            }
            if (source.data.avgDiastolic) {
              source.data.avgDiastolic.suffix = " mmHg";
            }
          }
        }
      }
    }

    dataSources[groupId] = source;
  });

  return dataSources;
}

// Derive DATA_SOURCES from unified config
const DATA_SOURCES = deriveDataSources();

/**
 * Helper Functions
 * These functions work with DATA_SOURCES for data access and availability checks
 */

/**
 * Get all data keys for a source (flattened)
 * @param {string} sourceId - Source ID
 * @returns {string[]} Array of data keys
 */
function getSourceDataKeys(sourceId) {
  const source = DATA_SOURCES[sourceId];
  if (!source) return [];

  if (source.data) {
    return Object.keys(source.data);
  }

  if (source.categories) {
    return Object.values(source.categories).flatMap((cat) =>
      Object.keys(cat.data),
    );
  }

  return [];
}

/**
 * Get all data for a source (flattened with configs)
 * @param {string} sourceId - Source ID
 * @returns {Object} Flattened data object with configs
 */
function getSourceData(sourceId) {
  const source = DATA_SOURCES[sourceId];
  if (!source) return {};

  if (source.data) {
    return source.data;
  }

  if (source.categories) {
    return Object.values(source.categories).reduce(
      (acc, cat) => ({ ...acc, ...cat.data }),
      {},
    );
  }

  return {};
}

/**
 * Check if a source is available (has required env vars)
 * @param {string} sourceId - Source ID
 * @returns {boolean} True if source is available
 */
function isSourceAvailable(sourceId) {
  const source = DATA_SOURCES[sourceId];
  if (!source) return false;

  // For sleep, both calendars are required
  if (sourceId === "sleep") {
    return source.calendars.normalWakeUp && source.calendars.sleepIn;
  }

  // For drinkingDays, both calendars are required
  if (sourceId === "drinkingDays") {
    return source.calendars.sober && source.calendars.drinking;
  }

  // For calendar sources, check if any calendar ID exists
  if (source.calendars) {
    return Object.values(source.calendars).some((id) => id);
  }

  // For database sources, check if database ID exists
  if (source.database) {
    return !!source.database;
  }

  return false;
}

/**
 * Get all available sources
 * @returns {string[]} Array of available source IDs
 */
function getAvailableSources() {
  return Object.keys(DATA_SOURCES).filter(isSourceAvailable);
}

/**
 * Monthly Recap Categories
 * Defines how block and task fields are grouped into monthly recap categories
 * Structure: { recapType: { blocks: {...}, tasks: {...} } }
 */
const MONTHLY_RECAP_CATEGORIES = {
  personal: {
    blocks: {
      family: ["familyBlocks"],
      relationship: ["relationshipBlocks"],
      interpersonal: ["interpersonalBlocks"],
      hobbies: [
        "readingBlocks",
        "meditationBlocks",
        "artBlocks",
        "codingBlocks",
        "musicBlocks",
        "videoGamesBlocks",
      ],
      mentalHealth: ["mentalHealthBlocks"],
    },
    tasks: {
      personal: ["personalTaskDetails"],
      home: ["homeTaskDetails"],
      physicalHealth: ["physicalHealthTaskDetails"],
      mentalHealth: ["mentalHealthTaskDetails"],
      admin: ["personalAdminTaskDetails"],
      // codingTaskDetails is the legacy personal-coding column (weekly
      // summaries stopped writing it 2026-08; personal coding is now
      // 🎸 Hobbies) — folded in so recaps spanning older weeks keep it.
      hobbies: ["hobbiesTaskDetails", "codingTaskDetails"],
      cooking: ["cookingTaskDetails"],
    },
  },
  work: {
    blocks: {
      meetings: ["meetingsBlocks"],
      social: ["personalBlocks"],
    },
    tasks: {
      design: ["designTaskDetails"],
      research: ["researchTaskDetails"],
      admin: ["workAdminTaskDetails"],
      coding: ["codingTaskDetails"],
      qa: ["qaTaskDetails"],
      hiring: ["hiringTaskDetails"],
      sketch: ["explorationTaskDetails"],
    },
  },
};

/**
 * Content Filters
 * Words to filter out from specific output columns (word boundary match, case-insensitive)
 * Structure: { command: { recapType: { fieldType: { categoryKey: [words] } } } }
 */
const CONTENT_FILTERS = {
  /**
   * yarn summarize: calendar events → weekly summary
   * Keys are column names (from summary output fields)
   */
  summarize: {
    personal: {
      // Standard activity blocks
      // workoutBlocks: [],
      // readingBlocks: [],
      // meditationBlocks: [],
      // cookingBlocks: [],
      // artBlocks: [],
      // codingBlocks: [],
      // musicBlocks: [],
      // videoGamesBlocks: [],
      // drinkingBlocks: [],
      // Personal calendar category blocks
      // personalBlocks: [],
      // familyBlocks: [],
      // relationshipBlocks: [],
      // interpersonalBlocks: [],
      // homeBlocks: [],
      // physicalHealthBlocks: [],
      // Filter-out-words
      mentalHealthBlocks: ["rot", "wasted", "waste"],
      // ignoreBlocks: [],
      // Personal task category details
      // Filter-out-words
      personalTaskDetails: [
        "shave",
        "laundry",
        "dry cleaning",
        "dry cleaner",
        "grocery",
        "groceries",
        "cvs",
        "recycles",
        "recycle",
        "compost",
        "trash",
        "dishes",
        "fold clothes",
      ],
      // familyTaskDetails: [],
      // relationshipTaskDetails: [],
      // interpersonalTaskDetails: [],
      // Filter-out-words
      homeTaskDetails: [
        "shave",
        "laundry",
        "dry cleaning",
        "dry cleaner",
        "grocery",
        "groceries",
        "cvs",
        "recycles",
        "recycle",
        "compost",
        "trash",
        "dishes",
        "fold clothes",
      ],
      // Filter-out-words
      physicalHealthTaskDetails: ["workout", "run"],
      // mentalHealthTaskDetails: [],
    },
    work: {
      // Work calendar category blocks
      // meetingsBlocks: [],
      // designBlocks: [],
      // codingBlocks: [],
      // critBlocks: [],
      // sketchBlocks: [],
      // researchBlocks: [],
      // Filter-out-words
      personalBlocks: ["lunch"],
      // ritualsBlocks: [],
      // qaBlocks: [],
      // adminBlocks: [],
      // Work task category details
      // researchTaskDetails: [],
      // sketchTaskDetails: [],
      // designTaskDetails: [],
      // codingTaskDetails: [],
      // critTaskDetails: [],
      // qaTaskDetails: [],
      // hiringTaskDetails: [],
      // adminTaskDetails: [],
      // socialTaskDetails: [],
      // oooTaskDetails: [],
    },
  },
  /**
   * yarn aggregate: weekly summaries → monthly recap
   * Keys are column names (from MONTHLY_RECAP_BLOCK_PROPERTIES and MONTHLY_RECAP_TASK_PROPERTIES)
   */
  recap: {
    personal: {
      // Block columns
      // personalFamilyBlocks: [],
      // personalRelationshipBlocks: [],
      // personalInterpersonalBlocks: [],
      // personalHobbiesBlocks: [],
      // Task columns
      // Filter-out-words
      personalPersonalTasks: [
        "shave",
        "laundry",
        "dry cleaning",
        "dry cleaner",
        "grocery",
        "groceries",
        "cvs",
        "recycles",
        "recycle",
        "compost",
        "trash",
        "dishes",
        "fold clothes",
      ],
      // Filter-out-words
      personalHomeTasks: [
        "shave",
        "laundry",
        "dry cleaning",
        "dry cleaner",
        "grocery",
        "groceries",
        "cvs",
        "recycles",
        "recycle",
        "compost",
        "trash",
        "dishes",
        "fold clothes",
      ],
      // personalPhysicalHealthTasks: [],
      // Filter-out-words
      personalMentalHealthTasks: ["rot", "wasted", "waste"],
    },
    work: {
      // Block columns
      // workMeetingsBlocks: [],
      // Filter-out-words
      workSocialBlocks: ["lunch"],
      // Task columns
      // workDesignTasks: [],
      // workResearchTasks: [],
      // workAdminTasks: [],
      // workCodingTasks: [],
      // workQATasks: [],
      // workHiringTasks: [],
    },
  },
};

/**
 * Monthly Recap Block Properties
 * Maps category keys to property keys and display names for block fields
 */
const MONTHLY_RECAP_BLOCK_PROPERTIES = {
  personal: {
    family: { key: "personalFamilyBlocks", name: "Family Block Details" },
    relationship: {
      key: "personalRelationshipBlocks",
      name: "Relationship Block Details",
    },
    interpersonal: {
      key: "personalInterpersonalBlocks",
      name: "Interpersonal Block Details",
    },
    hobbies: { key: "personalHobbiesBlocks", name: "Hobbies Block Details" },
    mentalHealth: {
      key: "personalMentalHealthBlocks",
      name: "Mental Health Block Details",
    },
  },
  work: {
    meetings: { key: "workMeetingsBlocks", name: "Meetings Block Details" },
    social: {
      key: "workSocialBlocks",
      name: "Social & Personal Block Details",
    },
  },
};

/**
 * Monthly Recap Task Properties
 * Maps category keys to property keys and display names for task fields
 */
const MONTHLY_RECAP_TASK_PROPERTIES = {
  personal: {
    personal: { key: "personalPersonalTasks", name: "Personal Task Details" },
    home: { key: "personalHomeTasks", name: "Home Task Details" },
    physicalHealth: {
      key: "personalPhysicalHealthTasks",
      name: "Physical Health Task Details",
    },
    mentalHealth: {
      key: "personalMentalHealthTasks",
      name: "Mental Health Task Details",
    },
    admin: { key: "personalAdminTasks", name: "Admin Task Details" },
    hobbies: { key: "personalHobbiesTasks", name: "Hobbies Task Details" },
    cooking: { key: "personalCookingTasks", name: "Cooking Task Details" },
  },
  work: {
    design: { key: "workDesignTasks", name: "Design Task Details" },
    research: { key: "workResearchTasks", name: "Research Task Details" },
    admin: { key: "workAdminTasks", name: "Admin Task Details" },
    coding: { key: "workCodingTasks", name: "Coding Task Details" },
    qa: { key: "workQATasks", name: "QA Task Details" },
    hiring: { key: "workHiringTasks", name: "Hiring Task Details" },
    sketch: { key: "workSketchTasks", name: "Sketch Task Details" },
  },
};

/**
 * Get all block field names for a recap type
 * Flattens MONTHLY_RECAP_CATEGORIES.blocks
 * @param {string} recapType - "personal" or "work"
 * @returns {Array<string>} Array of block field names
 */
function getBlocksFields(recapType) {
  const categories = MONTHLY_RECAP_CATEGORIES[recapType];
  if (!categories || !categories.blocks) return [];

  return Object.values(categories.blocks).flat();
}

/**
 * Get all task field names for a recap type
 * Flattens MONTHLY_RECAP_CATEGORIES.tasks
 * @param {string} recapType - "personal" or "work"
 * @returns {Array<string>} Array of task field names
 */
function getTaskFields(recapType) {
  const categories = MONTHLY_RECAP_CATEGORIES[recapType];
  if (!categories || !categories.tasks) return [];

  return Object.values(categories.tasks).flat();
}

/**
 * Get task completion field names for success messages
 * Derives from CALENDARS.tasks.categories or CALENDARS.workTasks.categories
 * @param {string} recapType - "personal" or "work"
 * @returns {Array<string>} Array of task completion field names (e.g., ["personalTasksComplete", ...])
 */
function getTaskCompletionFields(recapType) {
  const calendarKey = recapType === "personal" ? "tasks" : "workTasks";
  const calendar = CALENDARS[calendarKey];
  if (!calendar || !calendar.categories) return [];

  return Object.keys(calendar.categories).map(
    (catId) => `${catId}TasksComplete`,
  );
}

/**
 * Generate Personal Monthly Recap properties object
 * @returns {Object} Properties object with title + personal fields only
 */
function generatePersonalMonthlyRecapProperties() {
  const props = {
    title: { name: "Month Recap", type: "title", enabled: true },
  };

  // Personal block properties
  Object.entries(MONTHLY_RECAP_BLOCK_PROPERTIES.personal).forEach(
    ([_, prop]) => {
      props[prop.key] = { name: prop.name, type: "text", enabled: true };
    },
  );

  // Personal task properties
  Object.entries(MONTHLY_RECAP_TASK_PROPERTIES.personal).forEach(
    ([_, prop]) => {
      props[prop.key] = { name: prop.name, type: "text", enabled: true };
    },
  );

  return props;
}

/**
 * Generate Work Monthly Recap properties object
 * @returns {Object} Properties object with title + work fields only
 */
function generateWorkMonthlyRecapProperties() {
  const props = {
    title: { name: "Month Recap", type: "title", enabled: true },
  };

  // Work block properties
  Object.entries(MONTHLY_RECAP_BLOCK_PROPERTIES.work).forEach(([_, prop]) => {
    props[prop.key] = { name: prop.name, type: "text", enabled: true };
  });

  // Work task properties
  Object.entries(MONTHLY_RECAP_TASK_PROPERTIES.work).forEach(([_, prop]) => {
    props[prop.key] = { name: prop.name, type: "text", enabled: true };
  });

  return props;
}

module.exports = {
  FIELD_TEMPLATES,
  CALENDARS,
  SUMMARY_GROUPS,
  INTEGRATIONS,
  FETCH_KEY_MAPPING,
  CALENDAR_KEY_MAPPING,
  verifyDerivation,
  FIELD_TYPES,
  mapToNotionType,
  // derivePropertiesFromUnified removed - only used internally
  generatePersonalSummaryProperties,
  generateWorkSummaryProperties,
  generateHabitsProperties,
  CONTENT_FILTERS,
  MONTHLY_RECAP_CATEGORIES,
  MONTHLY_RECAP_BLOCK_PROPERTIES,
  MONTHLY_RECAP_TASK_PROPERTIES,
  generatePersonalMonthlyRecapProperties,
  generateWorkMonthlyRecapProperties,
  getBlocksFields,
  getTaskFields,
  getTaskCompletionFields,
  DATA_SOURCES,
  getSourceDataKeys,
  getSourceData,
  isSourceAvailable,
  getAvailableSources,
};
