/**
 * @fileoverview Trips Database Configuration
 * @layer 1 - API → Notion (Integration name)
 *
 * Purpose: Defines Notion database properties and field mappings for Trips database
 *
 * Responsibilities:
 * - Define database ID (from environment variable)
 * - Define property names and types
 * - Define field mappings for data transformation
 *
 * Data Flow:
 * - Used by: TripsDatabase, notion-trips-to-calendar-trips transformer
 * - Naming: Uses INTEGRATION name (trips)
 *
 * Example:
 * ```
 * const config = require('./config/notion');
 * const dbId = config.databases.trips;
 * ```
 */

module.exports = {
  database: process.env.NOTION_TRIPS_DATABASE_ID,

  properties: {
    tripName: { name: "Trip Name", type: "title", enabled: true },
    status: { name: "Status", type: "select", enabled: true },
    category: { name: "Category", type: "select", enabled: true },
    date: { name: "Date", type: "date", enabled: true },
    // One combined type list (multi-select); Category is the side. The two
    // lane columns briefly added on 2026-10-16 were dropped the same day.
    subcategory: { name: "Subcategory", type: "select", enabled: true },
    emoji: { name: "Emoji", type: "rich_text", enabled: true },
    description: { name: "Description", type: "rich_text", enabled: true },
    calendarEventId: {
      name: "Calendar Event ID",
      type: "rich_text",
      enabled: true,
    },
  },
};
