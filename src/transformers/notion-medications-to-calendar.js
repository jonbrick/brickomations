// Transforms Medications Notion records to Calendar events

const config = require("../config");
const { resolveCalendarId } = require("../utils/calendar-mapper");
const { classifyDayStatus } = require("../utils/day-status");

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
 * Model (2026-11): the day's `Status` formula is the contract. It folds the
 * AM Meds / PM Meds / AM Meds Skipped / PM Meds Skipped / No Meds checkboxes
 * into one string (see utils/day-status.js); only a resolved day — taken,
 * morning only, evening only — becomes an event. A day with one batch still
 * pending gets no event yet: this sync creates each day's event once and
 * never rewrites it, so writing "(AM)" at breakfast would freeze the day
 * there. Skipped and not-logged days get no event. Conflict and unrecognised
 * strings skip with a reason that names them; a missing Status throws, since
 * the formula is the contract.
 *
 * The AM/PM Medication List formula strings hold what was actually taken — a
 * single skipped med is removed from that day's relation.
 *
 * @param {Object} record - Notion page object
 * @param {Object} repo - IntegrationDatabase instance
 * @returns {Object} { calendarId, event } or { skipped: true, reason }
 */
function transformMedicationToCalendarEvent(record, repo) {
  const props = config.notion.properties.medications;
  const get = (prop) =>
    repo.extractProperty(record, config.notion.getPropertyName(prop));

  const date = get(props.date);
  if (!date) return { skipped: true, reason: "Missing date" };

  const status = classifyDayStatus(get(props.status));
  if (status.kind === "missing") {
    throw new Error(
      `Medications record for ${date} has no Status value — the Status formula on the 💊 2026 Medication DB is the sync contract`
    );
  }
  if (status.kind === "conflict") {
    return {
      skipped: true,
      reason: `Status ${status.raw} — a batch is both taken and skipped`,
    };
  }
  if (status.kind === "unknown") {
    return {
      skipped: true,
      reason: `Unknown Status "${status.raw}" — teach src/utils/day-status.js the new string`,
    };
  }
  // skipped · pending · not-logged → no event (yet).
  if (!status.am && !status.pm) {
    return { skipped: true, reason: `Status ${status.raw}` };
  }

  const calendarId = resolveCalendarId("medications", record, repo);
  if (!calendarId) {
    throw new Error(
      "Medications calendar ID not configured. Set MEDICATIONS_CALENDAR_ID in .env file."
    );
  }

  // Title reflects which batches were taken (AM / PM / AM + PM).
  const tags = [];
  if (status.am) tags.push("AM");
  if (status.pm) tags.push("PM");

  // Prefix must match ADDITIONAL_EMOJI_PREFIXES in config/calendar/summary-emoji-prefixes.js so yarn summarize can strip it.
  const summary = `💊 Medications (${tags.join(" + ")})`;

  // One line per batch: the taken list, or ❌ skipped for the batch that
  // wasn't (only a resolved day gets this far, so "not taken" = skipped).
  const batchLine = (label, taken, list) => {
    if (!taken) return `${label}: ❌ skipped`;
    const meds = parseMedList(list);
    return meds.length ? `${label}: ${meds.map((m) => `✅ ${m}`).join(", ")}` : null;
  };
  const description = [
    batchLine("AM", status.am, get(props.amMedList)),
    batchLine("PM", status.pm, get(props.pmMedList)),
  ]
    .filter(Boolean)
    .join("\n");

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
