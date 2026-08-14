# Brickomations Architecture

**For developers and contributors**

> **Quick Links**: [Quickstart](../QUICKSTART.md) · [README](../README.md) · [Extension Guides](GUIDES.md) · [Reference](REFERENCE.md) · [Design Patterns](INTERNALS.md)

## Documentation Navigation

**You are here:** `docs/ARCHITECTURE.md` - Core architecture and design principles

**Other docs:**

- **[../QUICKSTART.md](../QUICKSTART.md)** - 5-minute overview (start here if new)
- **[../README.md](../README.md)** - Installation and setup
- **[GUIDES.md](GUIDES.md)** - How to extend the system
- **[REFERENCE.md](REFERENCE.md)** - Naming conventions and quick reference
- **[INTERNALS.md](INTERNALS.md)** - Design patterns and best practices

## Overview

Brickomations is a config-driven data pipeline with a layered architecture that transforms personal data from external APIs into structured insights.

### Core Philosophy

1. **Config-Driven**: Add features by editing config, not writing code
2. **Layered Architecture**: Clear separation between integration, domain, and aggregation layers
3. **Repository Pattern**: Generic database classes driven by configuration
4. **DRY Principles**: Shared base classes and utilities minimize duplication

### System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Layer                              │
│  (User interaction, prompts, display results)               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Workflow Layer                            │
│  (Orchestration, batch processing, error handling)          │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────────────────┐                 ┌────────────────────┐
│  Collector Layer  │                 │ Database Layer     │
│  (Fetch from APIs)│                 │ (Notion access)    │
└───────────────────┘                 └────────────────────┘
        │                                       │
        └───────────────────┬───────────────────┘
                            ↓
                   ┌────────────────────┐
                   │ Transformer Layer  │
                   │ (Format conversion)│
                   └────────────────────┘
                            ↓
                   ┌────────────────────┐
                   │  Service Layer     │
                   │  (API clients)     │
                   └────────────────────┘
                            ↓
                   ┌────────────────────┐
                   │  External APIs     │
                   │  (Oura, Strava,    │
                   │   GitHub, etc.)    │
                   └────────────────────┘
```

## Three-Layer Data Flow

The most important architectural concept is the **three-layer data flow** where domain abstraction happens at specific boundaries.

### Layer 1: API → Notion (Integration Names)

**Purpose**: Collect and persist raw API data in Notion databases

- Uses **integration names**: `oura`, `strava`, `githubPersonal`, `githubWork`, `withings`, `steam`
- Each integration = one Notion database
- No domain abstraction yet
- Files: `collect-*.js`, `*-to-notion-*.js`, `IntegrationDatabase.js`

```
Oura API → collect-oura.js → oura-to-notion-oura.js → Notion (Oura database)
Strava API → collect-strava.js → strava-to-notion-strava.js → Notion (Strava database)
```

**Key Principle**: ❌ Never use domain names (`sleep`, `workouts`) in Layer 1. Always use integration names (`oura`, `strava`).

### Layer 2: Notion → Calendar (Domain Abstraction)

**Purpose**: Transform integration-specific data into domain-abstracted calendar events

- Uses **domain names**: `sleep`, `workouts`, `bodyWeight`, `prs`, `videoGames`
- This is where abstraction happens: `oura` → `sleep`, `strava` → `workouts`
- Multiple integrations can feed one domain (future: Oura + Apple Health → Sleep)
- Files: `notion-*-to-calendar-*.js`, `notion-databases-to-calendar.js`

```
Notion (Oura database) → notion-oura-to-calendar-sleep.js → Google Calendar (Sleep calendar)
Notion (Strava database) → notion-strava-to-calendar-workouts.js → Google Calendar (Workouts calendar)
```

**Key Principle**: ✅ Always use domain names in Layer 2. Google Calendar is the source of truth for domain abstractions.

### Layer 3: Calendar → Summary (Aggregation)

**Purpose**: Aggregate calendar events into weekly summaries and insights

- Combines multiple calendars into summary groups
- Generates AI-powered insights
- Creates Personal Summary and Work Summary pages in Notion
- Files: `calendar-to-notion-summaries.js`, `notion-tasks-to-notion-summaries.js`

```
Google Calendar (all domains) → summarize-calendar.js → Notion (Personal Summary / Work Summary)
```

**Key Principle**: Uses domain names from calendars to create aggregated insights.

## Configuration Architecture

Everything is driven by three registries in `src/config/unified-sources.js`:

### 1. CALENDARS Registry

Defines atomic time-tracking units (each = one Google Calendar):

```javascript
CALENDARS: {
  sleep: {
    id: "sleep",
    name: "Sleep",
    emoji: "😴",
    calendarId: process.env.GOOGLE_CALENDAR_SLEEP_ID,
    notionSource: "oura",  // Which integration feeds this
    // ... config details
  },
  // ... more calendars
}
```

Calendar definitions can include filter properties:

- `ignoreAllDayEvents`: Filter out all-day events when fetching (used by sleep calendars)
- `ignoreDeclinedEvents`: Filter out declined events (used by personal/work calendars)
- `excludeKeywords`: Array of keywords to filter events by summary text

````

### 2. SUMMARY_GROUPS Registry

Defines how calendars combine for reporting:

```javascript
SUMMARY_GROUPS: {
  personalRecap: {
    id: "personalRecap",
    name: "Personal Summary",
    calendars: ["sleep", "workouts", "bodyWeight", "videoGames"],
    // ... aggregation logic
  },
  // ... more groups
}
````

