# Brickomations Reference

**Technical reference for naming conventions, API mappings, and configuration**

> **Quick Links**: [Quickstart](../QUICKSTART.md) · [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Guides](GUIDES.md) · [Internals](INTERNALS.md)

## Documentation Navigation

**You are here:** `docs/REFERENCE.md` - Quick reference and lookups

**Other docs:**

- **[../QUICKSTART.md](../QUICKSTART.md)** - 5-minute overview
- **[../README.md](../README.md)** - Installation and setup
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Core architecture and design principles
- **[GUIDES.md](GUIDES.md)** - Step-by-step how-to guides
- **[INTERNALS.md](INTERNALS.md)** - Design patterns and best practices

## Table of Contents

- [Naming Conventions](#naming-conventions)
- [File Organization](#file-organization)
- [Configuration Reference](#configuration-reference)
- [API Field Mappings](#api-field-mappings)
- [Environment Variables](#environment-variables)

## Naming Conventions

### Layer-Specific Naming

**Golden Rule**: File and variable names must match their architectural layer.

#### Layer 1: Integration Names (API → Notion)

Use **integration names** that match the external API:

**✅ CORRECT**:

```javascript
// Files
collect - oura.js;
oura - to - notion - oura.js;
IntegrationDatabase("oura");

// Variables
const ouraData = await fetchOuraData();
const ouraDb = new IntegrationDatabase("oura");
config.notion.databases.oura;
config.notion.properties.oura;
```

**❌ WRONG**:

```javascript
// Don't use domain names in Layer 1
collect - sleep.js; // Wrong! Should be: collect-oura.js
config.notion.databases.sleep; // Wrong! Should be: config.notion.databases.oura
```

#### Layer 2: Domain Names (Notion → Calendar)

Use **domain names** that abstract away the source:

**✅ CORRECT**:

```javascript
// Files
notion - oura - to - calendar - sleep.js; // Integration → domain
notion - strava - to - calendar - workouts.js;

// Variables
const sleepCalendar = CALENDARS.sleep;
const sleepEvents = await createSleepEvents();
config.calendar.calendars.sleep;
```

**❌ WRONG**:

```javascript
// Don't use integration names in Layer 2
notion - oura - to - calendar - oura.js; // Wrong! Should use domain name: sleep
config.calendar.calendars.oura; // Wrong! Should be: config.calendar.calendars.sleep
```

#### Layer 3: Aggregation (Calendar → Summary)

Use **summary group names**:

```javascript
// Files
calendar - to - notion - personal Summary.js;
notion  Tasks - to - notion - summaries.js;

// Variables (internal identifiers - keep as-is)
const personalRecapData = aggregatePersonalData();
const workRecapData = aggregateWorkData();
```

### File Naming Patterns

#### Collectors

```
collect-{integration}.js
```

Examples: `collect-oura.js`, `collect-strava.js`

#### Transformers

**Layer 1** (API → Notion):

```
{integration}-to-notion-{integration}.js
```

Examples: `oura-to-notion-oura.js`, `strava-to-notion-strava.js`

**Layer 2** (Notion → Calendar):

```
notion-{integration}-to-calendar-{domain}.js
```

Examples: `notion-oura-to-calendar-sleep.js`, `notion-strava-to-calendar-workouts.js`

**Layer 3** (Calendar → Summary):

```
transform-calendar-to-notion-{summary-type}.js
```

Examples: `transform-calendar-to-notion-personal-summary.js`

#### Workflows

```
{source}-to-{destination}.js
```

Examples:

- `oura-to-notion-oura.js` (Layer 1)
- `notion-databases-to-calendar.js` (Layer 2)
- `calendar-to-notion-summaries.js` (Layer 3)

#### Services

```
{IntegrationName}Service.js
```

Examples: `OuraService.js`, `StravaService.js`, `GitHubService.js`

#### Databases

```
{Purpose}Database.js
```

Examples: `IntegrationDatabase.js`, `NotionDatabase.js`, `SummaryDatabase.js`

### Variable Naming

#### camelCase for Variables and Functions

```javascript
const sleepData = [];
const workoutRecords = [];
function fetchOuraData() {}
function transformToCalendarEvent() {}
```

#### PascalCase for Classes

```javascript
class IntegrationDatabase {}
class OuraService {}
class BaseWorkflow {}
```

#### UPPER_SNAKE_CASE for Constants

```javascript
const API_BASE_URL = "https://api.example.com";
const MAX_RETRIES = 3;
const DEFAULT_BATCH_SIZE = 10;
```

#### Integration IDs (in config)

```javascript
// Use exact integration names as IDs
INTEGRATIONS: {
  oura: { id: "oura", ... },
  strava: { id: "strava", ... },
  githubPersonal: { id: "githubPersonal", ... },
  githubWork: { id: "githubWork", ... },
}
```

#### Calendar IDs (in config)

```javascript
// Use domain names as IDs
CALENDARS: {
  sleep: { id: "sleep", ... },
  workouts: { id: "workouts", ... },
  bodyWeight: { id: "bodyWeight", ... },
}
```

### Property Naming (Notion)

#### Standard Properties

All Notion databases should have these properties:

- **Title** (title): Main identifier
- **Date** (date): Event/record date
- **Unique ID** (text): API-provided unique identifier
- **Calendar Event ID** (text): Google Calendar event ID (if syncing)
- **Calendar Created** (checkbox): Sync status flag (if syncing)

#### Custom Properties

Use descriptive, human-readable names:

```javascript
properties: {
  totalSleep: { name: "Total Sleep", type: "number" },
  sleepScore: { name: "Sleep Score", type: "number" },
  deepSleep: { name: "Deep Sleep", type: "number" },
}
```

---

## File Organization

### Directory Structure

```
src/
├── collectors/          # Layer 1: Fetch from APIs
│   ├── collect-oura.js
│   ├── collect-strava.js
│   └── index.js         # Auto-discovery registry
│
├── transformers/        # All layers: Data format conversion
│   ├── oura-to-notion-oura.js                    # Layer 1
│   ├── notion-oura-to-calendar-sleep.js          # Layer 2
│   └── transform-calendar-to-notion-personal-summary.js  # Layer 3
│
├── workflows/           # All layers: Orchestration
│   ├── oura-to-notion-oura.js                    # Layer 1
│   ├── notion-databases-to-calendar.js           # Layer 2
│   └── calendar-to-notion-summaries.js           # Layer 3
│
├── databases/           # Repository pattern
│   ├── NotionDatabase.js         # Base class
│   ├── IntegrationDatabase.js    # Layer 1 (config-driven)
│   └── SummaryDatabase.js         # Layer 3
│
├── services/            # External API clients
│   ├── OuraService.js
│   ├── StravaService.js
│   └── GoogleCalendarService.js
│
├── config/              # Configuration files
│   ├── unified-sources.js        # Main config (CALENDARS, SUMMARY_GROUPS, INTEGRATIONS)
│   ├── notion/
│   │   ├── oura.js
│   │   ├── strava.js
│   │   └── index.js
│   └── calendar/
│       ├── mappings.js
│       └── credentials.js
│
└── utils/               # Shared helpers
    ├── logger.js
    ├── date.js
    └── async.js
```

### Layer Annotations

All files should include a `@layer` annotation in their JSDoc header:

```javascript
/**
 * Description of what this file does
 * @layer 1 - Integration (API-Specific)
 */

/**
 * Description of what this file does
 * @layer 2 - Domain (Source-Agnostic)
 */

/**
 * Description of what this file does
 * @layer 3 Summary (Domain Aggregation)
 */
```

---

## Configuration Reference

### CALENDARS Registry

**Location**: `src/config/unified-sources.js`

```javascript
CALENDARS: {
  [calendarId]: {
    id: string,                    // Unique identifier (matches key)
    name: string,                  // Display name
    emoji: string,                 // Icon for UI
    calendarId: string,            // Google Calendar ID (from env)
    notionSource: string,          // Which INTEGRATION feeds this calendar
    eventConfig: {
      colorId: string,             // Google Calendar color (1-11)
      transparency: string,        // "opaque" or "transparent"
    },
  }
}
```

**Example**:

```javascript
sleep: {
  id: "sleep",
  name: "Sleep",
  emoji: "😴",
  calendarId: process.env.GOOGLE_CALENDAR_SLEEP_ID,
  notionSource: "oura",
  eventConfig: {
    colorId: "5",
    transparency: "opaque",
  },
}
```

### Calendar color mappings

**Location**: `src/config/calendar/color-mappings.js`

When syncing Notion Events and Trips to Google Calendar, event color is set from these mappings. When reading calendar events for summaries/recaps, Personal and Work category is derived from `colorId`.

- **Events**: Color is resolved by **subcategory first**, then **category** fallback. Subcategory map: `EVENTS_SUBCATEGORY_TO_COLOR`. Category map: `EVENTS_TRIPS_CATEGORY_TO_COLOR` (e.g. Interpersonal, Work, Personal).
- **Trips**: Color from **category** only via `EVENTS_TRIPS_CATEGORY_TO_COLOR`.
- **Personal/Work (read path)**: `PERSONAL_COLOR_MAPPING` and `WORK_COLOR_MAPPING` map `colorId` to category for summary/recap flows.

**Google Calendar color IDs** (1–11): 1 Peacock, 2 Sage, 3 Grape, 4 Flamingo, 5 Banana, 6 Tangerine, 7 Lavender, 8 Graphite, 9 Blueberry, 10 Basil, 11 Tomato.

**Events and Trips calendar sync**: Events and Trips databases must have a **Status** (select) property in Notion. Records with Status **🧊 Ice Box**, **↗️ Next Year**, or **🛑 Won't Do** are skipped by `yarn update` (not synced to Google Calendar). The skip list is defined in `src/config/notion/task-categories.js` as `CALENDAR_SKIP_STATUSES`.

### Medications + Supplements config

**Locations**: `src/config/notion/medications.js` and `src/config/notion/supplements.js`

Two sibling DBs synced to two sibling Google Calendars (💊 + 🍬). Medications list and ordering are defined by `MEDICATION_SHORT_NAMES` in `medications.js`; iteration order = title display order. Each med checkbox must have matching entries in `properties` and `fieldMappings`; Notion checkbox column names must match `properties[].name`. The medications DB also carries a free-text `Other` field for ad-hoc meds. Supplements is a single-checkbox DB. See [Internals – Medications and Supplements calendar event format](INTERNALS.md#medications-and-supplements-calendar-event-format) for description/summary behavior.

### SUMMARY_GROUPS Registry

**Location**: `src/config/unified-sources.js`

```javascript
SUMMARY_GROUPS: {
  [groupId]: {
    id: string,                    // Unique identifier
    name: string,                  // Display name
    emoji: string,                 // Icon for UI
    calendars: string[],           // Array of calendar IDs
    notionDatabase: string,        // Notion database ID for recap
    aggregations: {                // Metric calculations
      [metricId]: {
        calendar: string,          // Source calendar
        metric: string,            // Metric name
        aggregation: string,       // "sum" | "average" | "count"
      }
    }
  }
}
```

**Example**:

```javascript
personalRecap: {
  id: "personalRecap",
  name: "Personal Summary",
  emoji: "📊",
  calendars: ["sleep", "workouts", "bodyWeight", "videoGames"],
  notionDatabase: process.env.PERSONAL_WEEK_SUMMARY_DATABASE_ID,
  aggregations: {
    totalWorkoutTime: {
      calendar: "workouts",
      metric: "duration",
      aggregation: "sum",
    },
    avgSleepHours: {
      calendar: "sleep",
      metric: "duration",
      aggregation: "average",
    },
  },
}
```

### INTEGRATIONS Registry

**Location**: `src/config/unified-sources.js`

```javascript
INTEGRATIONS: {
  [integrationId]: {
    id: string,                    // Unique identifier
    name: string,                  // Display name
    emoji: string,                 // Icon for UI
    databaseConfig: {
      dateProperty: string,        // Property name for date
      uniqueIdProperty: string,    // Property name for unique ID
      calendarEventIdProperty: string,    // Property for event ID (hybrid pattern)
      useHybridPattern: boolean,          // Enables fetch-all + update/delete (hybrid)
      calendarCreatedProperty: string,    // Checkbox property (checkbox pattern only)
    },
    apiConfig: {
      baseUrl: string,             // API base URL
      requiresAuth: boolean,       // Whether auth is needed
      authType: string,            // "oauth" | "apiKey"
      rateLimitPerMinute: number,  // Rate limit
    }
  }
}
```

**Example**:

```javascript
oura: {
  id: "oura",
  name: "Oura",
  emoji: "💍",
  databaseConfig: {
    dateProperty: "date",
    uniqueIdProperty: "sleepId",
    calendarCreatedProperty: "Calendar Created",
  },
  apiConfig: {
    baseUrl: "https://api.ouraring.com",
    requiresAuth: true,
    authType: "oauth",
    rateLimitPerMinute: 60,
  },
}
```

### CONTENT_FILTERS

**Location**: `src/config/unified-sources.js`

**Purpose**: Filter words from output columns in `yarn summarize` and `yarn aggregate`.

**Structure**: `CONTENT_FILTERS[command][recapType][columnName] = ["word1", "word2"]`

**Example**:
```javascript
recap: {
  personal: {
    personalPersonalTasks: ["Plan"],  // Filters "Plan" from personal tasks column
  },
}
```

**Behavior**:
- Word-boundary match (e.g., "Plan" won't match "Planning")
- Case-insensitive
- Day headers preserved

### selectDateRange() API

Universal date range selector with context-aware options.

#### Parameters

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minGranularity` | `"day"` \| `"week"` \| `"month"` | `"day"` | Minimum selection unit |
| `allowFuture` | `boolean` | `true` | Allow future dates |

#### Return Value
```javascript
{
  startDate: Date,      // Start of selected range
  endDate: Date,        // End of selected range
  weeks?: Array,        // Week objects (when week/month granularity)
  months?: Array,       // Month objects (when month options selected)
  displayText?: string  // Formatted selection text for display
}
```

#### Month Object Structure
```javascript
{
  month: number,      // 1-12
  year: number,       // e.g., 2025
  weeks: Array,       // Weeks in this month
  startDate: Date,    // First day of month
  endDate: Date       // Last day of month
}
```

#### Usage by Command

| Command | Granularity | Returns |
|---------|-------------|---------|
| `yarn collect` | `"day"` | `{ startDate, endDate }` |
| `yarn update` | `"day"` | `{ startDate, endDate }` |
| `yarn summarize` | `"week"` | `{ weeks, displayText }` |
| `yarn aggregate` | `"month"` | `{ months, displayText }` |

#### Menu Options by Granularity

**day**: Today, Yesterday, Last 30 days, week options, month options, Custom Range
**week**: Week options, month options (no day options)
**month**: This Month, Last Month, Month Picker, Month Range (no day/week options)

---

## API Field Mappings

### Oura Ring API

**API Response** → **Notion Properties**:

| Oura Field             | Notion Property   | Type   | Description                |
| ---------------------- | ----------------- | ------ | -------------------------- |
| `id`                   | Sleep ID          | text   | Unique identifier          |
| `day`                  | Date              | date   | Night of sleep             |
| `score`                | Sleep Score       | number | Overall score (0-100)      |
| `total_sleep_duration` | Total Sleep       | number | Total sleep in seconds     |
| `deep_sleep_duration`  | Deep Sleep        | number | Deep sleep in seconds      |
| `rem_sleep_duration`   | REM Sleep         | number | REM sleep in seconds       |
| `light_sleep_duration` | Light Sleep       | number | Light sleep in seconds     |
| `efficiency`           | Efficiency        | number | Sleep efficiency %         |
| `restless_periods`     | Restless Periods  | number | Number of restless periods |
| `average_heart_rate`   | Avg Heart Rate    | number | Average HR during sleep    |
| `lowest_heart_rate`    | Lowest Heart Rate | number | Lowest HR during sleep     |

### Strava API

**API Response** → **Notion Properties**:

| Strava Field           | Notion Property | Type   | Description            |
| ---------------------- | --------------- | ------ | ---------------------- |
| `id`                   | Activity ID     | text   | Unique identifier      |
| `name`                 | Title           | title  | Activity name          |
| `start_date`           | Date            | date   | Activity start date    |
| `type`                 | Activity Type   | select | Run, Ride, Swim, etc.  |
| `distance`             | Distance        | number | Distance in meters     |
| `moving_time`          | Moving Time     | number | Moving time in seconds |
| `elapsed_time`         | Elapsed Time    | number | Total time in seconds  |
| `total_elevation_gain` | Elevation Gain  | number | Elevation in meters    |
| `average_speed`        | Avg Speed       | number | Speed in m/s           |
| `max_speed`            | Max Speed       | number | Max speed in m/s       |
| `average_heartrate`    | Avg Heart Rate  | number | Average HR             |
| `max_heartrate`        | Max Heart Rate  | number | Max HR                 |
| `calories`             | Calories        | number | Estimated calories     |

### GitHub API

**API Response** → **Notion Properties**:

| GitHub Field      | Notion Property | Type     | Description          |
| ----------------- | --------------- | -------- | -------------------- |
| `number`          | PR Number       | number   | Pull request number  |
| `title`           | Title           | title    | PR title             |
| `created_at`      | Date            | date     | Creation date        |
| `state`           | State           | select   | open, closed, merged |
| `merged`          | Merged          | checkbox | Whether merged       |
| `merged_at`       | Merged At       | date     | Merge date           |
| `additions`       | Lines Added     | number   | Lines added          |
| `deletions`       | Lines Deleted   | number   | Lines deleted        |
| `changed_files`   | Files Changed   | number   | Number of files      |
| `comments`        | Comments        | number   | Number of comments   |
| `review_comments` | Review Comments | number   | Review comments      |
| `html_url`        | URL             | url      | PR URL               |

### Withings API

**API Response** → **Notion Properties**:

| Withings Field    | Notion Property | Type   | Description       |
| ----------------- | --------------- | ------ | ----------------- |
| `date`            | Date            | date   | Measurement date  |
| `weight`          | Weight          | number | Weight in kg      |
| `fat_mass_weight` | Fat Mass        | number | Fat mass in kg    |
| `muscle_mass`     | Muscle Mass     | number | Muscle mass in kg |
| `bone_mass`       | Bone Mass       | number | Bone mass in kg   |
| `hydration`       | Hydration       | number | Hydration %       |

### Steam API

**API Response** → **Notion Properties**:

| Steam Field        | Notion Property | Type   | Description                 |
| ------------------ | --------------- | ------ | --------------------------- |
| `appid`            | Game ID         | text   | Unique game identifier      |
| `name`             | Title           | title  | Game name                   |
| `playtime_forever` | Total Playtime  | number | All-time playtime (minutes) |
| `playtime_recent`  | Recent Playtime | number | Last 2 weeks (minutes)      |

---

## Environment Variables

### Required Variables

```bash
# Notion
NOTION_API_KEY=secret_xxxxx
NOTION_OURA_DATABASE_ID=xxxxx
NOTION_STRAVA_DATABASE_ID=xxxxx
NOTION_PERSONAL_PRS_DATABASE_ID=xxxxx
NOTION_WORK_PRS_DATABASE_ID=xxxxx
NOTION_STEAM_DATABASE_ID=xxxxx
NOTION_WITHINGS_DATABASE_ID=xxxxx
PERSONAL_WEEK_SUMMARY_DATABASE_ID=xxxxx
WORK_WEEK_SUMMARY__DATABASE_ID=xxxxx
PERSONAL_MONTHLY_RECAP_DATABASE_ID=xxxxx
WORK_MONTHLY_RECAP_DATABASE_ID=xxxxx

# Google Calendar
GOOGLE_CALENDAR_SLEEP_ID=xxxxx@group.calendar.google.com
GOOGLE_CALENDAR_WORKOUTS_ID=xxxxx@group.calendar.google.com
GOOGLE_CALENDAR_BODY_WEIGHT_ID=xxxxx@group.calendar.google.com
GOOGLE_CALENDAR_PRS_ID=xxxxx@group.calendar.google.com
GOOGLE_CALENDAR_VIDEO_GAMES_ID=xxxxx@group.calendar.google.com

# Oura Ring
OURA_ACCESS_TOKEN=xxxxx
OURA_REFRESH_TOKEN=xxxxx

# Strava
STRAVA_CLIENT_ID=xxxxx
STRAVA_CLIENT_SECRET=xxxxx
STRAVA_ACCESS_TOKEN=xxxxx
STRAVA_REFRESH_TOKEN=xxxxx

# GitHub
GITHUB_TOKEN=ghp_xxxxx

# Steam
STEAM_API_KEY=xxxxx
STEAM_USER_ID=xxxxx

# Withings
WITHINGS_CLIENT_ID=xxxxx
WITHINGS_CLIENT_SECRET=xxxxx
WITHINGS_ACCESS_TOKEN=xxxxx
WITHINGS_REFRESH_TOKEN=xxxxx

# OpenAI (for summaries)
OPENAI_API_KEY=sk-xxxxx
```

### Optional Variables

```bash
# Logging
LOG_LEVEL=info  # debug, info, warn, error

# Rate Limiting
NOTION_RATE_LIMIT=3  # Requests per second
OURA_RATE_LIMIT=60   # Requests per minute

# Testing
DRY_RUN=false  # Set to true for testing without creating records
```

---

## Command Reference

### Data Pipeline (automated 9x/day)

Full pipeline runs automatically via launchd: `tokens:refresh → collect → update → summarize → aggregate → pull → vault-sync` (`push` is manual only — see below)

| Command | Purpose | Interactive |
|---------|---------|-------------|
| `yarn collect` | Fetch from external APIs → Notion | Yes (`--auto` for non-interactive) |
| `yarn update` | Sync Notion → Google Calendar | Yes (`--auto` for non-interactive) |
| `yarn summarize` | Generate weekly summaries from calendar data | Yes (`--auto` for non-interactive) |
| `yarn aggregate` | Aggregate weekly summaries into monthly recaps | Yes (`--auto` for non-interactive) |
| `yarn push` | Push local JSON edits → Notion (delta-only) | Yes (`--auto` for non-interactive) |
| `yarn pull` | Pull Notion + Calendar → `data/*.json` | Yes (`--auto` for non-interactive) |
| `yarn vault-sync` | Sync data to Brickocampus vault (diff-only) | Yes (`--auto` for non-interactive) |

### Year Generation

| Command | Purpose | Interactive |
|---------|---------|-------------|
| `yarn generate` | Generate yearly config | Yes |

### Imports

| Command | Purpose | Interactive |
|---------|---------|-------------|
| `yarn journal:import` | Import 5 Minute Journal export → `data/journal.json` | No |
| `yarn nyc:import` | One-time CSV → Notion import for NYC databases | Yes |

### Viewers

| Command | Purpose | Interactive |
|---------|---------|-------------|
| `yarn view` | Open plan HTML viewer (localhost:8787) | No |
| `yarn nyc` | Open NYC guide viewer (localhost:8787/nyc/) | No |

### Utilities

| Command | Purpose | Interactive |
|---------|---------|-------------|
| `yarn plan` | Parse yarn plan data | No |
| `yarn logs` | View today's automation log | No |
| `yarn tokens` | Check all token status, refresh expired OAuth | Yes |
| `yarn tokens:setup` | Run OAuth setup wizard | Yes |
| `yarn tokens:check` | Verify API credentials | No |
| `yarn tokens:refresh` | Refresh expired tokens | No |
| `yarn verify:config` | Verify config derivation consistency | No |

### Claude Code Skills

Reflection/planning skills (`/retro-week`, `/plan-*`, `/recap-month`) live in the Brickocampus vault at `~/projects/brickocampus/.claude/skills/`. Launch Claude Code from the vault to use them. Skills follow the pull/push cycle: `yarn pull` → run skill → `yarn push`.

### Local Data Files

| File | Contents | Scope |
|------|----------|-------|
| `data/plan.json` | Weeks, Months, Rocks, Events, Trips | All |
| `data/collected.json` | Oura, Strava, GitHub, Steam, Withings | All (30-day rolling refresh) |
| `data/summaries.json` | Weekly summaries, Monthly recaps | All |
| `data/calendar.json` | All Google Calendar events | All (30-day rolling refresh) |
| `data/nyc.json` | Museums, Restaurants, Tattoos, Venues | All |
| `data/retro.json` | Personal & Work Week Retros | All |
| `data/life.json` | Goals, Themes, Relationships, Tasks, Habits, Monthly Plans, Personal Projects | All |
| `data/journal.json` | 5 Minute Journal entries | 2026 |

---

## Next Steps

- **Need implementation help?** See [GUIDES.md](GUIDES.md)
- **Want to understand patterns?** See [INTERNALS.md](INTERNALS.md)
- **Architecture questions?** See [ARCHITECTURE.md](ARCHITECTURE.md)
