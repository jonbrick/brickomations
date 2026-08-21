/**
 * @fileoverview Linear projects → 2026 Projects Sync Configuration
 *
 * Linear projects upsert directly into the shared 2026 Projects database —
 * same pattern as linear-tasks: no mirror DB, Notion is the one holistic
 * layer (Linear → Notion → local) so work projects are readable on the
 * phone without MCP or API calls.
 *
 * The database is the same 2026 Projects DB that `yarn pull` reads as
 * "Personal Projects" — NOTION_PERSONAL_PROJECTS_DATABASE_ID predates work
 * rows landing here; it's the whole 2026 Projects DB, not a personal-only
 * one. Reused deliberately: no new env var on either machine.
 *
 * Field ownership — the sync owns columns, not rows:
 *   - Sync-owned (overwritten every run): Project, Status, Date, Priority,
 *     Linear ID (the idempotency key), Linear URL.
 *   - Jon-owned (never touched): Category (set to 💼 Work on create only),
 *     Work Category, Problem, Description, Lead, Goal/Products/Tasks
 *     relations, everything else.
 *   - Rows without a Linear ID (all personal projects) are invisible to
 *     the sync.
 *
 * Upserted by cli/pull-linear.js on `Linear ID` (project UUID — projects
 * have no DSGN-123-style identifier); rows are never deleted, only marked
 * 🫥 Gone when a project falls out of the pull (archived, or Jon removed
 * from it — settled rows keep 🟢 Done / ❌ Canceled).
 */

module.exports = {
  database: process.env.NOTION_PERSONAL_PROJECTS_DATABASE_ID,

  properties: {
    project: { name: "Project", type: "title", enabled: true },
    status: { name: "Status", type: "status", enabled: true },
    date: { name: "Date", type: "date", enabled: true },
    priority: { name: "Priority", type: "select", enabled: true },
    linearId: { name: "Linear ID", type: "rich_text", enabled: true },
    linearUrl: { name: "Linear URL", type: "url", enabled: true },
    category: { name: "Category", type: "select", enabled: true },
  },
};