### 3. INTEGRATIONS Registry

Defines API → Notion routing and metadata:

```javascript
INTEGRATIONS: {
  oura: {
    id: "oura",
    name: "Oura",
    emoji: "💍",
    databaseConfig: {
      dateProperty: "date",
      uniqueIdProperty: "sleepId",
      calendarEventIdProperty: "Calendar Event ID",
      // ... database behavior
    },
    // ... API config
  },
  // ... more integrations
}
```

**Adding a new feature?** Edit the config. No code changes needed in most cases.

### Calendar Sync Patterns

Brickomations supports different sync patterns based on data characteristics:

| Pattern        | Properties                                              | Behavior                     | Use For                        |
| -------------- | ------------------------------------------------------- | ---------------------------- | ------------------------------ |
| **Checkbox**   | `calendarCreatedProperty` only                          | One-way, create-only         | API-sourced data (append-only) |
| **Event ID**   | `calendarEventIdProperty` (+ optional `cleanupOrphans`) | One-way create + orphan sweep | User-managed data, no edits   |
| **Hybrid**     | `calendarEventIdProperty` + `useHybridPattern: true`    | Bidirectional, update/delete | User-managed data with edits   |

#### Checkbox Pattern (One-Way Sync)

Used by: oura, strava, githubPersonal, githubWork, steam, withings, bloodPressure

- Tracks sync status with boolean checkbox
- Creates calendar events, never updates or deletes
- Appropriate for API data that doesn't change after creation

```javascript
databaseConfig: {
  dateProperty: "date",
  calendarCreatedProperty: "calendarCreated",
}
```

#### Event ID Pattern (One-Way Create + Orphan Cleanup)

Used by: medications, supplements

- Stores Google Calendar event ID as sync state (no checkbox)
- Creates calendar events, never updates
- With `cleanupOrphans: true`, deletes calendar events whose ID isn't in Notion — safe because the user only ever writes to the DB, never directly to the calendar
- Appropriate when records may be removed from Notion and you want the calendar to follow

```javascript
databaseConfig: {
  dateProperty: "date",
  calendarEventIdProperty: "Calendar Event ID",
  cleanupOrphans: true,
}
```

#### Hybrid Pattern (Bidirectional Sync)

Used by: events, trips

- Stores Google Calendar event ID + tracks sync status
- Can update existing calendar events when Notion records change
- Can delete orphaned calendar events when Notion records are deleted (`cleanupOrphans: true`)
- Records with Status **🧊 Ice Box**, **↗️ Next Year**, or **🛑 Won't Do** are skipped (not synced); see `CALENDAR_SKIP_STATUSES` in `src/config/notion/task-categories.js`
- Appropriate for manually managed data that users edit/delete

