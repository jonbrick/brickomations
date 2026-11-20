// Upserts Linear project-update posts (every author, on the projects the
// pull syncs) into the 📣 2026 Project Updates Notion DB — one row per
// post, related to its 💎 2026 Projects row (Linear → Notion → local,
// same as tasks and projects).
//
// Field ownership — the sync owns every column and the page body: Name,
// Date, 💎 2026 Projects, Author, Health, Changes, Linear ID, Linear URL, and the
// body (the post's markdown). Editing them in Notion gets reverted next
// run — that edit belongs in Linear.
//
// Reconciliation rules:
//   - Upsert on `Linear ID` (the update UUID) — two consecutive runs
//     produce identical state.
//   - The relation resolves through the 2026 Projects row whose Linear ID
//     is the post's project UUID. The projects leg runs first in the same
//     pull, so every post on a synced project finds its row.
//   - No gone pass: the pull looks back a window (14 days scheduled, wider
//     for a backfill), so a row outside it is history, not a removal. A
//     post deleted in Linear keeps its Notion row — retiring it is a manual
//     [DELETE] pass.
//   - Read-only sync: no write-back to Linear, ever.
//
// @layer 2 - Workflow

const NotionDatabase = require("../databases/NotionDatabase");
const config = require("../config");
const { delay } = require("../utils/async");
const {
  markdownToBlocks,
  blocksToMarkdown,
  chunkRichText,
  normalizedBody,
  canonicalizeLinksForCompare,
} = require("../utils/notion-content");

const CONFIG_KEY = "linearProjectUpdates";
const PROJECTS_CONFIG_KEY = "linearProjects";
const RELATION = "💎 2026 Projects";

const HEALTH_LABELS = {
  onTrack: "🟢 On track",
  atRisk: "🟡 At risk",
  offTrack: "🔴 Off track",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Thu 2026-11-19" for a YYYY-MM-DD date (weekday computed in UTC — date-only, no zone drift). */
function absoluteDate(day) {
  if (!day) return "";
  return `${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]} ${day}`;
}

/**
 * The post body as written to the page. Linear upload images can't render
 * in Notion (their URLs need a Linear session), so each becomes a plain
 * link to the upload instead of a broken image block.
 */
function bodyMarkdown(markdown) {
  return (markdown || "").replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt, url) => `[🖼️ ${alt || "image"}](${url})`
  );
}

/**
 * Linear's diff list as plain text — a rich_text property shows markdown
 * emphasis as literal asterisks ("**Status**: Planned" → "Status: Planned").
 */
function plainChanges(diffMarkdown) {
  return (diffMarkdown || "").replace(/\*+/g, "");
}

/** Plain string values for change detection; Project is the related page ID ("" if unresolved). */
function syncedValues(update, projectPageId) {
  return {
    Name: `${update.Project} — ${absoluteDate(update.Date)}`,
    Date: update.Date,
    Project: projectPageId || "",
    Author: update.Author || "",
    Health: HEALTH_LABELS[update.Health] || "",
    Changes: plainChanges(update.Changes),
    "Linear ID": update.Id,
    "Linear URL": update.URL,
  };
}

/** The page's current sync-owned values, shaped exactly like syncedValues. */
function currentValues(db, page) {
  const relation = page.properties[RELATION]?.relation || [];
  return {
    Name: db.extractProperty(page, "Name") || "",
    Date: db.extractProperty(page, "Date") || "",
    // Notion returns dashed UUIDs; one project per post.
    Project: relation.map((r) => r.id.replace(/-/g, "")).join(","),
    Author: db.extractProperty(page, "Author") || "",
    Health: db.extractProperty(page, "Health") || "",
    Changes: db.extractProperty(page, "Changes") || "",
    "Linear ID": db.extractProperty(page, "Linear ID") || "",
    "Linear URL": db.extractProperty(page, "Linear URL") || "",
  };
}

