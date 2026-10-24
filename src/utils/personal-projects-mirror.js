/**
 * @layer 0 - Local (Brickography)
 *
 * Pure helpers for mirroring the personal side of Notion `2026 Projects` to
 * markdown under `<brickography>/projects/<todo|doing|done>/<Title>.md`.
 *
 * Notion is the record. The files are a read-only copy — frontmatter from the
 * row's properties, body from the page content `yarn pull` caches as
 * `_content`. Edit in Notion; the next sync overwrites the file. Renaming the
 * project in Notion renames the file; changing Status moves it between
 * buckets. No slugs, no aliases, nothing to reconcile by hand.
 *
 * Work rows (Linear-synced, Category 💼 Work) are not mirrored — their bodies
 * belong to the Linear → Notion sync and the vault holds their briefs.
 */

const PERSONAL_CATEGORY = "🌱 Personal";

/** Notion Status (emoji stripped) → folder bucket. Unmapped → null. */
const BUCKETS = {
  Icebox: "todo",
  "To Do": "todo",
  Doing: "doing",
  Ongoing: "doing",
  Paused: "doing",
  Done: "done",
  Canceled: "done",
  Gone: "done",
};

/** Strip a leading emoji prefix ("🔴 To Do" → "To Do"). */
function stripEmoji(str) {
  return String(str || "").replace(/^[^\x00-\x7F]+\s*/, "").trim();
}

function bucketFor(status) {
  return BUCKETS[stripEmoji(status)] || null;
}

function isPersonal(record) {
  return (record?.Category || "") === PERSONAL_CATEGORY;
}

/**
 * Filesystem-safe filename from the Notion title. Characters that break
 * paths or iCloud become "-"; whitespace collapses; a blank title falls back
 * to the Notion id so the file still has a stable name.
 */
function fileNameFor(title, notionId) {
  let base = String(title || "")
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  if (!base) base = `untitled-${shortId(notionId)}`;
  return `${base}.md`;
}

function shortId(notionId) {
  return String(notionId || "").replace(/-/g, "").slice(0, 8);
}

function yamlStr(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;
}

function yamlList(values) {
  const items = (values || []).filter(Boolean).map(yamlStr);
  return `[${items.join(", ")}]`;
}

function notionUrlFor(notionId) {
  const id = String(notionId || "").replace(/-/g, "");
  return id ? `https://www.notion.so/${id}` : "";
}

/**
 * Render one project record to markdown. `goalTitles` is the list of goal
 * titles the row relates to (resolved by the caller from life.json goals).
 * `sync_hash` is left empty; vault-sync fills it from the rendered content.
 */
function renderProject(record, goalTitles = []) {
  const title = record.Project || "";
  const frontmatter = [
    "---",
    `title: ${yamlStr(title)}`,
    "type: personal-project",
    `status: ${yamlStr(stripEmoji(record.Status))}`,
    `priority: ${yamlStr((record.Priority || "").toLowerCase())}`,
    `personal_category: ${yamlStr(stripEmoji(record["Personal Category"]))}`,
    `lead: ${yamlStr(record.Lead || "")}`,
    `goals: ${yamlList(goalTitles)}`,
    `date: ${yamlStr(record.Date || "")}`,
    `achieved_date: ${yamlStr(record["Achieved Date"] || "")}`,
    `description: ${yamlStr(record.Description || "")}`,
    `notion_url: ${yamlStr(notionUrlFor(record._notionId))}`,
    `notion_id: ${yamlStr(record._notionId || "")}`,
    `last_edited: ${yamlStr(record._notionEditedTime || "")}`,
    'sync_hash: ""',
    "---",
  ].join("\n");

  const body = String(record._content || "").trim();
  return body ? `${frontmatter}\n\n${body}\n` : `${frontmatter}\n`;
}

/** "<bucket>/<file>" for a record, or null when its Status has no bucket. */
function expectedRelPath(record) {
  const bucket = bucketFor(record.Status);
  if (!bucket) return null;
  return `${bucket}/${fileNameFor(record.Project, record._notionId)}`;
}

module.exports = {
  PERSONAL_CATEGORY,
  BUCKETS,
  stripEmoji,
  bucketFor,
  isPersonal,
  fileNameFor,
  shortId,
  renderProject,
  expectedRelPath,
  notionUrlFor,
};
