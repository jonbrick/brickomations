/**
 * @fileoverview Linear Mirror Database Configuration
 *
 * Read-only Notion mirror of Linear issues so work state is readable on
 * the phone without MCP or API calls (Linear → Notion → local). Upserted
 * by cli/pull-linear.js on `Linear ID`; rows are never deleted, only
 * marked with Linear Status "Gone" when an issue falls out of the pull
 * (closed past the completed window, archived, or unassigned).
 */

module.exports = {
  database: process.env.NOTION_LINEAR_MIRROR_DATABASE_ID,

  properties: {
    task: { name: "Task", type: "title", enabled: true },
    linearId: { name: "Linear ID", type: "rich_text", enabled: true },
    linearStatus: { name: "Linear Status", type: "select", enabled: true },
    updated: { name: "Updated", type: "date", enabled: true },
    dueDate: { name: "Due Date", type: "date", enabled: true },
    priority: { name: "Priority", type: "select", enabled: true },
    weekNumber: { name: "Week Number", type: "select", enabled: true },
    project: { name: "Project", type: "select", enabled: true },
    team: { name: "Team", type: "select", enabled: true },
    url: { name: "URL", type: "url", enabled: true },
  },
};
