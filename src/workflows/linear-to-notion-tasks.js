// Upserts pulled Linear issues directly into the shared Notion 2026 Tasks
// database (Linear → Notion → local: Notion is the one holistic layer; the
// phone reads it natively with no MCP/API call). No separate mirror DB.
//
// Field ownership — the sync owns columns, not rows:
//   - Sync-owned, overwritten every run: Task, Status, Due Date, Priority,
//     Linear ID, Linear URL. Editing these in Notion gets reverted next
//     run — that edit belongs in Linear.
//   - Jon-owned, never touched: Category (set to 💼 Work on create only),
//     WORK Category, Notes, relations, everything else. Week Number is a
//     Notion formula off Due Date — nothing to write.
//   - Rows without a Linear ID (personal + flexible work tasks) are
//     invisible to the sync.
//
// Reconciliation rules:
//   - Upsert on `Linear ID` — two consecutive runs produce identical state.
//   - Status maps by Linear state *type* (never name — team state names
//     vary), onto a fixed Linear-shaped option set.
//   - Rows whose Linear ID is absent from the pull (archived, unassigned)
//     get Status 🫥 Gone — unless already settled (🟢 Done / 🛑 Canceled
//     rows aging out of the pull window stay as they are). Rows are never
//     deleted — retiring one is a manual [DELETE] pass.
//   - Read-only sync: no write-back to Linear, ever.

const NotionDatabase = require("../databases/NotionDatabase");
const config = require("../config");
const { delay } = require("../utils/async");

const CONFIG_KEY = "linearTasks";
const GONE_STATUS = "🫥 Gone";

const STATUS_BY_STATE_TYPE = {
  triage: "🔴 To Do",
  backlog: "🧊 Backlog",
  unstarted: "🔴 To Do",
  started: "🔵 Doing",
  completed: "🟢 Done",
  canceled: "🛑 Canceled",
};

// Terminal in Linear's eyes — the gone pass leaves these alone when the
// issue ages out of the pull window.
const SETTLED_STATUSES = new Set(["🟢 Done", "🛑 Canceled", GONE_STATUS]);

// Notion Priority is a select — Urgent auto-creates on first write.
// Linear "No priority" arrives as "" (mapped upstream) and clears the select.
const PRIORITY_MAP = { Urgent: "Urgent", High: "High", Medium: "Med", Low: "Low" };

const CREATE_ONLY_CATEGORY = "💼 Work";

// Linear stamps completedAt/canceledAt in UTC — a late-evening close in NYC
// would otherwise land on the next calendar day (and the wrong week).
function nyDateOf(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

// Settled issues rarely carry a Linear due date, but a dateless 🟢 Done /
// 🛑 Canceled row never lands in any week of the Notion record — fall back
// to the day the issue was closed.
function effectiveDueDate(task) {
  if (task["Due Date"]) return task["Due Date"];
  const settledAt = task["Completed At"] || task["Canceled At"];
  return settledAt ? nyDateOf(settledAt) : "";
}

/** Plain string values for change detection (compared via extractProperty). */
function syncedValues(task) {
  return {
    Task: task.Task,
    Status: STATUS_BY_STATE_TYPE[task["State Type"]] || "🔴 To Do",
    "Due Date": effectiveDueDate(task),
    Priority: PRIORITY_MAP[task.Priority] || "",
    "Linear ID": task.Identifier,
    "Linear URL": task.URL,
  };
}

// Fully-formed Notion payloads (passed through _formatProperties verbatim)
// so the status-type property and explicit nulls for cleared selects/dates
// need no config-driven detection.
function toPayload(values) {
  return {
    Task: { title: [{ text: { content: values.Task } }] },
    Status: { status: { name: values.Status } },
    "Due Date": { date: values["Due Date"] ? { start: values["Due Date"] } : null },
    Priority: { select: values.Priority ? { name: values.Priority } : null },
    "Linear ID": { rich_text: [{ text: { content: values["Linear ID"] } }] },
    "Linear URL": { url: values["Linear URL"] },
  };
}

function isChanged(db, page, values) {
  return Object.entries(values).some(
    ([name, value]) => (db.extractProperty(page, name) || "") !== value
  );
}

/** Changed sync-owned fields as "Status: 🔵 Doing → 🟢 Done" fragments. */
function changedFields(db, page, values) {
  return Object.entries(values)
    .filter(([name, value]) => (db.extractProperty(page, name) || "") !== value)
    .map(([name, value]) => {
      const before = db.extractProperty(page, name) || "(empty)";
      return `${name}: ${before} → ${value || "(empty)"}`;
    });
}

/**
 * @param {Array} tasks - Task records from pull-linear's toTaskRecord
 * @param {{dryRun?: boolean}} [opts] - dryRun reads Notion and reports the
 *   plan (counts + actions) without writing a thing.
 * @returns {Promise<{created: number, updated: number, gone: number, unchanged: number, actions: string[]}>}
 */
async function syncLinearTasks(tasks, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const databaseId = config.notion.databases[CONFIG_KEY];
  if (!databaseId) {
    throw new Error(
      "TASKS_DATABASE_ID is required (Notion database ID of 2026 Tasks)"
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

  for (const task of tasks) {
    if (!task.Identifier) continue;
    pulledIds.add(task.Identifier);

    const values = syncedValues(task);
    const page = pagesByLinearId.get(task.Identifier);

    if (!page) {
      counts.actions.push(
        `+ create ${task.Identifier} [${values.Status}] ${values.Task}`
      );
      counts.created++;
      if (dryRun) continue;
      await db.createPage(
        databaseId,
        { ...toPayload(values), Category: { select: { name: CREATE_ONLY_CATEGORY } } },
        [],
        CONFIG_KEY
      );
      await delay(backoffMs);
    } else if (isChanged(db, page, values)) {
      counts.actions.push(
        `~ update ${task.Identifier} (${changedFields(db, page, values).join("; ")})`
      );
      counts.updated++;
      if (dryRun) continue;
      await db.updatePage(page.id, toPayload(values), CONFIG_KEY);
      await delay(backoffMs);
    } else {
      counts.unchanged++;
    }
  }

  for (const [linearId, page] of pagesByLinearId) {
    if (pulledIds.has(linearId)) continue;
    if (SETTLED_STATUSES.has(db.extractProperty(page, "Status"))) continue;
    counts.actions.push(
      `✕ gone ${linearId} (${db.extractProperty(page, "Status")} → ${GONE_STATUS})`
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

module.exports = { syncLinearTasks };
