# What I Learned Building Brickomations

**Backend development principles discovered through building a personal data pipeline**

> **Related Docs**: [Architecture](ARCHITECTURE.md) · [Internals](INTERNALS.md) · [Guides](GUIDES.md) · [Reference](REFERENCE.md)

---

## The 4-Layer Data Flow

Each command has a **verb** and a **noun** - this mental model keeps the system clear:

| Command          | Verb          | Noun      | What Happens                               |
| ---------------- | ------------- | --------- | ------------------------------------------ |
| `yarn collect`   | **Collect**   | API data  | Fetch from external APIs → Store in Notion |
| `yarn update`    | **Update**    | Calendars | Notion records → Google Calendar events    |
| `yarn summarize` | **Summarize** | Weeks     | Calendar events → Weekly summary in Notion |
| `yarn aggregate` | **Aggregate** | Months    | Weekly summaries → Monthly recap in Notion (with type selection: All/Personal/Work) |

**Key insight:** Each layer's output becomes the next layer's input. Calendar + Notion tasks become the "source of truth" for summarization.

**See also:** [ARCHITECTURE.md - Data Flow Examples](ARCHITECTURE.md#data-flow-examples)

---

## Backend Principles

### 1. Single Source of Truth

**Definition:** Definitions live in ONE place. No copy-paste.

**In practice:** [`src/config/unified-sources.js`](../src/config/unified-sources.js) contains three registries:

```javascript
CALENDARS; // What domains exist (sleep, workouts, etc.)
SUMMARY_GROUPS; // How domains combine for reporting
INTEGRATIONS; // API → Notion routing and metadata
```

Everything else _derives_ from these registries. Adding a new calendar? Edit the config once, it propagates everywhere.

**See also:** [ARCHITECTURE.md - Configuration Registries](ARCHITECTURE.md#1-calendars-registry)

---

### 2. Repository Pattern

**Definition:** All database access goes through ONE class that knows how to talk to that database.

**Without it:**

```javascript
// Scattered across 20 files, copy-pasted, inconsistent
await notion.databases.query({ database_id: "xxx", filter: {...} });
```

**With it:**

```javascript
// One class handles all integrations
const db = new IntegrationDatabase("oura");
await db.findByUniqueId("sleep_123");
```

**Why it matters:** If Notion changes their API, fix ONE file, not 20.

**Key files:**

- [`src/databases/IntegrationDatabase.js`](../src/databases/IntegrationDatabase.js) - Generic integration access
- [`src/databases/NotionDatabase.js`](../src/databases/NotionDatabase.js) - Base CRUD operations
- [`src/databases/SummaryDatabase.js`](../src/databases/SummaryDatabase.js) Summary-specific queries

**See also:** [INTERNALS.md - Repository Pattern](INTERNALS.md#repository-pattern)

---

### 3. Separation of Concerns

**Definition:** Each file/layer does ONE job.

| Layer        | Does                      | Does NOT                            |
| ------------ | ------------------------- | ----------------------------------- |
| Collectors   | Fetch API data            | Format for Notion, save to database |
| Transformers | Convert formats           | Make API calls, save to database    |
| Databases    | CRUD operations           | Business logic, API calls           |
| Workflows    | Orchestrate steps         | Low-level API calls, formatting     |
| CLI          | User interaction, display | Business logic, data processing     |

**Key insight:** If you're adding console.log to a database file, you're violating this principle.

**See also:** [ARCHITECTURE.md - Module Responsibilities](ARCHITECTURE.md#module-responsibilities)

---

### 4. Output at Edges

**Definition:** Data layer returns data. UI layer handles display.

**Wrong:**

```javascript
// In workflow file
console.log("Processing 5 items..."); // ❌ Workflow shouldn't print
const result = await process();
console.log("Done!");
```

**Right:**

```javascript
// In workflow file
return { count: 5, items: [...] };  // ✅ Return data only

// In CLI file
const spinner = createSpinner("Processing...");
spinner.start();
const result = await workflow();
spinner.stop();
console.log(`✅ ${result.count} items processed`);  // ✅ CLI owns output
```

**Key files:**

- [`src/utils/output.js`](../src/utils/output.js) - Output utilities and emoji constants
- [`src/utils/workflow-output.js`](../src/utils/workflow-output.js) - Formatters for workflow results
- [`src/utils/cli.js`](../src/utils/cli.js) - Spinners, date pickers, prompts

**See also:** [INTERNALS.md - Output at Edges](INTERNALS.md#output-at-edges)

---

### 5. Idempotent Operations

**Definition:** Running the same operation multiple times produces the same result as running it once.

**In practice:** When `yarn collect` runs, it checks if a record exists before creating:

```javascript
// BaseWorkflow.syncToNotion()
const existing = await findExistingFn(item, repository);
if (existing) {
  return { skipped: true }; // Don't create duplicate
}
```

**Why it matters:** Ran 53 weeks of `yarn summarize` in one batch (7.6 minutes). Without idempotency, that would create 53 duplicate records. Instead, it safely skipped existing ones.

**Real-world analogy:** A light switch is idempotent - flipping "on" when it's already on doesn't turn on a second light.

**Key file:** [`src/workflows/BaseWorkflow.js`](../src/workflows/BaseWorkflow.js) - `syncToNotion()` and `syncBatch()`

---

### 6. Config-Driven Design

**Definition:** Behavior is controlled by config, not code.

**Related but different from Single Source of Truth:**

| Concept                | What it means                                    |
| ---------------------- | ------------------------------------------------ |
| Single Source of Truth | Definitions live in ONE place                    |
| Config-Driven          | Code asks "what should I do?" and config answers |

**In practice:** `IntegrationDatabase` doesn't know anything about Oura or Strava. It reads from `INTEGRATIONS` config to learn:

- Which property is the unique ID?
- Which property is the date field?
- Which property tracks sync status?

```javascript
// The class is generic
const db = new IntegrationDatabase("oura");

// Behavior comes from config
this.databaseConfig = INTEGRATIONS[configKey].databaseConfig;
```

**Result:** Adding a new integration = add config, not code.

**See also:** [GUIDES.md - Adding a New Integration](GUIDES.md#adding-a-new-integration)

---

## Architecture Layers Quick Reference

For detailed explanations, see [ARCHITECTURE.md - Module Responsibilities](ARCHITECTURE.md#module-responsibilities).

| Layer       | Location                                    | Responsibility                               |
| ----------- | ------------------------------------------- | -------------------------------------------- |
| CLI         | [`cli/`](../cli/)                           | User interaction, prompts, spinners, display |
| Workflow    | [`src/workflows/`](../src/workflows/)       | Orchestration, batch processing              |
| Collector   | [`src/collectors/`](../src/collectors/)     | Fetch from external APIs                     |
| Database    | [`src/databases/`](../src/databases/)       | Notion CRUD (Repository Pattern)             |
| Transformer | [`src/transformers/`](../src/transformers/) | Format conversion                            |
| Service     | [`src/services/`](../src/services/)         | Thin API wrappers                            |
| Config      | [`src/config/`](../src/config/)             | unified-sources.js + mappings                |
| Utils       | [`src/utils/`](../src/utils/)               | Shared helpers                               |

---

## Key Wins from These Principles

| Refactor                            | Lines Saved     | Principle Applied                 |
| ----------------------------------- | --------------- | --------------------------------- |
| `FIELD_TEMPLATES` factory           | ~255 lines      | Single Source of Truth            |
| `IntegrationDatabase` consolidation | ~400+ lines     | Repository Pattern, Config-Driven |
| `RecapDatabase` consolidation       | ~57 lines       | Repository Pattern                |
| Workflow output formatters          | Cleaner CLI     | Output at Edges                   |
| Built-in deduplication              | Zero duplicates | Idempotent Operations             |

---

## Next Steps

- **Understand the architecture?** → [ARCHITECTURE.md](ARCHITECTURE.md)
- **See design patterns in depth?** → [INTERNALS.md](INTERNALS.md)
- **Add a new feature?** → [GUIDES.md](GUIDES.md)
- **Look up naming conventions?** → [REFERENCE.md](REFERENCE.md)
