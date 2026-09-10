// Upserts pulled Linear issues directly into the shared Notion 2026 Tasks
// database (Linear → Notion → local: Notion is the one holistic layer; the
// phone reads it natively with no MCP/API call). No separate mirror DB.
//
// Field ownership — the sync owns columns, not rows:
//   - Sync-owned, overwritten every run: Task, Status, Due Date, Linear Date,
//     Priority, Linear ID, Linear URL, and the page BODY (the Linear issue
//     description, converted markdown → blocks). Editing these in Notion gets
//     reverted next run — that edit belongs in Linear. Notes stays the
//     Jon-owned free-text field.
//   - Body details: Linear-hosted images are auth-gated and would render
//     broken in Notion, so each image becomes an inline placeholder link
//     back to the issue (🖼️ image — view in Linear). Settled rows
//     (🟢 Done / 🛑 Canceled) skip the body compare — one block-list read
//     per row per run is only paid for active tasks.
//   - Jon-owned, never touched: Category (set to 💼 Work on create only),
//     WORK Category (seeded from the Linear team on create only — DSGN →
//     🎨 Design, DE → 🖥️ Coding), Notes, relations, everything else. Week Number is a
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
const {
  markdownToBlocks,
  blocksToMarkdown,
  normalizedBody,
  canonicalizeLinksForCompare,
} = require("../utils/notion-content");

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

// WORK Category is Jon-owned like Category: seeded from the issue's Linear
// team on create only, never overwritten. Unmapped teams get no seed.
// PD is the Product Design team's key since Sep 2026; DSGN kept so
// pre-rename local snapshots still resolve.
const CREATE_ONLY_WORK_CATEGORY_BY_TEAM = {
  PD: "🎨 Design",
  DSGN: "🎨 Design",
  DE: "🖥️ Coding",
};

/**
 * Replace every markdown image with an inline placeholder link back to the
 * issue. Linear-hosted images (uploads.linear.app) are auth-gated — a Notion
 * image block pointing at one renders broken — and markdownToBlocks has no
 * image handling anyway. A link round-trips losslessly through
 * markdown → blocks → markdown, so change detection stays stable.
 */
function imagesToPlaceholders(markdown, issueUrl) {
  return (markdown || "").replace(
    /!\[[^\]]*\]\([^)]*\)/g,
    `[🖼️ image — view in Linear](${issueUrl})`
  );
}

// Linear stamps completedAt in UTC — a late-evening close in NYC would
// otherwise land on the next calendar day (and the wrong week).
function nyDateOf(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

/** Plain string values for change detection (compared via extractProperty). */
function syncedValues(task) {
  return {
    Task: task.Task,
    Status: STATUS_BY_STATE_TYPE[task["State Type"]] || "🔴 To Do",
    "Due Date": task["Due Date"] || "",
    // Linear's model: the day the issue was marked complete, empty until then.
    "Linear Date": task["Completed At"] ? nyDateOf(task["Completed At"]) : "",
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
    "Linear Date": {
      date: values["Linear Date"] ? { start: values["Linear Date"] } : null,
    },
    Priority: { select: values.Priority ? { name: values.Priority } : null },
    "Linear ID": { rich_text: [{ text: { content: values["Linear ID"] } }] },
    "Linear URL": { url: values["Linear URL"] },
  };
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
    const bodyMarkdown = imagesToPlaceholders(task.Content, task.URL);
    const desiredBlocks = markdownToBlocks(bodyMarkdown);
    const desiredBody = normalizedBody(bodyMarkdown);
    const settled = SETTLED_STATUSES.has(values.Status);
    const page = pagesByLinearId.get(task.Identifier);

    if (!page) {
      counts.actions.push(
        `+ create ${task.Identifier} [${values.Status}] ${values.Task}`
      );
      counts.created++;
      if (dryRun) continue;
      const workCategory = CREATE_ONLY_WORK_CATEGORY_BY_TEAM[task.Team];
      const created = await db.createPage(
        databaseId,
        {
          ...toPayload(values),
          Category: { select: { name: CREATE_ONLY_CATEGORY } },
          ...(workCategory
            ? { "WORK Category": { select: { name: workCategory } } }
            : {}),
        },
        [],
        CONFIG_KEY
      );
      // Body via replacePageContent, not createPage children — the create
      // endpoint caps children at 100 blocks; replace appends in batches.
      if (desiredBlocks.length > 0) {
        await delay(backoffMs);
        await db.replacePageContent(created.id, desiredBlocks);
      }
      await delay(backoffMs);
    } else {
      const propChanges = changedFields(db, page, values);
      // Body compare costs one block-list read per row per run — paid for
      // active rows only; a settled row's body was synced while it lived.
      let bodyChanged = false;
      if (!settled) {
        const currentBody = blocksToMarkdown(
          await db.getPageBlocks(page.id)
        ).trim();
        await delay(backoffMs);
        bodyChanged =
          canonicalizeLinksForCompare(currentBody) !==
          canonicalizeLinksForCompare(desiredBody);
      }
      if (propChanges.length === 0 && !bodyChanged) {
        counts.unchanged++;
        continue;
      }
      const changes = [...propChanges];
      if (bodyChanged) changes.push("Body: rewritten from Linear");
      counts.actions.push(
        `~ update ${task.Identifier} (${changes.join("; ")})`
      );
      counts.updated++;
      if (dryRun) continue;
      if (propChanges.length > 0) {
        await db.updatePage(page.id, toPayload(values), CONFIG_KEY);
        await delay(backoffMs);
      }
      if (bodyChanged) {
        await db.replacePageContent(page.id, desiredBlocks);
        await delay(backoffMs);
      }
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

module.exports = { syncLinearTasks, imagesToPlaceholders };
