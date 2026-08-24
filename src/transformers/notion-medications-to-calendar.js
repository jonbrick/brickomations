// Transforms Medications Notion records to Calendar events

const config = require("../config");
const { resolveCalendarId } = require("../utils/calendar-mapper");

/**
 * Parse an "AM Medication List" formula string ("Gabapentin, Sertraline")
 * into med names. Empty relation → empty string → [].
 */
function parseMedList(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Transform Notion medication record to Google Calendar event.
 *
 * Model: assume-the-routine, log-exceptions, per-day regimen. The day's
 * AM/PM Medication relations (read via the AM/PM Medication List formula
 * strings) hold what was actually taken — a skipped med is removed from the
 * day's relation. AM Meds / PM Meds say which batch was taken; `No Meds`
 * overrides everything.
 *
 * @param {Object} record - Notion page object
 * @param {Object} repo - IntegrationDatabase instance
 * @returns {Object|null} Object with { calendarId, event } or null if skip
 */
function transformMedicationToCalendarEvent(record, repo) {
  const props = config.notion.properties.medications;
  const get = (prop) =>
    repo.extractProperty(record, config.notion.getPropertyName(prop));

  const date = get(props.date);
  if (!date) return null;

  // No Meds overrides everything → no event.
  if (get(props.noMeds)) return null;

  const amOn = !!get(props.amMeds);
  const pmOn = !!get(props.pmMeds);

  // Nothing taken → skip.
  if (!amOn && !pmOn) return null;

  const amMedList = parseMedList(get(props.amMedList));
  const pmMedList = parseMedList(get(props.pmMedList));

  const calendarId = resolveCalendarId("medications", record, repo);
  if (!calendarId) {
    throw new Error(
      "Medications calendar ID not configured. Set MEDICATIONS_CALENDAR_ID in .env file."
    );
  }

  // Title reflects which batches were taken (AM / PM / AM + PM).
  const tags = [];
  if (amOn) tags.push("AM");
  if (pmOn) tags.push("PM");

  // Prefix must match ADDITIONAL_EMOJI_PREFIXES in config/calendar/summary-emoji-prefixes.js so yarn summarize can strip it.
  const summary = `💊 Medications (${tags.join(" + ")})`;

  const lines = [];
  if (amOn && amMedList.length) {
    lines.push(`AM: ${amMedList.map((m) => `✅ ${m}`).join(", ")}`);
  }
  if (pmOn && pmMedList.length) {
    lines.push(`PM: ${pmMedList.map((m) => `✅ ${m}`).join(", ")}`);
  }
  const description = lines.join("\n");

  const dateStr = typeof date === "string" ? date.split("T")[0] : date;

  return {
    calendarId,
    event: {
      summary,
      description,
      start: { date: dateStr },
      end: { date: dateStr },
    },
  };
}

module.exports = {
  transformMedicationToCalendarEvent,
};
