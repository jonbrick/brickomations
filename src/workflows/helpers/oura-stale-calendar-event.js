// Deletes the calendar event a revised Oura session leaves behind.
//
// Oura is a checkbox-pattern integration: Notion stores "Calendar Created", not
// the Google event ID, so nothing downstream can find the old event once the
// record's times change. The revised wake time can also re-route the record to
// a different sleep calendar (04:04 → Normal Wake Up, 08:24 → Sleep In), which
// puts the orphan on a calendar the new event will never touch. So the delete
// happens here, in the Notion update path, while the old coordinates are still
// in hand.

const GoogleCalendarService = require("../../services/GoogleCalendarService");
const calendarMappings = require("../../config/calendar/mappings");

// Widen the list window past the old event so a slightly-off event still shows
// up in the results and gets rejected by the exact match below, rather than
// being missed because the window clipped it.
const SEARCH_PADDING_MS = 2 * 60 * 60 * 1000;

/**
 * Pick the event matching the record's OLD sleep window.
 *
 * Exact start AND end only. A fuzzy or overlap match would happily delete a nap
 * or an event Jon made by hand that merely sits inside the same night — the
 * cost of missing the orphan is one duplicate on a calendar, the cost of a
 * wrong delete is losing something nothing else holds a copy of.
 *
 * @param {Array} events - Events as Google returns them
 * @param {Object} previous - { bedtime, wakeTime } ISO strings from Notion
 * @returns {Object|null} The matching event, or null
 */
function findStaleSleepEvent(events, { bedtime, wakeTime }) {
  const start = Date.parse(bedtime);
  const end = Date.parse(wakeTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  return (
    (events || []).find((event) => {
      const eventStart = Date.parse(event?.start?.dateTime);
      const eventEnd = Date.parse(event?.end?.dateTime);
      return eventStart === start && eventEnd === end;
    }) || null
  );
}

/**
 * Delete the stale sleep event for a record whose times just changed.
 *
 * Never throws: the data fix in Notion is the point, and a failed delete only
 * costs a duplicate calendar entry. The reason is returned so the sync log says
 * what happened instead of going quiet.
 *
 * @param {Object} previous - { calendarLabel, bedtime, wakeTime } as stored in Notion
 * @returns {Promise<Object>} { deleted, eventId?, calendarId?, reason? }
 */
async function deleteStaleSleepEvent({ calendarLabel, bedtime, wakeTime }) {
  const calendarId = calendarMappings.sleep.mappings[calendarLabel];
  if (!calendarId) {
    return {
      deleted: false,
      reason: `no calendar configured for "${calendarLabel}"`,
    };
  }

  try {
    const calendar = new GoogleCalendarService("personal");
    const events = await calendar.listEvents(
      calendarId,
      new Date(Date.parse(bedtime) - SEARCH_PADDING_MS),
      new Date(Date.parse(wakeTime) + SEARCH_PADDING_MS)
    );

    const stale = findStaleSleepEvent(events, { bedtime, wakeTime });
    if (!stale) {
      return { deleted: false, reason: "no event matched the old window" };
    }

    await calendar.deleteEvent(calendarId, stale.id);
    return { deleted: true, eventId: stale.id, calendarId };
  } catch (error) {
    return { deleted: false, reason: `delete failed: ${error.message}` };
  }
}

module.exports = {
  findStaleSleepEvent,
  deleteStaleSleepEvent,
};
