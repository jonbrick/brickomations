/**
 * @layer 2 - Domain
 *
 * Apply one action to a `Planned:` placeholder on the main personal calendar.
 * Shared by scripts/reconcile-planned-events.js and the reset:apply CLI.
 *
 * Actions:
 *   delete      → Google Calendar trash
 *   relabel     → same slot, newSummary
 *   move        → onto a manual-habit calendar (targetKey) as newSummary, then delete
 *   reschedule  → same summary at newStart/newEnd on the main calendar, then delete
 *
 * Before every mutate the event is re-fetched; anything whose live summary no
 * longer starts with "Planned:" (or is already gone) is skipped, so a wrong or
 * stale id can't touch a real event. Returns structured data — callers print.
 */

const { TARGET_CALENDARS, isPlanned, stripPlanned } = require("../utils/planned-events");

/** Re-fetch and confirm the event is still a Planned placeholder. */
async function guard(svc, calendarId, id) {
  const ev = await svc.getEvent(calendarId, id);
  if (!ev || ev.status === "cancelled") return { ok: false, reason: "not found (already gone?)" };
  if (!isPlanned(ev.summary)) return { ok: false, reason: `live summary is not Planned: "${ev.summary}"`, ev };
  return { ok: true, ev };
}

function carry(ev) {
  return {
    ...(ev.description ? { description: ev.description } : {}),
    ...(ev.location ? { location: ev.location } : {}),
  };
}

const TIME_ZONE = "America/New_York";

/** Google Calendar start/end object from an ISO string or a YYYY-MM-DD date. */
function toGcalTime(value) {
  return String(value).includes("T") ? { dateTime: value, timeZone: TIME_ZONE } : { date: value };
}

/**
 * @param {Object} svc - GoogleCalendarService("personal")
 * @param {string} calendarId - the main personal calendar id
 * @param {Object} item - { id, action, summary?, newSummary?, targetKey?, newStart?, newEnd? }
 * @param {{dryRun?: boolean}} opts
 * @returns {Promise<{result: string, message: string}>} result is the action taken or "skipped"
 */
async function applyPlannedAction(svc, calendarId, item, { dryRun = false } = {}) {
  const { id, action, summary = "" } = item;
  const label = summary || id;
  const would = dryRun ? "WOULD " : "";

  if (!id || !action) return { result: "skipped", message: `missing id/action: ${JSON.stringify(item)}` };
  if (action === "review") return { result: "skipped", message: `${label} — still "review"; resolve it before applying` };
  if (!["delete", "relabel", "move", "reschedule"].includes(action)) {
    return { result: "skipped", message: `${label} — unknown action "${action}"` };
  }

  const g = await guard(svc, calendarId, id);
  if (!g.ok) return { result: "skipped", message: `${label} — ${g.reason}` };
  const ev = g.ev;

  if (action === "delete") {
    if (!dryRun) await svc.deleteEvent(calendarId, id);
    return { result: "deleted", message: `${would}DELETE  ${ev.summary}` };
  }

  if (action === "relabel") {
    if (!item.newSummary) return { result: "skipped", message: `relabel ${label} — no newSummary` };
    if (!dryRun) {
      await svc.updateEvent(calendarId, id, { summary: item.newSummary, start: ev.start, end: ev.end, ...carry(ev) });
    }
    return { result: "relabeled", message: `${would}RELABEL  ${ev.summary}  →  ${item.newSummary}` };
  }

  if (action === "move") {
    const envVar = TARGET_CALENDARS[item.targetKey];
    const targetId = envVar && process.env[envVar];
    if (!targetId) return { result: "skipped", message: `move ${label} — no target calendar for key "${item.targetKey}"` };
    const newSummary = item.newSummary || stripPlanned(ev.summary);
    if (!dryRun) {
      await svc.createEvent(targetId, { summary: newSummary, start: ev.start, end: ev.end, ...carry(ev) });
      await svc.deleteEvent(calendarId, id);
    }
    return { result: "moved", message: `${would}MOVE  ${ev.summary}  →  ${item.targetKey} cal as "${newSummary}"` };
  }

  // reschedule
  if (!item.newStart || !item.newEnd) return { result: "skipped", message: `reschedule ${label} — needs newStart and newEnd` };
  if (!dryRun) {
    await svc.createEvent(calendarId, {
      summary: ev.summary,
      start: toGcalTime(item.newStart),
      end: toGcalTime(item.newEnd),
      ...carry(ev),
    });
    await svc.deleteEvent(calendarId, id);
  }
  return { result: "rescheduled", message: `${would}RESCHEDULE  ${ev.summary}  →  ${item.newStart}` };
}

module.exports = { applyPlannedAction, toGcalTime };
