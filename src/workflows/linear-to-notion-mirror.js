// Upserts pulled Linear issues into the Notion Linear Mirror database
// (Linear → Notion → local: Notion is the source of trust; the phone reads
// it natively with no MCP/API call).
//
// Reconciliation rules:
//   - Upsert on `Linear ID` — two consecutive runs produce identical state.
//   - `Updated` stamps only when a row's content actually changes, so an
//     unchanged issue writes nothing (idempotent, and cheap on rate limits).
//   - Rows whose Linear ID is absent from the pull (closed past the
//     completed window, archived, or unassigned) get Linear Status "Gone".
//     Rows are never deleted — retiring one is a manual [DELETE] pass.
//   - Read-only mirror: no write-back to Linear, ever.

const NotionDatabase = require("../databases/NotionDatabase");
const config = require("../config");
const { delay } = require("../utils/async");

const CONFIG_KEY = "linearMirror";
const GONE_STATUS = "Gone";

// Mirror-property names -> pulled-task record keys and Notion types.
// Task is the title; Linear ID keys the upsert; the rest ride along for
// phone-side planning. Empty selects/dates must be sent as explicit null
// payloads — `select: {name: ""}` is a Notion API error, and empty date
// strings are silently skipped, so a cleared Linear due date would
// otherwise never clear in the mirror.
const FIELDS = [
  ["Task", "Task", "title"],
  ["Linear ID", "Identifier", "text"],
  ["Linear Status", "Status", "select"],
  ["Due Date", "Due Date", "date"],
  ["Priority", "Priority", "select"],
  ["Week Number", "Week Number", "select"],
  ["Project", "Project", "select"],
  ["Team", "Team", "select"],
  ["URL", "URL", "url"],
];

function toMirrorProperties(task) {
  const props = {};
  for (const [notionName, taskKey, type] of FIELDS) {
    const value = task[taskKey] || "";
    if (value === "" && type === "select") props[notionName] = { select: null };
    else if (value === "" && type === "date") props[notionName] = { date: null };
    else props[notionName] = value;
  }
  return props;
}

function propValue(props, name) {
  const v = props[name];
  return typeof v === "string" ? v : ""; // null-payload objects mean "empty"
}

function isChanged(db, page, props) {
  return Object.keys(props).some(
    (name) => (db.extractProperty(page, name) || "") !== propValue(props, name)
  );
}

/**
 * @param {Array} tasks - Task records from pull-linear's toTaskRecord
 * @returns {Promise<{created: number, updated: number, gone: number, unchanged: number}>}
 */
async function syncLinearMirror(tasks) {
  const databaseId = config.notion.databases[CONFIG_KEY];
  if (!databaseId) {
    throw new Error(
      "NOTION_LINEAR_MIRROR_DATABASE_ID is required (Notion database ID of the Linear mirror)"
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

  const counts = { created: 0, updated: 0, gone: 0, unchanged: 0 };
  const now = new Date().toISOString();
  const pulledIds = new Set();

  for (const task of tasks) {
    if (!task.Identifier) continue;
    pulledIds.add(task.Identifier);

    const props = toMirrorProperties(task);
    const page = pagesByLinearId.get(task.Identifier);

    if (!page) {
      await db.createPage(databaseId, { ...props, Updated: now }, [], CONFIG_KEY);
      counts.created++;
      await delay(backoffMs);
    } else if (isChanged(db, page, props)) {
      await db.updatePage(page.id, { ...props, Updated: now }, CONFIG_KEY);
      counts.updated++;
      await delay(backoffMs);
    } else {
      counts.unchanged++;
    }
  }

  for (const [linearId, page] of pagesByLinearId) {
    if (pulledIds.has(linearId)) continue;
    if (db.extractProperty(page, "Linear Status") === GONE_STATUS) continue;
    await db.updatePage(
      page.id,
      { "Linear Status": GONE_STATUS, Updated: now },
      CONFIG_KEY
    );
    counts.gone++;
    await delay(backoffMs);
  }

  return counts;
}

module.exports = { syncLinearMirror };
