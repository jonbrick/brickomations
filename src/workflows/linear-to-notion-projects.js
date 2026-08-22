// Upserts pulled Linear projects directly into the shared Notion 2026
// Projects database (Linear → Notion → local: Notion is the one holistic
// layer; the phone reads it natively with no MCP/API call). Same pattern
// as linear-to-notion-tasks — no separate mirror DB.
//
// Field ownership — the sync owns columns, not rows:
//   - Sync-owned, overwritten every run: Project (title, verbatim from
//     Linear), Status, Date, Priority, Linear ID, Linear URL, Description
//     (Linear's short summary metadata), the page BODY (Linear's project
//     overview doc, converted markdown → blocks), and the page ICON
//     (emoji by team — 🎨 PD/DSGN, 🏗️ DE; projects only, tasks get none).
//     Editing these in Notion gets reverted next run — that edit belongs
//     in Linear. A Linear project with no overview doc means an empty
//     Notion body; one with no mapped team keeps whatever icon it has.
//   - Jon-owned, never touched: Category (set to 💼 Work on create only),
//     Work Category (seeded from the project's teams on create only —
//     DSGN → 🎨 Design, DE → 🖥️ Coding), Lead,
//     Goal/Products/Tasks relations, everything else.
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
const {
  markdownToBlocks,
  blocksToMarkdown,
  chunkRichText,
} = require("../utils/notion-content");

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

// Work Category is Jon-owned like Category: seeded from the project's
// teams on create only, never overwritten. A project can be on several
// teams — first mapped key wins. Unmapped teams get no seed.
const CREATE_ONLY_WORK_CATEGORY_BY_TEAM = {
  DSGN: "🎨 Design",
  DE: "🖥️ Coding",
};

function workCategoryFor(project) {
  const key = (project.Teams || []).find(
    (k) => CREATE_ONLY_WORK_CATEGORY_BY_TEAM[k]
  );
  return key ? CREATE_ONLY_WORK_CATEGORY_BY_TEAM[key] : null;
}

// Page icon by team — sync-owned, unlike Work Category: a hand-changed
// icon gets reverted next run. Cross-team projects: first mapped key wins.
// Unmapped teams get "" and the icon is left alone.
const ICON_BY_TEAM = {
  DSGN: "🎨",
  DE: "🏗️",
};

function iconFor(project) {
  const key = (project.Teams || []).find((k) => ICON_BY_TEAM[k]);
  return key ? ICON_BY_TEAM[key] : "";
}

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
    Description: project.Description || "",
  };
}

/**
 * Linear overview markdown normalized to what the Notion page reads back
 * as after our own write: markdown → blocks → markdown. Comparing raw
 * Linear markdown against the page would rewrite bodies every run — the
 * conversion is lossy on constructs Notion blocks don't model 1:1, so
 * only the round-tripped form is stable.
 */
function normalizedBody(markdown) {
  return blocksToMarkdown(markdownToBlocks(markdown || "")).trim();
}

/**
 * Notion canonicalizes link URLs it stores — notion.so links lose their
 * query string, and + in query strings is re-encoded as %20 — so raw
 * markdown compares never converge on pages containing such links.
 * Canonicalize both sides the same way (drop notion-domain queries,
 * percent-decode with + as space) before comparing. Compare-only: the
 * blocks actually written keep Linear's URLs verbatim.
 */
function canonicalizeLinksForCompare(markdown) {
  return markdown.replace(/\]\(([^)]+)\)/g, (_m, url) => {
    let u = url;
    if (/https?:\/\/([^/]*\.)?(notion\.(so|site)|app\.notion\.com)\//.test(u)) {
      u = u.split("?")[0];
    }
    try {
      u = decodeURIComponent(u.replace(/\+/g, "%20"));
    } catch {
      // undecodable escapes: compare the URL as-is
    }
    return `](${u})`;
  });
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
    Description: db.extractProperty(page, "Description") || "",
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
    Description: { rich_text: chunkRichText(values.Description) },
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
    const desiredBlocks = markdownToBlocks(project.Content || "");
    const desiredBody = normalizedBody(project.Content);
    const desiredIcon = iconFor(project);
    const page = pagesByLinearId.get(project.Id);

    if (!page) {
      counts.actions.push(`+ create [${values.Status}] ${values.Project}`);
      counts.created++;
      if (dryRun) continue;
      const workCategory = workCategoryFor(project);
      const created = await db.createPage(
        databaseId,
        {
          ...toPayload(values),
          Category: { select: { name: CREATE_ONLY_CATEGORY } },
          ...(workCategory
            ? { "Work Category": { select: { name: workCategory } } }
            : {}),
        },
        [],
        CONFIG_KEY
      );
      if (desiredIcon) {
        await delay(backoffMs);
        await db.setPageIcon(created.id, desiredIcon);
      }
      // Body via replacePageContent, not createPage children — the create
      // endpoint caps children at 100 blocks; replace appends in batches.
      if (desiredBlocks.length > 0) {
        await delay(backoffMs);
        await db.replacePageContent(created.id, desiredBlocks);
      }
      await delay(backoffMs);
    } else {
      const current = currentValues(db, page);
      const propChanges = changedFields(current, values);
      const currentIcon = page.icon?.type === "emoji" ? page.icon.emoji : "";
      const iconChanged = Boolean(desiredIcon) && desiredIcon !== currentIcon;
      // Body compare costs one block-list read per row per run (nested
      // fetches never trigger: sync-written bodies are flat).
      const currentBody = blocksToMarkdown(
        await db.getPageBlocks(page.id)
      ).trim();
      await delay(backoffMs);
      const bodyChanged =
        canonicalizeLinksForCompare(currentBody) !==
        canonicalizeLinksForCompare(desiredBody);
      if (propChanges.length === 0 && !bodyChanged && !iconChanged) {
        counts.unchanged++;
        continue;
      }
      const changes = [...propChanges];
      if (iconChanged) {
        changes.push(`Icon: ${currentIcon || "(none)"} → ${desiredIcon}`);
      }
      if (bodyChanged) changes.push("Body: rewritten from Linear");
      counts.actions.push(`~ update ${values.Project} (${changes.join("; ")})`);
      counts.updated++;
      if (dryRun) continue;
      if (propChanges.length > 0) {
        await db.updatePage(page.id, toPayload(values), CONFIG_KEY);
        await delay(backoffMs);
      }
      if (iconChanged) {
        await db.setPageIcon(page.id, desiredIcon);
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
