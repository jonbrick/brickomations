// Syncs Oura sleep data to Notion with de-duplication

const { syncIntegrationToNotion } = require("./helpers/sync-integration-to-notion");
const { deleteStaleSleepEvent } = require("./helpers/oura-stale-calendar-event");
const { formatDate } = require("../utils/date");
const { categorizeOuraSession } = require("../utils/oura-categorization");
const { transformOuraToNotion } = require("../transformers/oura-to-notion-oura");
const config = require("../config");

// How long a night stays eligible for a rewrite.
//
// An Oura sleep ID is not immutable. The ring keeps re-segmenting and rescoring
// a night for hours after it first publishes it: on 2026-09-22 a bathroom trip
// closed the session at 04:04, Oura published it as 4.1h, the 07:00 sync wrote
// that to Notion, and by 09:00 the same ID had been finalized as 8h7m ending
// 08:24 — which the create-only sync then skipped, permanently. Three days is
// well past the point where Oura still moves a night, and keeping old records
// frozen means a rewrite can never reach back into a week Jon has retro'd.
const REVISION_WINDOW_DAYS = 3;

/**
 * Seconds → the hours figure the transformer stores, so a comparison against
 * Notion is like-for-like instead of tripping on rounding every run.
 */
function toStoredHours(seconds) {
  return seconds ? parseFloat((seconds / 3600).toFixed(1)) : 0;
}

/** Compare two timestamps as instants, falling back to text when unparseable. */
function sameInstant(a, b) {
  if (!a || !b) return !a && !b;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    return String(a).trim() === String(b).trim();
  }
  return ta === tb;
}

/** Clock portion of an Oura timestamp, for the change summary in the log. */
function clock(iso) {
  if (!iso) return "—";
  const match = String(iso).match(/T(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : String(iso);
}

/**
 * Describe how a freshly fetched session differs from what Notion already holds
 * for the same sleep ID. Pure, so the decision to rewrite a record is testable
 * without Notion or Oura in the loop.
 *
 * @param {Object} session - Processed Oura session (collect-oura.js shape)
 * @param {Object} stored - { bedtime, wakeTime, sleepDuration } read off the page
 * @returns {string|null} Change summary, or null when nothing moved
 */
function describeSleepRevision(session, stored) {
  const changes = [];

  if (!sameInstant(stored.bedtime, session.bedtimeStart)) {
    changes.push(`bedtime ${clock(stored.bedtime)} → ${clock(session.bedtimeStart)}`);
  }
  if (!sameInstant(stored.wakeTime, session.bedtimeEnd)) {
    changes.push(`wake ${clock(stored.wakeTime)} → ${clock(session.bedtimeEnd)}`);
  }

  const freshHours = toStoredHours(session.sleepDuration);
  const storedHours = Number(stored.sleepDuration ?? 0);
  if (storedHours !== freshHours) {
    changes.push(`duration ${storedHours}h → ${freshHours}h`);
  }

  return changes.length > 0 ? changes.join("; ") : null;
}

/**
 * Is this session recent enough to rewrite?
 *
 * Measured from wake time. A session Oura dates in the future (clock skew)
 * stays eligible — the window exists to protect settled history, not to reject
 * odd clocks.
 *
 * @param {Object} session - Processed Oura session
 * @param {Date} now - Current time
 * @param {number} windowDays - Days of history that stay writable
 * @returns {boolean}
 */
function isWithinRevisionWindow(session, now = new Date(), windowDays = REVISION_WINDOW_DAYS) {
  const wokeAt = Date.parse(session.bedtimeEnd);
  if (Number.isNaN(wokeAt)) return false;
  return now.getTime() - wokeAt <= windowDays * 24 * 60 * 60 * 1000;
}

/**
 * Rewrite a Notion record whose Oura session has since been revised.
 *
 * @param {Object} session - Processed Oura session
 * @param {Object} existing - The Notion page found by sleep ID
 * @param {Object} repo - IntegrationDatabase for oura
 * @param {Object} options - { now } for tests
 * @returns {Promise<Object|null>} Update metadata, or null to leave the page alone
 */
async function updateRevisedSession(session, existing, repo, options = {}) {
  if (!isWithinRevisionWindow(session, options.now || new Date())) return null;

  const props = config.notion.properties.oura;
  const name = (prop) => config.notion.getPropertyName(prop);

  const stored = {
    bedtime: repo.extractProperty(existing, name(props.bedtime)),
    wakeTime: repo.extractProperty(existing, name(props.wakeTime)),
    sleepDuration: repo.extractProperty(existing, name(props.sleepDuration)),
    calendarLabel: repo.extractProperty(existing, name(props.googleCalendar)),
    calendarCreated: repo.extractProperty(existing, name(props.calendarCreated)),
  };

  const reason = describeSleepRevision(session, stored);
  if (!reason) return null;

  // Rewrite every mapped field, not only the ones that moved: a re-segmented
  // night changes the stages, the heart-rate averages and the scores too, and
  // the new wake time can change which sleep calendar the record routes to.
  // Oura owns these fields — inside the window a hand-edit to one of them loses
  // to the ring, which is the right way round for measured data.
  const properties = {
    ...transformOuraToNotion(session),
    // Back to unsynced so the calendar step emits a fresh event over the
    // corrected window.
    [name(props.calendarCreated)]: false,
  };

  await repo.updatePage(existing.id, properties);

  const calendarCleanup =
    stored.calendarCreated === true && stored.bedtime && stored.wakeTime
      ? await deleteStaleSleepEvent({
          calendarLabel: stored.calendarLabel,
          bedtime: stored.bedtime,
          wakeTime: stored.wakeTime,
        })
      : null;

  return { reason, calendarCleanup };
}

/**
 * Sync multiple Oura sleep sessions to Notion
 *
 * Routing (see oura.categorization config):
 * - type === "long_sleep"        → Normal Wake Up or Sleep In
 * - type === "sleep", nap window → Naps (when NAPS_CALENDAR_ID set)
 * - everything else              → dropped (drowsy noise, fragmented main sleep)
 *
 * A session already in Notion is rewritten when Oura has since revised it and
 * the night is still inside REVISION_WINDOW_DAYS; otherwise it's skipped.
 *
 * @param {Array} sessions - Array of processed Oura sleep sessions
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} Sync results
 */
async function syncOuraToNotion(sessions, options = {}) {
  const sleepCategorization = config.notion.sleepCategorization;
  const routed = sessions.filter(
    (s) => categorizeOuraSession(s, sleepCategorization) !== null
  );

  return syncIntegrationToNotion(
    "oura",
    routed,
    (item) => item.sleepId,
    (item) => formatDate(item.nightOf),
    {
      ...options,
      updateExisting: (session, existing, repo) =>
        updateRevisedSession(session, existing, repo, options),
    }
  );
}

module.exports = {
  syncOuraToNotion,
  describeSleepRevision,
  isWithinRevisionWindow,
  REVISION_WINDOW_DAYS,
};