```javascript
databaseConfig: {
  dateProperty: "Date",
  calendarEventIdProperty: "Calendar Event ID",
  useHybridPattern: true,
  cleanupOrphans: true,
}
```

**Principle**: Use the simplest pattern that meets requirements. Don't add event ID tracking unless you need orphan cleanup or update/delete sync.

### 4. Monthly Recap Configuration

Defines how weekly summaries are aggregated into monthly recap categories. Monthly recaps are split into separate Personal and Work databases, each with their own property schemas.

**Property Generators**:

```javascript
// Personal monthly recap properties (title + personal fields only)
function generatePersonalMonthlyRecapProperties() {
  const props = {
    title: { name: "Month Recap", type: "title", enabled: true },
  };
  // Personal block and task properties...
  return props;
}

// Work monthly recap properties (title + work fields only)
function generateWorkMonthlyRecapProperties() {
  const props = {
    title: { name: "Month Recap", type: "title", enabled: true },
  };
  // Work block and task properties...
  return props;
}
```

**Category Configuration**:

```javascript
// How block fields are grouped into monthly recap categories
MONTHLY_RECAP_CATEGORIES: {
  personal: {
    blocks: {
      family: ["familyBlocks"],
      relationship: ["relationshipBlocks"],
      interpersonal: ["interpersonalBlocks"],
      hobbies: ["readingBlocks", "meditationBlocks", "artBlocks", "codingBlocks", "musicBlocks", "videoGamesBlocks"],
    },
    tasks: {
      personal: ["personalTaskDetails"],
      home: ["homeTaskDetails"],
      physicalHealth: ["physicalHealthTaskDetails"],
      mentalHealth: ["mentalHealthTaskDetails"],
    },
  },
  work: {
    blocks: {
      meetings: ["meetingsBlocks"],
      social: ["personalAndSocialBlocks"],
    },
    tasks: {
      design: ["designTaskDetails"],
      research: ["researchTaskDetails"],
      admin: ["adminTaskDetails"],
      coding: ["codingTaskDetails"],
      qa: ["qaTaskDetails"],
    },
  },
}
```

**CLI Usage**:

The `yarn aggregate` command now includes type selection:

- "All (Personal + Work)" - Processes both recap types
- "Personal only" - Processes only personal recap
- "Work only" - Processes only work recap

Each recap type updates its own Notion database independently.

### CONTENT_FILTERS

Filters specific words from output columns using word-boundary matching (case-insensitive).

```javascript
CONTENT_FILTERS: {
  summarize: {  // yarn summarize: calendar events → weekly summary
    personal: { columnName: ["word1", "word2"] },
    work: { columnName: ["word1"] },
  },
  recap: {  // yarn aggregate: weekly summaries → monthly recap (config key kept as "recap" since it describes the destination)
    personal: { columnName: ["word1"] },
    work: { columnName: ["word1"] },
  },
}
```

Keys are column names (e.g., `workoutBlocks`, `personalFamilyBlocks`, `workCodingTasks`).

**Relationship**: Category groupings in `MONTHLY_RECAP_CATEGORIES` define how weekly block fields are combined into monthly recap properties. `MONTHLY_RECAP_TASK_PROPERTIES` defines how work task fields are grouped (personal tasks remain in a single `tasksDetails` field). `CONTENT_FILTERS` defines words to filter out from specific output columns using word-boundary matching (case-insensitive) for both `yarn summarize` and `yarn aggregate` commands.

**Helper Functions**:

- `getBlocksFields(recapType)` - Returns all block field names (flattened categories minus exclusions)
- `getTaskCompletionFields(recapType)` - Returns task completion field names derived from CALENDARS config

## Module Responsibilities

### CLI Layer (`cli/`)

- User interaction and prompts
- Display formatted results
- **Spinners for async feedback** (Output at Edges principle)
- Entry points: `collect-data.js`, `update-calendar.js`, `summarize-week.js`, `aggregate-month.js`

