// Transforms Supplements Notion records to Calendar events

const config = require("../config");
const { SUPPLEMENT_ROUTINE } = require("../config/notion/supplements");
const { resolveCalendarId } = require("../utils/calendar-mapper");
const { classifyDayStatus } = require("../utils/day-status");

/**
 * Build a "AM: ✅ B-Complex, ❌ Creatine" line for a taken batch.
 * Items present in `skipped` flip from ✅ to ❌.
 */
function buildBatchLine(label, items, skipped) {
  const skipSet = new Set(skipped || []);
  const parts = items.map((item) => `${skipSet.has(item) ? "❌" : "✅"} ${item}`);
  return `${label}: ${parts.join(", ")}`;
}

/**
 * Transform Notion supplement record to Google Calendar event.
 *
 * Model (2026-11): the day's `Status` formula is the contract. It folds the
 * AM Supps / PM Supps / AM Supps Skipped / PM Supps Skipped / No Supps
 * checkboxes into one string (see utils/day-status.js); only a resolved day
 * — taken, morning only, evening only — becomes an event. A day with one
 * batch still pending gets no event yet: this sync creates each day's event
 * once and never rewrites it. Skipped and not-logged days get no event.
 * Conflict and unrecognised strings skip with a reason that names them; a
 * missing Status throws.
 *
 * Inside a taken batch, the AM Skipped / PM Skipped multi-selects name the
 * individual items missed (matched against SUPPLEMENT_ROUTINE).
 *
 * @param {Object} record - Notion page object
 * @param {Object} repo - IntegrationDatabase instance
 * @returns {Object} { calendarId, event } or { skipped: true, reason }
 */
function transformSupplementToCalendarEvent(record, repo) {
  const props = config.notion.properties.supplements;
  const get = (prop) =>
    repo.extractProperty(record, config.notion.getPropertyName(prop));

  const date = get(props.date);
  if (!date) return { skipped: true, reason: "Missing date" };

  const status = classifyDayStatus(get(props.status));
  if (status.kind === "missing") {
    throw new Error(
      `Supplements record for ${date} has no Status value — the Status formula on the 🍬 2026 Supplements DB is the sync contract`
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

  const amSkipped = get(props.amSkipped) || [];
  const pmSkipped = get(props.pmSkipped) || [];

  const calendarId = resolveCalendarId("supplements", record, repo);
  if (!calendarId) {
    throw new Error(
      "Supplements calendar ID not configured. Set SUPPLEMENTS_CALENDAR_ID in .env file."
    );
  }

  // Title reflects which batches were taken (AM / PM / AM + PM) plus, when a
  // taken batch wasn't fully compliant, the items skipped within it:
  //   ≤2 skips → names them; 3+ → a count.
  const tags = [];
  if (status.am) tags.push("AM");
  if (status.pm) tags.push("PM");

  // Unique skipped items across the taken batches, in routine order.
  const skipped = [];
  const seenSkips = new Set();
  const collectSkips = (on, list) => {
    if (!on) return;
    for (const item of list) {
      if (!seenSkips.has(item)) {
        seenSkips.add(item);
        skipped.push(item);
      }
    }
  };
  collectSkips(status.am, amSkipped);
  collectSkips(status.pm, pmSkipped);

  let skipPart = "";
  if (skipped.length === 1 || skipped.length === 2) {
    skipPart = ` · skipped ${skipped.join(", ")}`;
  } else if (skipped.length >= 3) {
    skipPart = ` · ${skipped.length} skipped`;
  }

  // Prefix must match ADDITIONAL_EMOJI_PREFIXES in config/calendar/summary-emoji-prefixes.js so yarn summarize can strip it.
  const summary = `🍬 Supplements (${tags.join(" + ")}${skipPart})`;

  // One line per batch: the routine with misses flipped to ❌, or ❌ skipped
  // for the batch that wasn't taken (a resolved day's "not taken" = skipped).
  const lines = [
    status.am ? buildBatchLine("AM", SUPPLEMENT_ROUTINE.am, amSkipped) : "AM: ❌ skipped",
    status.pm ? buildBatchLine("PM", SUPPLEMENT_ROUTINE.pm, pmSkipped) : "PM: ❌ skipped",
  ];
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
  transformSupplementToCalendarEvent,
};
