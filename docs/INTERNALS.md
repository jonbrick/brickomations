# Brickomations Internals

**Design patterns, code quality principles, and performance considerations**

> **Quick Links**: [Quickstart](../QUICKSTART.md) · [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Guides](GUIDES.md) · [Reference](REFERENCE.md)

## Documentation Navigation

**You are here:** `docs/INTERNALS.md` - Design patterns and best practices

**Other docs:**

- **[../QUICKSTART.md](../QUICKSTART.md)** - 5-minute overview
- **[../README.md](../README.md)** - Installation and setup
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Core architecture and design principles
- **[GUIDES.md](GUIDES.md)** - Step-by-step how-to guides
- **[REFERENCE.md](REFERENCE.md)** - Naming conventions and quick reference

## Table of Contents

- [Design Patterns](#design-patterns)
  - [Medications and Supplements calendar event format](#medications-and-supplements-calendar-event-format)
- [Output at Edges](#output-at-edges)
- [Code Quality & DRY Principles](#code-quality--dry-principles)
- [API Rate Limiting](#api-rate-limiting)
- [Error Handling](#error-handling)
- [Performance Optimization](#performance-optimization)
- [Testing Strategies](#testing-strategies)

## Design Patterns

### Repository Pattern

**Problem**: Direct database access scattered throughout code, making changes difficult.

**Solution**: Centralize data access through repository classes.

#### Generic Integration Database

`IntegrationDatabase` is a config-driven repository that handles all integrations:

```javascript
class IntegrationDatabase extends NotionDatabase {
  constructor(configKey) {
    super();
    this.configKey = configKey;
    this.integration = INTEGRATIONS[configKey];
    this.databaseConfig = this.integration.databaseConfig;
    this.databaseId = config.notion.databases[configKey];
    this.props = config.notion.properties[configKey];
  }

  async findByUniqueId(uniqueId) {
    const propertyKey = this.databaseConfig.uniqueIdProperty;
    const propertyName = this.props[propertyKey]?.name || propertyKey;
    return await this.findPageByProperty(
      this.databaseId,
      propertyName,
      uniqueId
    );
  }

  async getUnsynced(startDate, endDate) {
    // Config-driven query building
    const dateProperty = this.databaseConfig.dateProperty;
    const syncProperty = this.databaseConfig.calendarCreatedProperty;
    // ... builds filter based on config
  }
}
```

**Benefits**:

- One class handles all integrations
- Add new integration = add config, not code
- Consistent behavior across all integrations
- Easy to test and maintain

#### Usage Pattern

```javascript
// Old way (8 different database classes)
const ouraDb = new OuraDatabase();
const stravaDb = new StravaDatabase();
const githubDb = new GitHubDatabase();
// ... etc

// New way (one class, config-driven)
const ouraDb = new IntegrationDatabase("oura");
const stravaDb = new IntegrationDatabase("strava");
const githubPersonalDb = new IntegrationDatabase("githubPersonal");
const githubWorkDb = new IntegrationDatabase("githubWork");
```

### Template Method Pattern (BaseWorkflow)

**Problem**: Every workflow needs batch processing, progress tracking, error handling, rate limiting.

**Solution**: Extract common logic into base class, let subclasses override specific steps.

```javascript
class BaseWorkflow {
  async execute(items) {
    this.logStart(items.length);

    const batches = this.createBatches(items);
    const results = { created: [], skipped: [], errors: [] };

    for (const batch of batches) {
      const batchResults = await this.processBatch(batch);
      this.mergeResults(results, batchResults);
      await this.delayBetweenBatches();
    }

    this.logComplete(results);
    return results;
  }

  // Subclasses override this
  async processBatch(items) {
    throw new Error("Must implement processBatch()");
  }
}
```

**Usage**:

```javascript
class MyWorkflow extends BaseWorkflow {
  async processBatch(items) {
    // Your specific logic here
    return items.map((item) => this.processItem(item));
  }
}
```

### Builder Pattern (buildTransformer)

**Problem**: Calendar transformers have repetitive structure.

**Solution**: Factory function that builds transformers declaratively.

```javascript
function buildTransformer(options) {
  const {
    calendarId,
    sourceIntegration,
    titleTemplate,
    descriptionTemplate,
    extractAdditionalFields,
  } = options;

  return async function transformer(records) {
    const calendar = CALENDARS[calendarId];
    const integration = INTEGRATIONS[sourceIntegration];

    return records.map((record) => ({
      summary: titleTemplate(record),
      description: descriptionTemplate(record),
      start: extractDate(record),
      end: extractDate(record),
      colorId: calendar.eventConfig.colorId,
      ...extractAdditionalFields(record),
    }));
  };
}
```

**Benefits**:

- Declarative transformer creation
- Consistent structure across all transformers
- Easy to test templates in isolation
- Reduces boilerplate from ~80 lines to ~20 lines

### Auto-Discovery Pattern

**Problem**: Every new integration requires manual registration in multiple places.

**Solution**: Automatically discover and register based on config.

#### Collector Auto-Discovery

```javascript
// collectors/index.js
function autoDiscoverCollectors() {
  const collectors = {};

  Object.entries(INTEGRATIONS).forEach(([id, integration]) => {
    // Convention: fetch{IntegrationName}Data
    const moduleName = `./collect-${id}`;
    const fetchFnName = `fetch${idToFunctionName(id)}Data`;

    try {
      const collectorModule = require(moduleName);
      if (collectorModule[fetchFnName]) {
        collectors[id] = {
          fetch: collectorModule[fetchFnName],
          integration,
        };
      }
    } catch (error) {
      // Integration not implemented yet
    }
  });

  return collectors;
}
```

**Benefits**:

- Zero registration code
- Convention over configuration
- Impossible to forget to register
- Automatically available in CLI

### Strategy Pattern (Calendar Mappings)

**Problem**: Different integrations need different calendar routing logic.

**Solution**: Define routing strategies in config.

```javascript
// Direct mapping: one database → one calendar
{
  type: 'direct',
  sourceDatabase: 'medications',
  calendarId: process.env.MEDICATIONS_CALENDAR_ID,
}

// Property-based mapping: route by property value
{
  type: 'property-based',
  sourceDatabase: 'sleep',
  routingProperty: 'Google Calendar',
  mappings: {
    'Normal Wake Up': process.env.NORMAL_WAKE_UP_CALENDAR_ID,
    'Sleep In': process.env.SLEEP_IN_CALENDAR_ID,
  },
}

// Lookup-based mapping: route by lookup table
{
  type: 'lookup',
  sourceDatabase: 'tasks',
  routingProperty: 'Category',
  lookupTable: TASK_CATEGORIES,
  defaultCalendar: process.env.GOOGLE_CALENDAR_DEFAULT_ID,
}
```

### Medications and Supplements calendar event format

**Locations**: `src/config/notion/medications.js` and `src/config/notion/supplements.js`. The two DBs are siblings — each has its own Notion DB, Google Calendar, and transformer. They share the same one-way-from-Notion sync shape (event-ID pattern + orphan cleanup; no `Calendar Created` checkbox).

#### Medications

- **`MEDICATION_SHORT_NAMES`** – Ordered map `{ <propertyKey>: <truncatedName> }`. Iteration order = display order in the calendar event title. Adding or reordering meds: edit this constant **and** add a matching entry in `properties` + `fieldMappings`, then add the matching checkbox column in Notion.
- **`properties.other`** – Free-text rich_text field for ad-hoc meds (NyQuil, Tylenol, etc.) that don't earn a dedicated checkbox.

**Calendar event behavior:**

- **Summary**: `💊 <comma list>` — short names of checked checkboxes (in `MEDICATION_SHORT_NAMES` order) followed by the `Other` text verbatim. Examples: `💊 Gaba, Sertra` / `💊 Gaba, Sertra, Nyquil` / `💊 Tylenol, Mucinex`.
- **Description**: One `✅`/`❌` line per checkbox using the full Notion label, then `Other: <text>` on a new line if `Other` is non-empty.
- **Skip**: No event when `No meds` is checked, the date is missing, or no checkbox is checked and `Other` is empty.

#### Supplements

Single-checkbox DB. Schema: `Date`, `Calendar Event ID`, `Supplements` (checkbox), `No Supps` (checkbox).

**Calendar event behavior:**

- **Summary**: `🍬 Supplements`
- **Description**: `✅ Supplements`
- **Skip**: No event when `No Supps` is checked, `Supplements` is unchecked, or the date is missing.

---

## Output at Edges

**Principle:** Data layer functions return structured data. CLI layer handles all output.

### What This Means

| Layer | Responsibility | Console Output? |
|-------|---------------|-----------------|
| CLI (`cli/`) | User interaction, display results | ✅ Yes |
| Workflows (`src/workflows/`) | Orchestration, return results | ❌ No (DEBUG only) |
| Databases (`src/databases/`) | Data access, return data | ❌ No (DEBUG only) |
| Transformers (`src/transformers/`) | Format conversion, return data | ❌ No (DEBUG only) |
| Services (`src/services/`) | API calls, return data | ❌ No (DEBUG only) |

### Pattern
```javascript
// WRONG - output in data layer
async function fetchData() {
  console.log("Fetching...");  // ❌ No console in data layer
  const data = await api.fetch();
  console.log("Done!");  // ❌ 
  return data;
}

// RIGHT - output at edges (CLI)
async function fetchData() {
  return await api.fetch();  // ✅ Just return data
}

// In CLI file:
const spinner = createSpinner("Fetching...");
spinner.start();
const data = await fetchData();
spinner.stop();
console.log("✅ Done!");  // ✅ Output in CLI
```

### Spinners

CLI files use `createSpinner()` for async operation feedback:
```javascript
const { createSpinner } = require("../src/utils/cli");

let spinner = createSpinner("Fetching data...");
spinner.start();
const result = await fetchData();
spinner.stop();
```

Spinner clears line with ANSI escape code `\r\x1b[2K` for clean output.

---

## Code Quality & DRY Principles

### Config-Driven Architecture

**Principle**: Configuration should drive behavior, not code.

#### ✅ Good: Config-Driven

```javascript
// Config defines everything
INTEGRATIONS: {
  oura: {
    databaseConfig: {
      dateProperty: "date",
      uniqueIdProperty: "sleepId",
    }
  }
}

// Generic code uses config
async findByUniqueId(uniqueId) {
  const property = this.databaseConfig.uniqueIdProperty;
  return await this.findByProperty(property, uniqueId);
}
```

#### ❌ Bad: Hardcoded

```javascript
// Hardcoded for each integration
async findOuraBySleepId(sleepId) {
  return await this.findByProperty("Sleep ID", sleepId);
}

async findStaraByActivityId(activityId) {
  return await this.findByProperty("Activity ID", activityId);
}
```

### Avoiding Code Duplication

#### Before: 8 Nearly Identical Database Classes

Each integration had its own database class with ~60 lines of near-identical code:

```javascript
// OuraDatabase.js - 60 lines
class OuraDatabase extends NotionDatabase {
  async findBySleepId(sleepId) { ... }
  async getUnsynced(startDate, endDate) { ... }
  async markSynced(pageId) { ... }
}

// StravaDatabase.js - 60 lines (almost identical!)
class StravaDatabase extends NotionDatabase {
  async findByActivityId(activityId) { ... }
  async getUnsynced(startDate, endDate) { ... }
  async markSynced(pageId) { ... }
}

// ... 6 more classes with same pattern
```

**Total**: ~480 lines of duplicated code

#### After: One Generic Database Class

```javascript
// IntegrationDatabase.js - 531 lines
class IntegrationDatabase extends NotionDatabase {
  constructor(configKey) {
    // Config-driven behavior
  }

  async findByUniqueId(uniqueId) {
    // Works for all integrations
  }

  async getUnsynced(startDate, endDate) {
    // Works for all integrations
  }

  async markSynced(pageId) {
    // Works for all integrations
  }
}
```

**Total**: 531 lines (includes all integrations + advanced features)

**Reduction**: ~480 lines → 531 lines (but handles 8+ integrations instead of 1)

### Single Source of Truth

**Principle**: Each piece of knowledge should exist in exactly one place.

#### unified-sources.js

All system configuration lives in one file:

```javascript
// CALENDARS: What domains exist
CALENDARS: { sleep: {...}, workouts: {...} }

// SUMMARY_GROUPS: How domains aggregate
SUMMARY_GROUPS: { personalRecap: {...} }

// INTEGRATIONS: What APIs we connect to
INTEGRATIONS: { oura: {...}, strava: {...} }
```

Everything else is **derived** from these three registries:

```javascript
// Automatically derived
const DATA_SOURCES = deriveDataSources();
const PERSONAL_SUMMARY_SOURCES = Object.fromEntries(
  Object.entries(SUMMARY_GROUPS)
    .filter(([_, g]) => g.sourceType === "personal")
    .map(([id, g]) => [id, deriveSummarySource(id, g)])
);
const WORK_SUMMARY_SOURCES = Object.fromEntries(
  Object.entries(SUMMARY_GROUPS)
    .filter(([_, g]) => g.sourceType === "work")
    .map(([id, g]) => [id, deriveSummarySource(id, g)])
);
```

**Benefits**:

- Add a calendar? Edit one place, it propagates everywhere
- No risk of inconsistency
- Easy to understand system at a glance

### Separation of Concerns

Each module has one responsibility:

| Module       | Responsibility    | NOT Responsible For                    |
| ------------ | ----------------- | -------------------------------------- |
| Collectors   | Fetch API data    | Notion formatting, database operations |
| Transformers | Format conversion | API calls, database operations         |
| Databases    | Data persistence  | API calls, business logic              |
| Services     | API communication | Business logic, data transformation    |
| Workflows    | Orchestration     | Low-level API calls, formatting        |

#### ✅ Good: Clear Separation

```javascript
// Collector: just fetch and structure
async function fetchOuraData(startDate, endDate) {
  const service = new OuraService();
  const rawData = await service.fetchSleep(startDate, endDate);
  return rawData.map(extractBusinessData);
}

// Transformer: just format
function transformOuraToNotion(item) {
  return {
    [props.sleepId]: item.sleepId,
    [props.totalSleep]: item.totalSleep,
  };
}

// Workflow: orchestrate
async function syncOuraToNotion(items) {
  for (const item of items) {
    const existing = await db.findByUniqueId(item.sleepId);
    if (!existing) {
      const properties = transformOuraToNotion(item);
      await db.createPage(properties);
    }
  }
}
```

#### ❌ Bad: Mixed Concerns

```javascript
// Everything in one function
async function syncOuraData(startDate, endDate) {
  // API call
  const response = await fetch("https://api.ouraring.com/...");
  const rawData = await response.json();

  // Business logic
  const items = rawData.map(item => ({ ... }));

  // Formatting
  const formatted = items.map(item => ({
    [getPropertyName("Sleep ID")]: item.id,
  }));

  // Database operations
  for (const item of formatted) {
    await notion.pages.create({ ... });
  }
}
```

---

## API Rate Limiting

### Strategy by Service

| Service      | Rate Limit    | Strategy                     |
| ------------ | ------------- | ---------------------------- |
| Notion API   | 3 req/sec     | 330ms delay between requests |
| Oura API     | 5000 req/day  | Batch by date range          |
| Strava API   | 100 req/15min | Respect rate limit headers   |
| GitHub API   | 5000 req/hr   | Use conditional requests     |
| Withings API | Unlimited     | No throttling needed         |

### Implementation Patterns

#### Fixed Delay (Notion)

```javascript
const { delay } = require("../utils/async");

for (const item of items) {
  await db.createPage(properties);
  await delay(330); // ~3 requests/second
}
```

#### Exponential Backoff (Oura, Strava)

```javascript
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        const waitTime = Math.pow(2, i) * 1000;
        await delay(waitTime);
        continue;
      }

      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
    }
  }
}
```

#### Rate Limit Headers (Strava)

```javascript
async function fetchStravaData() {
  const response = await fetch(url, options);

  // Check rate limit headers
  const remaining = response.headers.get("x-ratelimit-remaining");
  const resetTime = response.headers.get("x-ratelimit-reset");

  if (remaining < 10) {
    const waitTime = resetTime * 1000 - Date.now();
    logger.warn(`Approaching rate limit. Waiting ${waitTime}ms`);
    await delay(waitTime);
  }

  return response;
}
```

### Batch Processing

For large datasets, process in batches with delays:

```javascript
class BatchProcessor {
  constructor(batchSize = 10, delayMs = 1000) {
    this.batchSize = batchSize;
    this.delayMs = delayMs;
  }

  async process(items, processFn) {
    const batches = chunk(items, this.batchSize);

    for (const batch of batches) {
      await Promise.all(batch.map(processFn));
      await delay(this.delayMs);
    }
  }
}
```

---

## Error Handling

### Graceful Degradation

**Principle**: Failures should be contained; one error shouldn't crash the entire workflow.

```javascript
async function syncToNotion(items) {
  const results = { created: [], errors: [] };

  for (const item of items) {
    try {
      const page = await db.createPage(item);
      results.created.push(page);
    } catch (error) {
      logger.error(`Error creating item ${item.id}: ${error.message}`);
      results.errors.push({ item, error: error.message });
      // Continue processing other items
    }
  }

  return results;
}
```

### Error Classification

#### Retriable Errors

- Network timeouts
- Rate limit exceeded (429)
- Server errors (500-599)

```javascript
const RETRIABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

async function fetchWithRetry(url, options) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, options);

      if (RETRIABLE_STATUS_CODES.includes(response.status)) {
        if (attempt < 3) {
          await delay(Math.pow(2, attempt) * 1000);
          continue;
        }
      }

      return response;
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(Math.pow(2, attempt) * 1000);
    }
  }
}
```

#### Non-Retriable Errors

- Authentication errors (401, 403)
- Not found (404)
- Validation errors (400, 422)

```javascript
if ([400, 401, 403, 404, 422].includes(response.status)) {
  throw new Error(`Non-retriable error: ${response.statusText}`);
}
```

### Logging Strategy

#### Log Levels

```javascript
logger.debug("Detailed info for debugging");
logger.info("Important milestones");
logger.warn("Recoverable issues");
logger.error("Failures that need attention");
```

#### Structured Logging

```javascript
logger.info("Created page", {
  integration: "oura",
  pageId: page.id,
  uniqueId: item.sleepId,
  timestamp: Date.now(),
});
```

---

## Performance Optimization

### Pagination for Large Datasets

**Problem**: Notion databases can have thousands of records.

**Solution**: Paginate queries to avoid timeouts.

```javascript
async queryDatabaseAll(databaseId, filter) {
  let results = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await this.queryDatabase(databaseId, {
      filter,
      start_cursor: startCursor,
    });

    results = results.concat(response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return results;
}
```

### Caching Strategy

#### Config Caching

Config is loaded once and reused:

```javascript
// Loaded once at module import
const config = require("../config");

// Derived data computed once
const DATA_SOURCES = deriveDataSources();
```

#### API Response Caching

For frequently accessed data:

```javascript
class CachedService {
  constructor(ttl = 3600000) {
    // 1 hour
    this.cache = new Map();
    this.ttl = ttl;
  }

  async fetchWithCache(key, fetchFn) {
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data;
    }

    const data = await fetchFn();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }
}
```

### Parallel Processing

For independent operations:

```javascript
// Sequential (slow)
for (const item of items) {
  await processItem(item);
}

// Parallel (fast)
await Promise.all(items.map((item) => processItem(item)));

// Controlled parallelism (balanced)
async function processBatch(items, concurrency = 5) {
  const batches = chunk(items, concurrency);
  for (const batch of batches) {
    await Promise.all(batch.map(processItem));
  }
}
```

### Database Query Optimization

#### Use Filters, Not Client-Side Filtering

```javascript
// ❌ Bad: Fetch everything, filter in code
const allPages = await db.queryDatabaseAll(databaseId, {});
const filtered = allPages.filter(
  (page) => page.properties.Date.date.start > startDate
);

// ✅ Good: Filter in the database
const filtered = await db.queryDatabaseAll(databaseId, {
  filter: {
    property: "Date",
    date: { on_or_after: startDate },
  },
});
```

#### Use Property Indexes

Notion indexes these property types for fast queries:

- Title
- Rich text
- Number
- Select
- Date

For unique IDs, use text or number properties (both indexed).

---

## Testing Strategies

### Unit Testing Transformers

Transformers are pure functions → easy to test:

```javascript
const { transformOuraToNotion } = require("./oura-to-notion-oura");

test("transforms Oura sleep data correctly", () => {
  const input = {
    sleepId: "test_123",
    totalSleep: 28800,
    score: 85,
  };

  const result = transformOuraToNotion(input);

  expect(result["Sleep ID"]).toBe("test_123");
  expect(result["Total Sleep"]).toBe(28800);
  expect(result["Sleep Score"]).toBe(85);
});
```

### Integration Testing

Test with small date ranges in staging:

```bash
# Test with yesterday's data
yarn collect
# Select "Yesterday"
# Select "Oura"

# Verify:
# 1. No errors in logs
# 2. Records created in Notion
# 3. Duplicates not created on second run
```

### Manual Testing Checklist

Before deploying changes:

- [ ] Collector fetches data without errors
- [ ] Transformer outputs correct format
- [ ] Workflow creates records in Notion
- [ ] Duplicates are detected and skipped
- [ ] Calendar sync creates events
- [ ] Events have correct title, date, description
- [ ] Weekly summary includes new data
- [ ] No rate limit errors

### Debug Mode

Enable detailed logging:

```bash
LOG_LEVEL=debug yarn collect
```

Output includes:

- API request/response details
- Database query filters
- Property mappings
- Transformation results

---

## Next Steps

- **Want to extend the system?** See [GUIDES.md](GUIDES.md)
- **Need naming conventions?** See [REFERENCE.md](REFERENCE.md)
- **Architecture questions?** See [ARCHITECTURE.md](ARCHITECTURE.md)
