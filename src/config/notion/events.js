/**
 * @fileoverview Events Database Configuration
 * @layer 1 - API → Notion (Integration name)
 *
 * Purpose: Defines Notion database properties and field mappings for Events database
 *
 * Responsibilities:
 * - Define database ID (from environment variable)
 * - Define property names and types
 * - Define field mappings for data transformation
 *
 * Data Flow:
 * - Used by: EventsDatabase, notion-events-to-calendar-events transformer
 * - Naming: Uses INTEGRATION name (events)
 *
 * Example:
 * ```
 * const config = require('./config/notion');
 * const dbId = config.databases.events;
 * ```
 */

module.exports = {
  database: process.env.NOTION_EVENTS_DATABASE_ID,

  properties: {
    eventName: { name: "Event Name", type: "title", enabled: true },
    status: { name: "Status", type: "select", enabled: true },
    category: { name: "Category", type: "select", enabled: true },
    date: { name: "Date", type: "date", enabled: true },
    // Two side-scoped type columns (restructured Fri 2026-10-16): the former
    // Subcategory was renamed PERSONAL Category — same property id, so the Weeks
    // rollup formulas still resolve — and its five work types moved to WORK
    // Category. Category itself is just the side.
    personalCategory: { name: "PERSONAL Category", type: "select", enabled: true },
    workCategory: { name: "WORK Category", type: "select", enabled: true },
    description: { name: "Description", type: "rich_text", enabled: true },
    calendarEventId: {
      name: "Calendar Event ID",
      type: "rich_text",
      enabled: true,
    },
  },
};