**Pattern:** CLI files own all console output. Data layer returns structured results.

```javascript
// CLI file pattern
const spinner = createSpinner("Processing...");
spinner.start();
const result = await workflow(); // Workflow returns data, no output
spinner.stop();
console.log(`✅ ${result.count} items processed`);
```

### Workflow Layer (`src/workflows/`)

- Orchestrates multi-step operations
- Batch processing with `BaseWorkflow`
- Rate limiting and error handling
- Pattern: `{source}-to-{destination}.js`

### Collector Layer (`src/collectors/`)

- Fetches data from external APIs
- Applies business logic (date extraction, filtering)
- Returns structured arrays
- Auto-registered via `collectors/index.js`

### Database Layer (`src/databases/`)

- **IntegrationDatabase**: Generic class for all integrations (config-driven)
- **NotionDatabase**: Base class with CRUD operations
- **SummaryDatabase**: Handles summary-specific logic
- Repository pattern: domain-specific queries

### Transformer Layer (`src/transformers/`)

- Converts between data formats
- Maps API fields → Notion properties
- Maps Notion properties → Calendar events
- Pure functions: input → output

### Service Layer (`src/services/`)

- Thin wrappers around external APIs
- Handles authentication, retries, rate limits
- Examples: `OuraService`, `StravaService`, `GitHubService`

### Utility Layer (`src/utils/`)

- Shared helper functions
- Date handling, formatting, logging
- No business logic

## Relationship Matching System

The system categorizes interpersonal calendar events into "family", "relationship", or "interpersonal" based on Notion database relationships.

### Database Chain

The relationship matching relies on a three-database chain in Notion:

1. **Relationships Database** (`src/config/notion/relationships.js`)

   - Contains relationship records with `Name`, `Nicknames`, and `Weeks` (relation) properties
   - The `Weeks` relation property links to pages in the Weeks database

2. **Weeks Database** (`src/config/notion/weeks.js`)

   - Contains week pages with a `Week` title property (e.g., "Week 38")
   - These are standalone week records used for tracking active weeks per relationship

3. **Personal Summary Database** (`src/config/notion/personal-summary.js`)
   - Contains weekly summary pages with a `Week Summary` title property (e.g., "Week 38 Personal Summary")
   - Note: This is a different database from Weeks, with a different title property name

### Matching Flow

When `yarn summarize` runs for personal summaries:

1. **Load Relationships** (`src/workflows/calendar-to-notion-summaries.js`):

   - Fetches all relationships from the Relationships database
   - For each relationship, extracts linked Week page IDs from the "Weeks" relation property
   - Fetches each linked Week page from the Weeks database
   - Extracts week numbers from the "Week" title property (using regex `/Week (\d+)/i`)
   - Builds `activeWeekNumbers` array for each relationship

2. **Categorize Events** (`src/parsers/interpersonal-matcher.js`):
   - For each interpersonal calendar event (colorId = "3"):
     - First checks family keywords (returns "family" if matched)
     - Then checks relationships:
       - Tests if event summary contains relationship name or nickname (word-boundary matching)
       - Checks if `currentWeekNumber` is in the relationship's `activeWeekNumbers` array
       - If both match → returns "relationship"
     - Otherwise returns "interpersonal" (default)

### Configuration Files

- `src/config/notion/relationships.js` - Relationships database configuration
- `src/config/notion/weeks.js` Weeks database configuration (title property = "Week")
- The matching logic: `src/parsers/interpersonal-matcher.js`

### Common Issues

- **Empty activeWeekNumbers**: Check that `weeks.js` config uses the correct title property name ("Week", not "Week Summary")
- **No relationship matches**: Ensure relationships are linked to Week pages in Notion
- **Property name mismatch**: The Weeks database uses "Week" while Personal Summary uses "Week Summary" - these are different databases with different schemas

## Key Design Patterns

### Config-Driven Repositories

`IntegrationDatabase` uses config to handle all integrations:

