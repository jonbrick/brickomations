// Upserts pulled Linear projects directly into the shared Notion 2026
// Projects database (Linear → Notion → local: Notion is the one holistic
// layer; the phone reads it natively with no MCP/API call). Same pattern
// as linear-to-notion-tasks — no separate mirror DB.
//
// Field ownership — the sync owns columns, not rows:
//   - Sync-owned, overwritten every run: Project (title, verbatim from
//     Linear), Status, Date, Priority, Linear ID, Linear URL. Editing
//     these in Notion gets reverted next run — that edit belongs in Linear.
//   - Jon-owned, never touched: Category (set to 💼 Work on create only),
//     Work Category, Problem, Description, Lead, Goal/Products/Tasks
//     relations, everything else.
//   - Rows without a Linear ID (all personal projects) are invisible to
//     the sync.
//
// Reconciliation rules:
//   - Upsert on `Linear ID` (project UUID — projects have no DSGN-123-style
//     identifier) — two consecutive runs produce identical state.
//   - Status maps by Linear project state *type* (never status name —
//     project statuses are customized per project: "In Design", "Duplicate")
//     onto the existing 2026 Projects option set.
//   - Rows whose Linear ID is absent from the pull (archived, or Jon
//     removed from the project) get Status 🫥 Gone — unless already settled
//     (🟢 Done / ❌ Canceled rows stay as they are). Rows are never
//     deleted — retiring one is a manual [DELETE] pass.
//   - Read-only sync: no write-back to Linear, ever.

const NotionDatabase = require("../databases/NotionDatabase");
const config = require("../config");
const { delay } = require("../utils/async");

const CONFIG_KEY = "linearProjects";
const GONE_STATUS = "🫥 Gone";

// Option names verbatim from the Notion 2026 Projects Status property —
// "⏸️  Paused" really has two spaces after the emoji.
const STATUS_BY_STATE = {
  backlog: "🧊 Icebox",
  planned: "🔴 To Do",
  started: "🔵 Doing",
  paused: "⏸️  Paused",
  completed: "🟢 Done",
  canceled: "❌ Canceled",
};

// Terminal in Linear's eyes — the gone pass leaves these alone.
const SETTLED_STATUSES = new Set(["🟢 Done", "❌ Canceled", GONE_STATUS]);

// 2026 Projects Priority uses "Medium" (unlike 2026 Tasks' "Med").
// Linear "No priority" arrives as "" (mapped upstream) and clears the select.
const PRIORITY_MAP = { Urgent: "Urgent", High: "High", Medium: "Medium", Low: "Low" };

const CREATE_ONLY_CATEGORY = "💼 Work";

/**
 * Plain string values for change detection. Date is compared as a
 * start/end pair; end is "" when the project window is a single date.
 */
function syncedValues(project) {
  const start = project["Start Date"] || project["Target Date"] || "";
  const end =
    project["Start Date"] &&
    project["Target Date"] &&
    project["Target Date"] !== project["Start Date"]
      ? project["Target Date"]
      : "";
  return {
    Project: project.Name,
    Status: STATUS_BY_STATE[project.State] || "🔴 To Do",
    "Date Start": start,
    "Date End": end,
    Priority: PRIORITY_MAP[project.Priority] || "",
    "Linear ID": project.Id,
    "Linear URL": project.URL,
  };
}

/** The page's current sync-owned values, shaped exactly like syncedValues. */
function currentValues(db, page) {
  const range = db.extractDateRange(page, "Date");
  return {
    Project: db.extractProperty(page, "Project") || "",
    Status: db.extractProperty(page, "Status") || "",
    "Date Start": range ? range.start : "",
    // extractDateRange falls back end → start for single dates; normalize
    // that back to "" so single-date rows compare equal to single-date pulls.
    "Date End": range && range.end !== range.start ? range.end : "",
    Priority: db.extractProperty(page, "Priority") || "",
    "Linear ID": db.extractProperty(page, "Linear ID") || "",
    "Linear URL": db.extractProperty(page, "Linear URL") || "",
  };
}