function toPayload(values) {
  return {
    Name: { title: [{ text: { content: values.Name } }] },
    Date: { date: values.Date ? { start: values.Date } : null },
    [RELATION]: {
      relation: values.Project ? [{ id: values.Project }] : [],
    },
    Author: { select: values.Author ? { name: values.Author } : null },
    Health: { select: values.Health ? { name: values.Health } : null },
    Changes: { rich_text: chunkRichText(values.Changes) },
    "Linear ID": { rich_text: [{ text: { content: values["Linear ID"] } }] },
    "Linear URL": { url: values["Linear URL"] },
  };
}

function changedFields(current, values) {
  return Object.entries(values)
    .filter(([name, value]) => current[name] !== value)
    .map(([name]) => name);
}

/**
 * @param {Array} updates - Records from pull-linear's toProjectUpdateSyncRecord
 * @param {{dryRun?: boolean}} [opts] - dryRun reads Notion and reports the
 *   plan without writing a thing.
 * @returns {Promise<{created: number, updated: number, unchanged: number, unlinked: number, actions: string[]}>}
 */
async function syncLinearProjectUpdates(updates, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const databaseId = config.notion.databases[CONFIG_KEY];
  if (!databaseId) {
    throw new Error(
      "NOTION_PROJECT_UPDATES_DATABASE_ID is required (Notion database ID of 📣 2026 Project Updates)"
    );
  }
  const projectsDatabaseId = config.notion.databases[PROJECTS_CONFIG_KEY];

  const db = new NotionDatabase();
  const backoffMs = config.sources.rateLimits.notion.backoffMs;

  // Linear project UUID → 2026 Projects page ID (undashed).
  const projectPages = await db.queryDatabaseAll(projectsDatabaseId, {
    property: "Linear ID",
    rich_text: { is_not_empty: true },
  });
  const projectPageByLinearId = new Map();
  for (const page of projectPages) {
    const linearId = db.extractProperty(page, "Linear ID");
    if (linearId) projectPageByLinearId.set(linearId, page.id.replace(/-/g, ""));
  }

  const existingPages = await db.queryDatabaseAll(databaseId);
  const pagesByLinearId = new Map();
  for (const page of existingPages) {
    const linearId = db.extractProperty(page, "Linear ID");
    if (linearId) pagesByLinearId.set(linearId, page);
  }

  const counts = { created: 0, updated: 0, unchanged: 0, unlinked: 0, actions: [] };

  for (const update of updates) {
    if (!update.Id) continue;

    const projectPageId = projectPageByLinearId.get(update["Project Id"]);
    if (!projectPageId) counts.unlinked++;
    const values = syncedValues(update, projectPageId);
    const body = bodyMarkdown(update.Body);
    const desiredBlocks = markdownToBlocks(body);
    const desiredBody = normalizedBody(body);
    const page = pagesByLinearId.get(update.Id);
    const unlinkedNote = projectPageId ? "" : " (no 2026 Projects row — relation left empty)";

    if (!page) {
      counts.actions.push(`+ create ${values.Name}${unlinkedNote}`);
      counts.created++;
      if (dryRun) continue;
      const created = await db.createPage(databaseId, toPayload(values), [], CONFIG_KEY);
      // Body via replacePageContent, not createPage children — the create
      // endpoint caps children at 100 blocks; replace appends in batches.
      if (desiredBlocks.length > 0) {
        await delay(backoffMs);
        await db.replacePageContent(created.id, desiredBlocks);
      }
      await delay(backoffMs);
      continue;
    }

    const propChanges = changedFields(currentValues(db, page), values);
    const currentBody = blocksToMarkdown(await db.getPageBlocks(page.id)).trim();
    await delay(backoffMs);
    const bodyChanged =
      canonicalizeLinksForCompare(currentBody) !==
      canonicalizeLinksForCompare(desiredBody);
    if (propChanges.length === 0 && !bodyChanged) {
      counts.unchanged++;
      continue;
    }
    const changes = [...propChanges];
    if (bodyChanged) changes.push("Body");
    counts.actions.push(`~ update ${values.Name} (${changes.join(", ")})${unlinkedNote}`);
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

  return counts;
}

module.exports = {
  syncLinearProjectUpdates,
  // Exported for tests.
  absoluteDate,
  bodyMarkdown,
  syncedValues,
  HEALTH_LABELS,
};