```javascript
// One class, all integrations
const ouraDb = new IntegrationDatabase("oura");
const stravaDb = new IntegrationDatabase("strava");

// Behavior driven by INTEGRATIONS registry
await ouraDb.findByUniqueId("sleep_123"); // Uses oura.databaseConfig
await stravaDb.findByUniqueId("activity_456"); // Uses strava.databaseConfig
```

### Auto-Discovery Registries

Collectors and updaters auto-register based on config:

```javascript
// collectors/index.js - No manual registration needed!
const collectors = autoDiscoverCollectors(); // Uses INTEGRATIONS config
collectors.oura.fetch(startDate, endDate); // Auto-wired
```

### Generic Workflows

`BaseWorkflow` provides reusable batch processing:

```javascript
class MyWorkflow extends BaseWorkflow {
  async processBatch(items) {
    // Your logic here
  }
}
// Automatic: progress tracking, rate limiting, error handling
```

### Declarative Calendar Mapping

Calendar routing via config, not code:

```javascript
// config/calendar/mappings.js
sleep: {
  type: 'direct',
  sourceDatabase: 'oura',
  calendarId: process.env.GOOGLE_CALENDAR_SLEEP_ID
}
// No code needed to wire this up!
```

### Workflow Output Architecture

**Principle: "Output at the Edges"** - Formatting happens at CLI boundaries, not in workflows.

Workflows return structured result objects that contain data, not formatted strings:

```javascript
// Workflow returns structured data
{
  weekNumber: 42,
  year: 2024,
  data: {
    summary: { workoutDays: 5, sleepHours: 56.5, ... },
    relationshipsLoaded: 12,
    ...
  },
  errors: ["Warning: Missing calendar data"],
  selectedCalendars: ["sleep", "workouts"],
  ...
}
```

**CLI layer owns all output formatting** via `src/utils/workflow-output.js`:

- `formatCalendarSummaryResult()` - Formats calendar workflow results
- `formatTaskSummaryResult()` - Formats task workflow results
- `formatMonthlyRecapResult()` - Formats monthly recap results
- `buildSuccessData()` - Builds success message lines from summary data
- `formatErrors()` - Formats error/warning arrays

Each formatter converts workflow result objects into display-ready data structures with:

- `header` - Display header text
- `successLines` - Array of formatted success message lines
- `warnings` - Array of formatted warning messages
- `stats` - Statistics object for display

**Benefits**:

- Workflows are testable (return data, not side effects)
- Output formatting is centralized and reusable
- CLI can format the same workflow results differently for different contexts
- Workflows remain pure and don't depend on CLI utilities

## Architecture Status

### ✅ All Layer Violations Fixed

- ✅ All database classes use integration names (Layer 1)
- ✅ Config correctly separates integration vs. domain names
- ✅ Generic `IntegrationDatabase` replaces individual database classes
- ✅ Calendar transformers properly abstract to domain names (Layer 2)

**The architecture is clean and adheres to the three-layer principles.**

## Data Flow Examples

### Example 1: Collecting Oura Sleep Data

**User Action**: `yarn collect` → Select "Yesterday" → Select "Oura"

**Flow**:

1. CLI prompts for date range and source
2. Collector (`collect-oura.js`) fetches from Oura API
3. Transformer (`oura-to-notion-oura.js`) maps to Notion format
4. Workflow checks for duplicates via `IntegrationDatabase("oura")`
5. New records created in Notion Oura database

### Example 2: Syncing Sleep to Calendar

**User Action**: `yarn update` → Select date range → Select "Sleep"

**Flow**:

1. CLI prompts for parameters
2. Workflow queries Notion Oura database for unsynced records
3. Transformer (`notion-oura-to-calendar-sleep.js`) converts to calendar events
4. Calendar service creates events in Sleep calendar
5. Records marked as synced in Notion

### Example 3: Generating Weekly Summary

**User Action**: `yarn summarize`

**Flow**:

1. Fetch all calendar events for the week
2. Group by domain (sleep, workouts, etc.)
3. Calculate aggregated metrics
4. Generate AI summaries via OpenAI
5. Create/update Personal Summary page in Notion

## Local-First Data Layer

### Pull/Push Architecture

