/**
 * @fileoverview Linear → 2026 Tasks Sync Configuration
 *
 * Linear issues upsert directly into the shared 2026 Tasks database — no
 * separate mirror DB. Notion is the one holistic layer (Linear → Notion →
 * local) so work state is readable on the phone without MCP or API calls.
 *
 * Field ownership — in a shared DB the sync owns columns, not rows:
 *   - Sync-owned (overwritten every run): Task, Status, Due Date, Priority,
 *     Linear ID (the idempotency key), Linear URL.
 *   - Jon-owned (never touched): Category (set to 💼 Work on create only),
 *     WORK Category, Notes, Projects/Goals/Rocks relations, everything else.
 *   - Rows without a Linear ID (the flexible 20%) are invisible to the sync.
 *
 * Upserted by cli/pull-linear.js on `Linear ID`; rows are never deleted,
 * only marked 🫥 Gone when an issue falls out of the pull (archived or
 * unassigned — settled rows keep 🟢 Done / 🛑 Canceled).
 */

module.exports = {
  database: process.env.TASKS_DATABASE_ID,

  properties: {
    task: { name: "Task", type: "title", enabled: true },
    status: { name: "Status", type: "status", enabled: true },
    dueDate: { name: "Due Date", type: "date", enabled: true },
    priority: { name: "Priority", type: "select", enabled: true },
    linearId: { name: "Linear ID", type: "rich_text", enabled: true },
    linearUrl: { name: "Linear URL", type: "url", enabled: true },
    category: { name: "Category", type: "select", enabled: true },
  },
};
