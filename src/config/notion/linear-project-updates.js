/**
 * @fileoverview Linear project updates → 📣 2026 Project Updates Sync Configuration
 *
 * Linear "Project update" posts — every author — on the projects
 * 2026 Projects syncs (all PD-only projects, DE projects Jon leads), one row
 * per post — the day-by-day record of what moved, readable on the phone
 * and pulled down to data/life.json (`projectUpdates`) by `yarn pull`.
 * Same Linear → Notion → local pattern as linear-tasks / linear-projects.
 *
 * Field ownership — the sync owns every column and the page body: Name
 * (project name + post date), Date (NY-local post date), 💎 2026 Projects
 * (relation, resolved through the project row's Linear ID), Author
 * (select — the poster's Linear display name), Health,
 * Changes (Linear's auto-generated diff — status, dates, progress),
 * Linear ID (the update UUID — idempotency key), Linear URL. The page body
 * is the post itself. Edits belong in Linear; Notion edits get reverted.
 *
 * Upserted by cli/pull-linear.js on `Linear ID`. Rows are never deleted
 * and never marked gone: the pull only looks back a window, so a row
 * outside it is history, not a disappearance.
 */

module.exports = {
  database: process.env.NOTION_PROJECT_UPDATES_DATABASE_ID,

  properties: {
    name: { name: "Name", type: "title", enabled: true },
    date: { name: "Date", type: "date", enabled: true },
    project: { name: "💎 2026 Projects", type: "relation", enabled: true },
    author: { name: "Author", type: "select", enabled: true },
    health: { name: "Health", type: "select", enabled: true },
    changes: { name: "Changes", type: "rich_text", enabled: true },
    linearId: { name: "Linear ID", type: "rich_text", enabled: true },
    linearUrl: { name: "Linear URL", type: "url", enabled: true },
  },
};