Brickomations follows a local-first pattern: all Notion data is pulled to local JSON files, and edits are pushed back with delta detection.

```
┌──────────────┐    yarn pull     ┌──────────────┐    yarn push     ┌──────────────┐
│              │ ───────────────→ │              │ ───────────────→ │              │
│    Notion    │                  │ data/*.json  │                  │    Notion    │
│  (+ Google   │ ←─── automation  │  (local)     │  delta-only ──→ │  (updated)   │
│   Calendar)  │     runs pull    │              │  (MD5 hashes)   │              │
└──────────────┘                  └──────────────┘                  └──────────────┘
                                        ↑
                                  Claude Code reads
                                  and edits locally
```

**Why local-first?**
- Claude Code can read/analyze data without API calls
- Edits are batched and only changed records are pushed (MD5 hash comparison)
- Vault skills (`/retro-week`, `/plan-*`, `/recap-month`) operate on local files

**Local data files:**

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

### Automation

Runs 9x/day via launchd (`infra/launchd/com.brickomations.daily.plist`):

```
tokens:refresh → collect → update → summarize → aggregate → pull → vault-sync
```

**Schedule:** every 2 hours, 7 AM–11 PM (7, 9, 11 AM, 1, 3, 5, 7, 9, 11 PM)

**Resilience:**
- **3-minute default per-step timeout** (pull: 8-min) — healthy steps complete in 30–110s; if a step hasn't finished in 3 min, Notion/API is likely down. Fail fast and let the next run catch up. Pull gets extra time for first-run task content fetching (delta detection makes subsequent runs fast).
- **15-minute wall-clock cap on the full pipeline** — `cli/sync.js` SIGTERM/SIGKILL after 15 min, regardless of where it's stuck. Required because the launchd job wraps in `caffeinate`, so an unbounded pipeline would hold the mini awake forever.
- **Bail on token refresh failure** — `tokens:refresh` is the first step and hits OAuth endpoints. If it fails, network or APIs are unreachable, so the pipeline skips all remaining steps immediately.
- **Caffeinate wakelock** — each run is wrapped in `caffeinate -i` (via `scripts/run-with-wakelock.sh`), so the mini stays awake for the script's lifetime. Idle sleep resumes when the script exits.
- **Lock file** (`local/sync.lock`) prevents concurrent runs. Stale locks are auto-cleaned.

macOS banner notifications on success/failure. Logs: `local/logs/daily-YYYY-MM-DD.log` (30-day retention).

## Interaction Patterns

Brickomations has four interaction patterns:

### 1. CLI Commands
Interactive commands for data pipeline operations (`yarn collect`, `yarn update`, `yarn summarize`, etc.).

### 2. Automation
Non-interactive launchd automation running `tokens:refresh → collect → update → summarize → aggregate → pull → vault-sync` 9x/day with `--auto` flag. Fails fast on transient errors (3-min default step timeout, bail on token refresh failure, 15-min wall-clock cap on the full pipeline).

### 3. Vault Skills
Reflection/planning slash commands (`/retro-week`, `/plan-*`, `/recap-month`) live in the Brickocampus vault, not in brickomations. They read/edit `data/*.json` and push back via `yarn push` — brickomations is the plumbing, the vault hosts the user-facing skills.

### 4. HTML Viewers
Static viewers for plan data (`yarn view`) and NYC guides (`yarn nyc`).

## Extension Points

**Want to add a new integration?** See [GUIDES.md](GUIDES.md#adding-a-new-integration)

**Need to understand naming conventions?** See [REFERENCE.md](REFERENCE.md#naming-conventions)

**Want to understand design patterns?** See [INTERNALS.md](INTERNALS.md)

## Next Steps

- **New to the codebase?** Start with [../QUICKSTART.md](../QUICKSTART.md)
- **Setting up locally?** See [../README.md](../README.md)
- **Adding features?** See [GUIDES.md](GUIDES.md)
- **Looking up conventions?** See [REFERENCE.md](REFERENCE.md)
- **Understanding internals?** See [INTERNALS.md](INTERNALS.md)