// Fully-formed Notion payloads (passed through _formatProperties verbatim)
// so the status-type property, the date range, and explicit nulls for
// cleared selects/dates need no config-driven detection.
function toPayload(values) {
  return {
    Project: { title: [{ text: { content: values.Project } }] },
    Status: { status: { name: values.Status } },
    Date: {
      date: values["Date Start"]
        ? {
            start: values["Date Start"],
            ...(values["Date End"] ? { end: values["Date End"] } : {}),
          }
        : null,
    },
    Priority: { select: values.Priority ? { name: values.Priority } : null },
    "Linear ID": { rich_text: [{ text: { content: values["Linear ID"] } }] },
    "Linear URL": { url: values["Linear URL"] },
  };
}

/** Changed sync-owned fields as "Status: 🔵 Doing → 🟢 Done" fragments. */
function changedFields(current, values) {
  return Object.entries(values)
    .filter(([name, value]) => current[name] !== value)
    .map(
      ([name, value]) =>
        `${name}: ${current[name] || "(empty)"} → ${value || "(empty)"}`
    );
}

/**
 * @param {Array} projects - Project records from pull-linear's
 *   toAssignedProjectRecord
 * @param {{dryRun?: boolean}} [opts] - dryRun reads Notion and reports the
 *   plan (counts + actions) without writing a thing.
 * @returns {Promise<{created: number, updated: number, gone: number, unchanged: number, actions: string[]}>}
 */
async function syncLinearProjects(projects, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const databaseId = config.notion.databases[CONFIG_KEY];
  if (!databaseId) {
    throw new Error(
      "NOTION_PERSONAL_PROJECTS_DATABASE_ID is required (Notion database ID of 2026 Projects)"
    );
  }

  const db = new NotionDatabase();
  const backoffMs = config.sources.rateLimits.notion.backoffMs;

  const existingPages = await db.queryDatabaseAll(databaseId);
  const pagesByLinearId = new Map();
  for (const page of existingPages) {
    const linearId = db.extractProperty(page, "Linear ID");
    if (linearId) pagesByLinearId.set(linearId, page);
  }

  const counts = { created: 0, updated: 0, gone: 0, unchanged: 0, actions: [] };
  const pulledIds = new Set();

  for (const project of projects) {
    if (!project.Id) continue;
    pulledIds.add(project.Id);

    const values = syncedValues(project);
    const page = pagesByLinearId.get(project.Id);

    if (!page) {
      counts.actions.push(`+ create [${values.Status}] ${values.Project}`);
      counts.created++;
      if (dryRun) continue;
      await db.createPage(
        databaseId,
        {
          ...toPayload(values),
          Category: { select: { name: CREATE_ONLY_CATEGORY } },
        },
        [],
        CONFIG_KEY
      );
      await delay(backoffMs);
    } else {
      const current = currentValues(db, page);
      const changes = changedFields(current, values);
      if (changes.length === 0) {
        counts.unchanged++;
        continue;
      }
      counts.actions.push(`~ update ${values.Project} (${changes.join("; ")})`);
      counts.updated++;
      if (dryRun) continue;
      await db.updatePage(page.id, toPayload(values), CONFIG_KEY);
      await delay(backoffMs);
    }
  }

  for (const [linearId, page] of pagesByLinearId) {
    if (pulledIds.has(linearId)) continue;
    if (SETTLED_STATUSES.has(db.extractProperty(page, "Status"))) continue;
    counts.actions.push(
      `✕ gone ${db.extractProperty(page, "Project")} ` +
        `(${db.extractProperty(page, "Status")} → ${GONE_STATUS})`
    );
    counts.gone++;
    if (dryRun) continue;
    await db.updatePage(
      page.id,
      { Status: { status: { name: GONE_STATUS } } },
      CONFIG_KEY
    );
    await delay(backoffMs);
  }

  return counts;
}

module.exports = { syncLinearProjects };
