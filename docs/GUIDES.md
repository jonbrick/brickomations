# Brickomations Extension Guides

**How-to guides for extending the system**

> **Quick Links**: [Quickstart](../QUICKSTART.md) · [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Reference](REFERENCE.md) · [Internals](INTERNALS.md)

## Documentation Navigation

**You are here:** `docs/GUIDES.md` - Step-by-step how-to guides

**Other docs:**

- **[../QUICKSTART.md](../QUICKSTART.md)** - 5-minute overview
- **[../README.md](../README.md)** - Installation and setup
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Core architecture and design principles
- **[REFERENCE.md](REFERENCE.md)** - Naming conventions and quick reference
- **[INTERNALS.md](INTERNALS.md)** - Design patterns and best practices

## Table of Contents

- [Adding a New Integration](#adding-a-new-integration)
- [Adding a New Calendar](#adding-a-new-calendar)
- [Adding a New Summary Group](#adding-a-new-summary-group)
- [Adding a Calendar to Monthly Recaps](#adding-a-calendar-to-monthly-recaps)
- [Adding a New Monthly Recap Category](#adding-a-new-monthly-recap-category)
- [Adding a Personal Task Category with Content Splitting](#adding-a-personal-task-category-with-content-splitting)
- [Modifying Transformers](#modifying-transformers)
- [Testing Your Changes](#testing-your-changes)

## Adding a New Integration

**Goal**: Connect a new external API (e.g., Apple Health, Spotify, RescueTime) to collect data into Notion.

**Time estimate**: 2-4 hours for a simple integration

### Step 1: Add to INTEGRATIONS Registry

**File**: `src/config/unified-sources.js`

Add your integration to the `INTEGRATIONS` object:

```javascript
INTEGRATIONS: {
  // ... existing integrations

  myNewApi: {
    id: "myNewApi",
    name: "My New API",
    emoji: "🎯",

    databaseConfig: {
      // Database behavior config
      dateProperty: "date",                          // Property name for date filtering
      uniqueIdProperty: "itemId",                    // Property name for unique ID
      // Pick ONE calendar sync pattern below — not both:
      calendarCreatedProperty: "Calendar Created",   // Checkbox pattern (one-way)
      // OR:
      // calendarEventIdProperty: "Calendar Event ID",
      // useHybridPattern: true,                     // Hybrid pattern (bidirectional)
    },
```

**Note**: Choose the appropriate calendar sync pattern based on your data:

- **Checkbox pattern** (one-way sync): Set `calendarCreatedProperty` for API-sourced data that doesn't change after creation.
- **Hybrid pattern** (bidirectional sync): Set `calendarEventIdProperty` + `useHybridPattern: true` for user-managed data that may be edited or deleted.

See [Calendar Sync Patterns](ARCHITECTURE.md#calendar-sync-patterns) in ARCHITECTURE.md for details.

    apiConfig: {
      baseUrl: "https://api.mynewapi.com",
      requiresAuth: true,
      authType: "oauth", // or "apiKey"
      rateLimitPerMinute: 60,
    },

},
}

````

### Step 2: Create Environment Variables

**File**: `.env`

```bash
# My New API
MYNEWAPI_CLIENT_ID=your_client_id
MYNEWAPI_CLIENT_SECRET=your_client_secret
MYNEWAPI_ACCESS_TOKEN=your_access_token
MYNEWAPI_REFRESH_TOKEN=your_refresh_token
NOTION_MYNEWAPI_DATABASE_ID=your_notion_database_id
````

### Step 3: Create Notion Config

**File**: `src/config/notion/my-new-api.js`

```javascript
/**
 * Notion configuration for My New API integration
 * @layer 1 - Integration (API-Specific)
 */

module.exports = {
  database: process.env.NOTION_MYNEWAPI_DATABASE_ID,

  properties: {
    title: {
      name: "Title",
      type: "title",
      enabled: true,
    },
    date: {
      name: "Date",
      type: "date",
      enabled: true,
    },
    itemId: {
      name: "Item ID",
      type: "text",
      enabled: true,
    },
    calendarEventId: {
      name: "Calendar Event ID",
      type: "text",
      enabled: false, // Only needed if syncing to calendar
    },
    calendarCreated: {
      name: "Calendar Created",
      type: "checkbox",
      enabled: false, // Only needed if syncing to calendar
    },
    // ... your custom properties
    customMetric: {
      name: "Custom Metric",
      type: "number",
      enabled: true,
    },
  },

  fieldMappings: {
    title: "title",
    date: "date",
    itemId: "itemId",
    customMetric: "customMetric",
  },
};
```

**Update**: `src/config/notion/index.js`

```javascript
const myNewApi = require("./my-new-api");

module.exports = {
  databases: {
    // ... existing
    myNewApi: myNewApi.database,
  },
  properties: {
    // ... existing
    myNewApi: myNewApi.properties,
  },
  getPropertyName: function (property) {
    return property?.name || property;
  },
};
```

### Step 4: Create Service

**File**: `src/services/MyNewApiService.js`

```javascript
/**
 * Service for interacting with My New API
 * @layer 1 - Integration (API-Specific)
 */

class MyNewApiService {
  constructor() {
    this.accessToken = process.env.MYNEWAPI_ACCESS_TOKEN;
    this.baseUrl = "https://api.mynewapi.com";
  }

  /**
   * Fetch items for date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Array of items
   */
  async fetchItems(startDate, endDate) {
    const url = `${this.baseUrl}/items`;
    const params = new URLSearchParams({
      start_date: startDate.toISOString().split("T")[0],
      end_date: endDate.toISOString().split("T")[0],
    });

    const response = await fetch(`${url}?${params}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.items || [];
  }
}

module.exports = MyNewApiService;
```

### Step 5: Create Collector

**File**: `src/collectors/collect-my-new-api.js`

```javascript
/**
 * Collector for My New API data
 * @layer 1 - Integration (API-Specific)
 */

const MyNewApiService = require("../services/MyNewApiService");
const logger = require("../utils/logger");

/**
 * Fetch items from My New API
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Array>}
 */
async function fetchMyNewApiData(startDate, endDate) {
  try {
    logger.info(`Fetching My New API data from ${startDate} to ${endDate}`);

    const service = new MyNewApiService();
    const items = await service.fetchItems(startDate, endDate);

    // Transform to standard format
    const formatted = items.map((item) => ({
      itemId: item.id,
      title: item.name,
      date: item.timestamp,
      customMetric: item.value,
      // ... more fields
    }));

    logger.info(`Fetched ${formatted.length} items from My New API`);
    return formatted;
  } catch (error) {
    logger.error(`Error fetching My New API data: ${error.message}`);
    throw error;
  }
}

module.exports = {
  fetchMyNewApiData,
};
```

### Step 6: Create Transformer

**File**: `src/transformers/my-new-api-to-notion-my-new-api.js`

```javascript
/**
 * Transform My New API data to Notion format
 * @layer 1 - Integration (API-Specific)
 */

const config = require("../config");

/**
 * Transform item to Notion properties
 * @param {Object} item - Item from API
 * @returns {Object} Notion properties
 */
function transformMyNewApiToNotion(item) {
  const props = config.notion.properties.myNewApi;

  return {
    [config.notion.getPropertyName(props.title)]: item.title,
    [config.notion.getPropertyName(props.date)]: item.date,
    [config.notion.getPropertyName(props.itemId)]: item.itemId,
    [config.notion.getPropertyName(props.customMetric)]: item.customMetric,
  };
}

module.exports = {
  transformMyNewApiToNotion,
};
```

### Step 7: Create Workflow

**File**: `src/workflows/my-new-api-to-notion-my-new-api.js`

```javascript
/**
 * Workflow: Sync My New API data to Notion
 * @layer 1 - Integration (API-Specific)
 */

const IntegrationDatabase = require("../databases/IntegrationDatabase");
const {
  transformMyNewApiToNotion,
} = require("../transformers/my-new-api-to-notion-my-new-api");
const { delay } = require("../utils/async");
const logger = require("../utils/logger");

/**
 * Sync items to Notion
 * @param {Array} items - Items from API
 * @returns {Promise<Object>} Results summary
 */
async function syncMyNewApiToNotion(items) {
  const db = new IntegrationDatabase("myNewApi");
  const results = {
    created: [],
    skipped: [],
    errors: [],
    total: items.length,
  };

  logger.info(`Syncing ${items.length} items to Notion...`);

  for (const item of items) {
    try {
      // Check for existing
      const existing = await db.findByUniqueId(item.itemId);

      if (existing) {
        logger.debug(`Skipping existing item: ${item.itemId}`);
        results.skipped.push({ itemId: item.itemId });
        continue;
      }

      // Transform and create
      const properties = transformMyNewApiToNotion(item);
      const page = await db.createPage(properties);

      logger.info(`Created item: ${item.itemId}`);
      results.created.push({ itemId: item.itemId, pageId: page.id });

      // Rate limiting
      await delay(330); // ~3 requests/second for Notion API
    } catch (error) {
      logger.error(`Error syncing item ${item.itemId}: ${error.message}`);
      results.errors.push({ itemId: item.itemId, error: error.message });
    }
  }

  return results;
}

module.exports = {
  syncMyNewApiToNotion,
};
```

### Step 8: Wire Up Auto-Discovery

**No code changes needed!** The `collectors/index.js` and `updaters/index.js` files automatically discover your integration based on the `INTEGRATIONS` registry.

Just follow the naming convention:

- Collector function: `fetch{IntegrationName}Data` (e.g., `fetchMyNewApiData`)
- Workflow function: `sync{IntegrationName}ToNotion` (e.g., `syncMyNewApiToNotion`)

### Step 9: Test Your Integration

```bash
# Test collecting data
yarn collect
# Select your date range
# Select "My New API"

# Verify data in Notion
# Check your Notion database for new records
```

**That's it!** Your new integration is now fully wired into the system.

---

## Adding a New Calendar

**Goal**: Create a new Google Calendar to track a specific domain (e.g., Meditation, Reading, Cycling).

**Time estimate**: 15-30 minutes

### Step 1: Create Google Calendar

1. Go to Google Calendar
2. Create a new calendar (e.g., "Meditation Tracker")
3. Copy the Calendar ID from settings
4. Add to `.env`: `GOOGLE_CALENDAR_MEDITATION_ID=your_calendar_id`

### Step 2: Add to CALENDARS Registry

**File**: `src/config/unified-sources.js`

```javascript
CALENDARS: {
  // ... existing calendars

  meditation: {
    id: "meditation",
    name: "Meditation",
    emoji: "🧘",
    calendarId: process.env.GOOGLE_CALENDAR_MEDITATION_ID,
    notionSource: "myMeditationApi", // Which integration feeds this
    eventConfig: {
      colorId: "5", // Google Calendar color ID
      transparency: "opaque",
    },
  },
}
```

### Step 3: Add to SUMMARY_GROUPS

**File**: `src/config/unified-sources.js`

Add your calendar to the appropriate summary group:

```javascript
SUMMARY_GROUPS: {
  personalRecap: {
    // ... existing config
    calendars: [
      // ... existing calendars
      "meditation",
    ],
  },
}
```

### Step 4: Create Calendar Transformer

**File**: `src/transformers/notion-my-meditation-api-to-calendar-meditation.js`

```javascript
/**
 * Transform Notion meditation records to Google Calendar events
 * @layer 2 - Domain (Source-Agnostic)
 */

const config = require("../config");
const { buildTransformer } = require("./buildTransformer");

module.exports = buildTransformer({
  calendarId: "meditation",
  sourceIntegration: "myMeditationApi",

  // Event title template
  titleTemplate: (record) => {
    const duration = record.properties.Duration?.number || 0;
    return `Meditation (${duration} min)`;
  },

  // Event description template
  descriptionTemplate: (record) => {
    const type = record.properties.Type?.select?.name || "Unknown";
    return `Type: ${type}`;
  },

  // Additional fields
  extractAdditionalFields: (record) => ({
    duration: record.properties.Duration?.number || 0,
    type: record.properties.Type?.select?.name || "Unknown",
  }),
});
```

### Step 5: Test Calendar Sync

```bash
# Sync to calendar
yarn update
# Select your date range
# Select "Meditation"

# Verify in Google Calendar
# Check for new meditation events
```

**Done!** Your new calendar is now integrated.

---

## Adding a New Summary Group

**Goal**: Create a new weekly summary that combines multiple calendars (e.g., Health Summary, Work Summary).

**Time estimate**: 10-20 minutes

### Add to SUMMARY_GROUPS Registry

**File**: `src/config/unified-sources.js`

```javascript
SUMMARY_GROUPS: {
  // ... existing groups

  healthRecap: {
    id: "healthRecap",
    name: "Health Summary",
    emoji: "🏥",
    calendars: ["sleep", "workouts", "bodyWeight", "meditation"],

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
      // ... more aggregations
    },

    notionDatabase: process.env.NOTION_HEALTH_RECAP_DATABASE_ID,
  },
}
```

**That's it!** The `deriveDataSources()` function automatically generates everything else.

---

## Adding a Calendar to Monthly Recaps

**Goal**: Include a new calendar's block data in monthly recap aggregation.

**Time estimate**: 5-10 minutes

### Step 1: Verify Calendar is in Weekly Summaries

Ensure your calendar is already included in `SUMMARY_GROUPS` and generates weekly summary block fields (e.g., `newCalendarBlocks`).

### Step 2: Add to MONTHLY_RECAP_CATEGORIES

**File**: `src/config/unified-sources.js`

Add your calendar's block field to the appropriate category in `MONTHLY_RECAP_CATEGORIES`:

```javascript
MONTHLY_RECAP_CATEGORIES: {
  personal: {
    // ... existing categories
    hobby: [
      // ... existing fields
      "newCalendarBlocks",  // ADD YOUR FIELD HERE
    ],
  },
}
```

**Category Guidelines**:

- `dietAndExercise`: Physical health, food, and exercise-related activities
- `interpersonal`: Social, family, relationships, mental health
- `hobby`: Creative, intellectual, and entertainment activities
- `life`: Personal organization and home management

### Step 3: Test Monthly Recap

```bash
# Generate weekly summaries first
yarn summarize
# Select your calendar and date range

# Generate monthly recap
yarn aggregate
# Select recap type (All, Personal only, or Work only)
# Verify new calendar blocks appear in the correct category
```

**Done!** Your calendar's blocks are now included in monthly recap aggregation.

**Tip**: To filter specific words from output, add them to `CONTENT_FILTERS` in `unified-sources.js`.

---

## Adding a New Monthly Recap Category

**Goal**: Create a new category grouping for monthly recap aggregation (e.g., adding "life" category for personal/home blocks).

**Time estimate**: 15-20 minutes

### Step 1: Add Category to MONTHLY_RECAP_CATEGORIES

**File**: `src/config/unified-sources.js`

Add your new category to the appropriate recap type:

```javascript
MONTHLY_RECAP_CATEGORIES: {
  personal: {
    // ... existing categories
    newCategory: ["field1Blocks", "field2Blocks"],  // ADD YOUR CATEGORY
  },
}
```

**Important**: Category key must follow the naming pattern `{categoryName}` which maps to property name `personal{CategoryName}Blocks` or `work{CategoryName}Blocks`.

### Step 2: Add Property to Monthly Recap Schema

**File**: `src/config/unified-sources.js`

Add property definition to the appropriate property generator function:

**For personal categories**, add to `generatePersonalMonthlyRecapProperties()`:

```javascript
function generatePersonalMonthlyRecapProperties() {
  const props = {
    title: { name: "Month Recap", type: "title", enabled: true },
    // ... existing properties
    personalNewCategoryBlocks: {
      // ADD THIS (camelCase from category key)
      name: "New Category - Block Details", // Display name in Notion
      type: "text",
      enabled: true,
    },
  };
  return props;
}
```

**For work categories**, add to `generateWorkMonthlyRecapProperties()`:

```javascript
function generateWorkMonthlyRecapProperties() {
  const props = {
    title: { name: "Month Recap", type: "title", enabled: true },
    // ... existing properties
    workNewCategoryBlocks: {
      // ADD THIS
      name: "New Category - Block Details",
      type: "text",
      enabled: true,
    },
  };
  return props;
}
```

**Note**: You must also add this property to your Notion monthly recap database manually. If you're using separate Personal and Work databases, add the property to the appropriate database.

### Step 3: Update Transformer Function

**File**: `src/transformers/transform-weekly-to-monthly-recap.js`

Update `combinePersonalBlocksByCategory()` or `combineWorkBlocksByCategory()` to include your new category:

```javascript
function combinePersonalBlocksByCategory(weeklySummaries, summaryDb) {
  const categories = MONTHLY_RECAP_CATEGORIES.personal;

  // ... existing categories
  const newCategory = combineWeeklyBlocksByCategory(
    weeklySummaries,
    "personal",
    summaryDb,
    categories.newCategory,
  );

  return {
    // ... existing fields
    personalNewCategoryBlocks: newCategory || "", // ADD THIS
  };
}
```

### Step 4: Update Database Handler

**File**: `src/databases/SummaryDatabase.js`

Add property handling in `upsertMonthRecap()`:

```javascript
if (summaryData.personalNewCategoryBlocks !== undefined) {
  properties[
    config.notion.getPropertyName(this.monthlyProps.personalNewCategoryBlocks)
  ] = summaryData.personalNewCategoryBlocks || "";
}
```

### Step 5: Test

```bash
# Generate weekly summaries
yarn summarize

# Generate monthly recap
yarn aggregate

# Verify new category appears with correct data
```

**Done!** Your new monthly recap category is now functional.

---

## Adding a Personal Task Sub-Category

**Goal**: Add a new sub-category under `🌱 Personal` (e.g., `💻 Coding`, `📝 Admin`) so tasks tagged with it roll up under that bucket in weekly/monthly recaps.

**Time estimate**: 15-20 minutes

### Overview

The Tasks DB has a `Personal Category` select that mirrors `Work Category`. When a task is `🌱 Personal` and `Personal Category` is set, the personal summary transformer uses the sub-category as the bucket key. No keyword-matching against task titles.

### Step 1: Add the option to the Notion `Personal Category` select

In the Notion Tasks DB, add the new emoji-prefixed option to the `Personal Category` property (e.g., `📚 Reading`).

### Step 2: Add the mapping in `task-categories.js`

**File**: `src/config/notion/task-categories.js`

```javascript
const PERSONAL_TASK_CATEGORY_MAPPING = {
  "💻 Coding": "coding",
  "📝 Admin": "admin",
  "📚 Reading": "reading", // ADD THIS
};
```

### Step 3: Add Task Category to CALENDARS.tasks.categories

**File**: `src/config/unified-sources.js`

Add your new category to `CALENDARS.tasks.categories`:

```javascript
tasks: {
  categories: {
    // ... existing categories (personal, family, home, etc.)
    reading: {
      emoji: "📚",
      dataFields: FIELD_TEMPLATES.taskCategory("reading", "Reading"),
    },
  },
},
```

### Step 4: Add to MONTHLY_RECAP_CATEGORIES

**File**: `src/config/unified-sources.js`

```javascript
MONTHLY_RECAP_CATEGORIES: {
  personal: {
    tasks: {
      // ... existing categories
      reading: ["readingTaskDetails"],  // ADD THIS
    },
  },
},
```

### Step 5: Add to MONTHLY_RECAP_TASK_PROPERTIES

**File**: `src/config/unified-sources.js`

```javascript
MONTHLY_RECAP_TASK_PROPERTIES: {
  personal: {
    // ... existing categories
    reading: { key: "personalReadingTasks", name: "Reading - Task Details" },  // ADD THIS
  },
},
```

### Step 6: Update Monthly Recap Transformer

**File**: `src/transformers/transform-weekly-to-monthly-recap.js`

In `combinePersonalTasksByCategory()`, add after the `admin` variable:

```javascript
const reading = combineWeeklyTasksByCategory(
  weeklySummaries,
  "personal",
  summaryDb,
  categories.reading,
  MONTHLY_RECAP_TASK_PROPERTIES.personal.reading.key,
);
```

And add to the return object:

```javascript
return {
  // ... existing fields
  personalReadingTasks: reading || "", // ADD THIS
};
```

### Step 7: Add Notion Properties

Manually add these properties to your Notion databases:

**Weekly Summary Database**:

- `Reading Tasks Complete` (Number)
- `Reading - Task Details` (Text)

**Monthly Recap Database**:

- `Reading - Task Details` (Text)

### Testing

Tag a few tasks with the new `Personal Category` option in Notion, then run `yarn summarize` and verify they appear in the new bucket instead of `Personal`.

---

## Modifying Transformers

### Changing Event Titles

**File**: Transformer file (e.g., `notion-oura-to-calendar-sleep.js`)

```javascript
titleTemplate: (record) => {
  const hours = record.properties.Duration?.number || 0;
  const quality = record.properties.Score?.number || 0;
  return `Sleep: ${hours}h (${quality}% quality)`; // Customize here
},
```

### Adding Event Description

```javascript
descriptionTemplate: (record) => {
  const restfulness = record.properties.Restfulness?.number || 0;
  const deepSleep = record.properties["Deep Sleep"]?.number || 0;

  return `
Restfulness: ${restfulness}%
Deep Sleep: ${deepSleep}h

View full details in Notion
  `.trim();
},
```

### Changing Event Colors

**File**: `src/config/unified-sources.js`

```javascript
CALENDARS: {
  sleep: {
    // ... other config
    eventConfig: {
      colorId: "5", // Change color ID (1-11)
      transparency: "opaque", // or "transparent"
    },
  },
}
```

**Events and Trips**: Event colors for Notion Events and Trips are configured in `src/config/calendar/color-mappings.js`, not in CALENDARS. Events support **subcategory overrides** (e.g. "Wasted day" → red): add an entry to `EVENTS_SUBCATEGORY_TO_COLOR` with the exact Notion Subcategory value and the desired color ID (e.g. `"11"` for red). See [REFERENCE](REFERENCE.md#calendar-color-mappings) for the full palette and mapping layout.

**Google Calendar Color IDs**:

- 1: Lavender
- 2: Sage
- 3: Grape
- 4: Flamingo
- 5: Banana
- 6: Tangerine
- 7: Peacock
- 8: Graphite
- 9: Blueberry
- 10: Basil
- 11: Tomato

---

## Testing Your Changes

### Unit Testing Transformers

```javascript
const { transformOuraToNotion } = require("./oura-to-notion-oura");

const testData = {
  sleepId: "test_123",
  totalSleep: 28800, // seconds
  score: 85,
  // ... more fields
};

const result = transformOuraToNotion(testData);
console.log(result);
```

### Integration Testing

```bash
# Test with a small date range first
yarn collect
# Select "Yesterday"
# Select your integration

# Verify in Notion
# Check database for new records

# Test calendar sync
yarn update
# Select "Yesterday"
# Select your calendar

# Verify in Google Calendar
```

### Debugging Tips

1. **Enable debug logging**: Set `LOG_LEVEL=debug` in `.env`
2. **Check API responses**: Add `console.log(response)` in service files
3. **Inspect Notion properties**: Use Notion API explorer
4. **Check calendar events**: Use Google Calendar API explorer

---

## Common Patterns

### Using BaseWorkflow

If your workflow needs batch processing with progress tracking:

```javascript
const BaseWorkflow = require("./BaseWorkflow");

class MyWorkflow extends BaseWorkflow {
  constructor() {
    super({
      name: "My Workflow",
      batchSize: 10,
      delayBetweenBatches: 1000,
    });
  }

  async processBatch(items) {
    // Your batch processing logic
    return items.map((item) => this.processItem(item));
  }

  async processItem(item) {
    // Your item processing logic
    return { success: true, item };
  }
}
```

### Using buildTransformer

For simple calendar transformers:

```javascript
const { buildTransformer } = require("./buildTransformer");

module.exports = buildTransformer({
  calendarId: "myCalendar",
  sourceIntegration: "myIntegration",
  titleTemplate: (record) =>
    `My Event: ${record.properties.Name?.title[0]?.plain_text}`,
  descriptionTemplate: (record) =>
    `Details: ${record.properties.Details?.rich_text[0]?.plain_text}`,
});
```

### Error Handling Pattern

```javascript
async function myFunction() {
  try {
    // Your logic
  } catch (error) {
    logger.error(`Error in myFunction: ${error.message}`);
    // Return graceful result or rethrow
    return { success: false, error: error.message };
  }
}
```

### Workflow Output Pattern

**Principle: "Output at the Edges"** - Workflows return structured data, not formatted strings. CLI layer handles all formatting.

When creating a new workflow, return a structured result object:

```javascript
async function myWorkflow(weekNumber, year, options = {}) {
  const results = {
    weekNumber,
    year,
    data: {
      summary: {
        /* calculated metrics */
      },
      relationshipsLoaded: 0,
      // ... other data
    },
    errors: [], // Non-fatal warnings/errors
    selectedSources: ["source1", "source2"],
    // ... other metadata
  };

  // Do your processing...
  results.data.summary = calculateSummary(data);
  results.errors.push("Warning: Some data missing");

  return results; // Return structured object, don't print
}
```

**For CLI display**, use formatters from `src/utils/workflow-output.js`:

```javascript
// In CLI file (e.g., cli/summarize-week.js)
const { formatCalendarSummaryResult } = require("../src/utils/workflow-output");

const result = await myWorkflow(weekNumber, year, options);
const displayData = formatCalendarSummaryResult(result, "personal");

// displayData contains:
// - header: "Week 42, 2024"
// - successLines: ["   😴 Sleep (7.5h)", "   💪 Workouts (5 days)"]
// - warnings: ["⚠️ Warning: Some data missing"]
// - stats: { relationshipsLoaded: 12 }
```

**Creating a new formatter** in `workflow-output.js`:

```javascript
function formatMyWorkflowResult(result, recapType) {
  const header = `Week ${result.weekNumber}, ${result.year}`;
  const successLines = buildSuccessData(
    result.selectedSources || [],
    result.data?.summary || result.summary || {},
    SUMMARY_GROUPS,
  );
  const warnings = formatErrors(result.errors);
  const stats = {
    itemsProcessed: result.data?.itemsProcessed || 0,
  };

  return { header, successLines, warnings, stats };
}
```

See [ARCHITECTURE.md](ARCHITECTURE.md#workflow-output-architecture) for more details on the workflow output architecture.

---

## Need Help?

- **Architecture questions?** See [ARCHITECTURE.md](ARCHITECTURE.md)
- **Naming conventions?** See [REFERENCE.md](REFERENCE.md)
- **Design patterns?** See [INTERNALS.md](INTERNALS.md)
- **Setup issues?** See [../README.md](../README.md)
