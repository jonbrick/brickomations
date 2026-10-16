// Transforms Trips Notion records to Calendar events

const config = require("../config");
const { resolveCalendarId } = require("../utils/calendar-mapper");
const {
  getColorIdFromNotionCategory,
} = require("../config/calendar/color-mappings");
const { CALENDAR_SKIP_STATUSES } = require("../config/notion/task-categories");
const { addOneDay } = require("../utils/date");

/**
 * Extract emoji from subcategory (e.g., "🎸 Concerts" → "🎸")
 * Uses Unicode emoji regex to properly handle multi-byte emojis
 * @param {string|Array|null} subcategory - Subcategory value from Notion
 * @returns {string} Emoji with space, or empty string
 */
function extractEmoji(subcategory) {
  // Handle arrays (multi-select returns array)
  const value = Array.isArray(subcategory) ? subcategory[0] : subcategory;
  if (!value || typeof value !== "string") return "";
  const match = value.match(/^(\p{Emoji})/u);
  return match ? match[1] + " " : "";
}

/**
 * Transform Notion trip record to Google Calendar event
 * @param {Object} record - Notion page object
 * @param {Object} repo - IntegrationDatabase instance
 * @returns {Object} { calendarId, event }, or { skipped: true, reason } when the
 *   record must not reach the calendar (skip status, missing date or name)
 */
function transformTripToCalendarEvent(record, repo) {
  const props = config.notion.properties.trips;

  // Skip records with status in calendar skip list (e.g. Ice Box, Next Year)
  const status = repo.extractProperty(
    record,
    config.notion.getPropertyName(props.status)
  );
  if (status && CALENDAR_SKIP_STATUSES.includes(status)) {
    // Named skip: the workflow logs the record + this reason instead of the
    // source's one generic skipReason ("Unknown - Missing date or trip name").
    return { skipped: true, reason: `Status ${status}` };
  }

  // Extract properties using config property names
  const tripName = repo.extractProperty(
    record,
    config.notion.getPropertyName(props.tripName)
  );
  const category = repo.extractProperty(
    record,
    config.notion.getPropertyName(props.category)
  );
  const subcategory = repo.extractProperty(
    record,
    config.notion.getPropertyName(props.subcategory)
  );
  // Two-field model: the lane (PERSONAL Category / WORK Category) carries the
  // color and rides the description; Category is just the side.
  const lane =
    repo.extractProperty(
      record,
      config.notion.getPropertyName(props.personalCategory)
    ) ||
    repo.extractProperty(
      record,
      config.notion.getPropertyName(props.workCategory)
    ) ||
    null;
  const description = repo.extractProperty(
    record,
    config.notion.getPropertyName(props.description)
  );

  // Extract date range
  const dateRange = repo.extractDateRange(
    record,
    config.notion.getPropertyName(props.date)
  );
  if (!dateRange || !tripName) {
    return { skipped: true, reason: !dateRange ? "Missing date" : "Missing trip name" };
  }

  // Build summary with emoji prefix extracted from subcategory
  const emoji = extractEmoji(subcategory);
  const summary = `${emoji}${tripName}`;

  // Build description
  const descParts = [];
  if (description) descParts.push(description);
  if (category) descParts.push(`Category: ${category}${lane ? ` · ${lane}` : ""}`);
  if (subcategory) descParts.push(`Type: ${subcategory}`);

  // Build event object
  // Google Calendar all-day events use exclusive end dates
  const event = {
    summary,
    description: descParts.join("\n"),
    start: { date: dateRange.start },
    end: { date: addOneDay(dateRange.end) },
  };

  // Add color if mapped (lane > side)
  const colorId = getColorIdFromNotionCategory(category, lane);
  if (colorId) {
    event.colorId = colorId;
  }

  // Resolve calendar ID
  const calendarId = resolveCalendarId("trips", record, repo);
  if (!calendarId) {
    throw new Error(
      "Trips calendar ID not configured. Set TRIPS_CALENDAR_ID in .env file."
    );
  }

  return {
    calendarId,
    event,
  };
}

module.exports = {
  transformTripToCalendarEvent,
};
