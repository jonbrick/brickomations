// Generic workflow for syncing Notion database records to Google Calendar events
// Replaces integration-specific workflows: oura, strava, github, steam, withings, bloodPressure

const fs = require("fs");
const path = require("path");
const { INTEGRATIONS } = require("../config/unified-sources");
const config = require("../config");
const { delay } = require("../utils/async");
const { formatDate, formatDateOnly, getToday } = require("../utils/date");
const GoogleCalendarService = require("../services/GoogleCalendarService");
const IntegrationDatabase = require("../databases/IntegrationDatabase");
const { CALENDAR_SKIP_STATUSES } = require("../config/notion/task-categories");

/**
 * Get display name for a record based on integration config
 * @param {Object} record - Notion page object
 * @param {Object} repo - Database instance
 * @param {Object} integrationConfig - Integration config from INTEGRATIONS
 * @returns {string} Formatted display name
 */
function getDisplayName(record, repo, integrationConfig) {
  const metadata = integrationConfig.calendarSyncMetadata;
  const props = config.notion.properties[integrationConfig.id];

  if (!props) {
    throw new Error(
      `Properties not found in config for ${integrationConfig.id}. Check that config.notion.properties.${integrationConfig.id} is properly loaded.`
    );
  }

  const propertyName = config.notion.getPropertyName(
    props[metadata.displayNameProperty]
  );
  const value = repo.extractProperty(record, propertyName);

  switch (metadata.displayNameFormat) {
    case "date": {
      // Format as date (e.g., Oura's nightOfDate)
      if (!value) return "Unknown";
      return formatDate(value instanceof Date ? value : new Date(value));
    }
    case "text": {
      // Return as-is (e.g., name, gameName)
      return value || "Unknown";
    }
    case "repoDate": {
      // Combine repository + date (GitHub special case)
      const repository = value || "Unknown";
      const dateProp = config.notion.getPropertyName(props.date);
      const date = repo.extractProperty(record, dateProp);
      const dateStr = date
        ? typeof date === "string"
          ? date.split("T")[0]
          : formatDateOnly(date)
        : null;
      return dateStr ? `${repository} (${dateStr})` : repository;
    }
    default:
      return value || "Unknown";
  }
}

// Change detection for the syncEntireDb sources (Events, Trips). Those DBs are
// reconciled in full on every run, and the hybrid path used to re-push every
// record unconditionally — getEvent → updateEvent → markSynced → 350ms delay,
// ~1.6s per record. At 207 events that consumed the whole `update` step budget
// and the step was SIGTERM'd (2026-08-12). Records whose calendar event already
// matches what we would write are now skipped outright: no API calls, no Notion
// write-back, no rate-limit delay.
//
// The comparison covers the union of two field sets, because each one alone has
// a blind spot:
//
//   1. Object.keys(transformedEvent) — whatever the transformer actually set.
//      Adding a field to a transformer brings it under comparison automatically,
//      so no one has to remember to update a list here.
//
//   2. MANAGED_EVENT_FIELDS — fields a transformer *may* set. Needed because (1)
//      goes blind exactly when a transformer STOPS setting something: if a colorId
//      stops mapping, the key vanishes from the transformed event and the stale
//      colour would sit on the calendar unnoticed. Comparing these regardless
//      means removals propagate too.
//
// Fields Google sets on its own (etag, sequence, organizer, …) are ignored —
// Notion is the source of truth only for what it writes.
//
// Anything whose shape can't be compared with confidence returns false and falls
// through to the write path. This may only ever skip a write; it can never
// redirect one.
const MANAGED_EVENT_FIELDS = [
  "summary",
  "description",
  "location",
  "colorId",
  "start",
  "end",
  "transparency",
  "visibility",
];

/**
 * Normalize a scalar field for equality testing.
 * Google omits empty description/colorId rather than returning "", while the
 * transformers produce "" for an empty description; treat those alike. Google
 * also echoes descriptions back with CRLF line endings.
 * @param {*} value
 * @returns {string}
 */
function normalizeComparable(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\r\n/g, "\n").trim();
}

/**
 * Compare one field of the desired event against the calendar's current value.
 * Scalars compare normalized; plain objects (start/end) recurse over the keys
 * the transformer set; anything else (arrays, functions, dates) is treated as
 * not-comparable and therefore not a match.
 * @param {*} existingValue - Value from the Google event
 * @param {*} desiredValue - Value from the transformed event
 * @returns {boolean}
 */
function fieldMatches(existingValue, desiredValue) {
  if (
    desiredValue === null ||
    desiredValue === undefined ||
    typeof desiredValue === "string" ||
    typeof desiredValue === "number" ||
    typeof desiredValue === "boolean"
  ) {
    return normalizeComparable(existingValue) === normalizeComparable(desiredValue);
  }

  const isPlainObject = (v) =>
    typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

  if (isPlainObject(desiredValue)) {
    if (!isPlainObject(existingValue)) return false;
    return Object.keys(desiredValue).every((key) =>
      fieldMatches(existingValue[key], desiredValue[key])
    );
  }

  // Arrays (recurrence, attendees, …) and any other shape: not compared, so the
  // record takes the write path. Deliberate — a wrong skip is worse than a write.
  return false;
}

/**
 * True only when the existing calendar event already matches the event we would
 * write. Biased to returning false: any doubt means take the write path.
 * @param {Object|null} existing - Event as returned by Google Calendar
 * @param {Object} event - Event produced by the transformer
 * @returns {boolean}
 */
function eventMatchesExisting(existing, event) {
  if (!existing || !event) return false;
  // A cancelled event is never up to date.
  if (existing.status === "cancelled") return false;

  // All-day shape only. Timed events would need offset-aware comparison of
  // dateTime strings that Google may return in a different but equivalent
  // representation — a wrong match there means a meeting silently keeps the
  // wrong time. No current syncEntireDb source emits them; if one ever does it
  // takes the write path until someone implements that comparison deliberately.
  if (existing.start?.dateTime || existing.end?.dateTime) return false;
  if (event.start?.dateTime || event.end?.dateTime) return false;
  if (!existing.start?.date || !existing.end?.date) return false;
  if (!event.start?.date || !event.end?.date) return false;

  // Every field the transformer set, plus every field it could have set — so
  // that clearing a value propagates just as an edit does.
  const comparedKeys = new Set([...MANAGED_EVENT_FIELDS, ...Object.keys(event)]);
  return [...comparedKeys].every((key) =>
    fieldMatches(existing[key], event[key])
  );
}

/**
 * Resolve the change-detection mode.
 * "on" (default) skips writes for records the calendar already matches.
 * "shadow" computes and reports the same decision but still performs every
 * write — a diagnostic for confirming what the fast path would do without
 * letting it act. "off" restores the unconditional pre-2026-08 behavior.
 *
 * An unrecognized value falls back to "on" rather than erroring: a typo in .env
 * should not quietly revert the pipeline to a mode nobody chose.
 * @returns {"on"|"shadow"|"off"}
 */
function getChangeDetectionMode() {
  const raw = (process.env.SYNC_CHANGE_DETECTION || "on").toLowerCase();
  return ["on", "shadow", "off"].includes(raw) ? raw : "on";
}

// Daily full-resync backstop. The fast path above trusts a field comparison;
// this guarantees that anything it fails to notice is corrected within a day.
// Keyed off a stamp file rather than launchd's 07:00 slot so that a missed or
// retimed run self-heals on the next one instead of skipping a day.
const FULL_RESYNC_STAMP = path.join(
  __dirname,
  "..",
  "..",
  "local",
  "last-full-resync"
);

// Memoized per process, per stamp path, so every source in one `update` run
// shares the decision — otherwise the first source would consume the stamp and
// the rest would take the fast path on what is supposed to be the full pass.
const fullResyncDecisions = new Map();

/**
 * True when this process should write every record unconditionally.
 * Fails safe in every direction: an absent, stale, unreadable or unwritable
 * stamp all resolve to "resync". Only an exact match on today's local date
 * permits the fast path.
 * @param {string} [stampPath] - Override the stamp location (tests).
 * @returns {boolean}
 */
function isFullResyncDue(stampPath = FULL_RESYNC_STAMP) {
  if (fullResyncDecisions.has(stampPath)) {
    return fullResyncDecisions.get(stampPath);
  }

  const today = formatDateOnly(getToday());
  let last = null;
  try {
    last = fs.readFileSync(stampPath, "utf8").trim();
  } catch {
    // No stamp yet — this run becomes the day's full resync.
  }

  let due = last !== today;

  if (due) {
    try {
      fs.mkdirSync(path.dirname(stampPath), { recursive: true });
      fs.writeFileSync(stampPath, today);
    } catch {
      // Can't persist the stamp — keep resyncing every run rather than
      // silently trusting the fast path forever.
      due = true;
    }
  }

  fullResyncDecisions.set(stampPath, due);
  return due;
}

/**
 * Validate calendar event based on event type
 * @param {Object} event - Calendar event object
 * @param {string} eventType - "dateTime" or "allDay"
 * @returns {boolean} True if valid
 */
function validateEvent(event, eventType) {
  if (eventType === "dateTime") {
    return !!(
      event.start &&
      event.start.dateTime &&
      event.end &&
      event.end.dateTime
    );
  } else if (eventType === "allDay") {
    return !!(event.start && event.start.date);
  }
  return false;
}

/**
 * Clean up orphaned calendar events for Events/Trips
 * Deletes calendar events that don't have corresponding Notion records
 *
 * @param {string} integrationId - Integration ID
 * @param {Object} repo - IntegrationDatabase instance
 * @param {Object} calendarService - GoogleCalendarService instance
 * @param {string} calendarId - Calendar ID to clean up
 * @param {Date} startDate - Start date for cleanup range
 * @param {Date} endDate - End date for cleanup range
 * @param {Object} results - Results object to populate
 * @returns {Promise<void>}
 */
async function cleanupOrphanedEvents(
  integrationId,
  repo,
  calendarService,
  calendarId,
  startDate,
  endDate,
  results
) {
  try {
    if (process.env.DEBUG) {
    console.log(
      `\n🧹 Cleaning up orphaned ${integrationId} calendar events...`
    );
    }

    // Initialize cleanup stats if not exists
    if (!results.cleanup) {
      results.cleanup = {};
    }

    // Get ALL Notion records in date range (including synced ones)
    const allRecords = await repo.getAllInDateRange(startDate, endDate);

    // Skip-status records are intentionally excluded so their stranded
    // calendar events fall through to the orphan delete below.
    const integrationProps = config.notion.properties[integrationId];
    const statusPropName = integrationProps?.status
      ? config.notion.getPropertyName(integrationProps.status)
      : null;

    // Build Set of valid Calendar Event IDs from Notion
    const validEventIds = new Set();
    let skippedDueToStatus = 0;
    for (const record of allRecords) {
      const eventId = repo.extractEventId(record);
      if (!eventId) continue;

      if (statusPropName) {
        const status = repo.extractProperty(record, statusPropName);
        if (status && CALENDAR_SKIP_STATUSES.includes(status)) {
          skippedDueToStatus++;
          continue;
        }
      }

      validEventIds.add(eventId);
    }

    results.cleanup.validEventIds = validEventIds.size;
    results.cleanup.skippedDueToStatus = skippedDueToStatus;

    // List Calendar events in the same date range
    const calendarEvents = await calendarService.listEvents(
      calendarId,
      startDate,
      endDate
    );

    results.cleanup.calendarEventsFound = calendarEvents.length;

    // Delete orphaned events (events not in Notion)
    let deletedCount = 0;
    for (const calEvent of calendarEvents) {
      if (!validEventIds.has(calEvent.id)) {
        try {
          await calendarService.deleteEvent(calendarId, calEvent.id);
          results.deleted.push({
            eventId: calEvent.id,
            summary: calEvent.summary || "Untitled",
            calendarId: calendarId,
            deletedAt: new Date().toISOString(),
          });
          deletedCount++;

          // Rate limiting between deletions
          await delay(config.sources.rateLimits.googleCalendar.backoffMs);
        } catch (error) {
          // Log error but continue with other deletions
          results.errors.push({
            eventId: calEvent.id,
            error: `Failed to delete: ${error.message}`,
          });
        }
      }
    }
  } catch (error) {
    // Log error but don't fail the entire sync
    results.errors.push({
      error: `Cleanup failed: ${error.message}`,
    });
  }
}

/**
 * Sync Notion database records to Google Calendar
 * @param {string} integrationId - Integration ID (e.g., 'oura', 'strava', 'github')
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} Sync results
 */
async function syncToCalendar(integrationId, startDate, endDate, options = {}) {
  // Get integration config
  const integrationConfig = INTEGRATIONS[integrationId];
  if (!integrationConfig || !integrationConfig.updateCalendar) {
    throw new Error(
      `Integration ${integrationId} is not configured for calendar sync`
    );
  }

  const metadata = integrationConfig.calendarSyncMetadata;

  // Small, non-date-scoped DBs (Events, Trips) opt out of the caller's rolling
  // window via databaseConfig.syncEntireDb and reconcile their full contents on
  // every run. The wide span flows into both the record fetch (getAllInDateRange)
  // and the orphan cleanup (listEvents), so the whole DB and the whole calendar
  // are reconciled each pass — no future-dated record waits for the window to
  // reach it, and a Notion deletion clears its event immediately.
  if (integrationConfig.databaseConfig?.syncEntireDb) {
    const now = new Date();
    startDate = new Date(now.getFullYear() - 5, 0, 1);
    endDate = new Date(now.getFullYear() + 5, 11, 31, 23, 59, 59, 999);
  }

  // Create database instance using IntegrationDatabase
  const repo = new IntegrationDatabase(integrationId);

  // Load transformer from config
  const transformerFile = metadata.transformerFile;
  const transformerFunction = metadata.transformerFunction;

  if (!transformerFile || !transformerFunction) {
    throw new Error(
      `Transformer config missing for ${integrationId}. Check calendarSyncMetadata.transformerFile and transformerFunction.`
    );
  }

  const transformerModule = require(transformerFile);
  const transformFn = transformerModule[transformerFunction];
  if (!transformFn) {
    throw new Error(
      `Transformer function ${transformerFunction} not found in ${transformerFile}`
    );
  }

  // Initialize calendar service(s)
  // Use multiple services if configured (e.g., GitHub for personal/work), otherwise single service
  let calendarService;
  let calendarServices;
  if (metadata.useMultipleCalendarServices) {
    calendarServices = {
      personal: new GoogleCalendarService("personal"),
      work: new GoogleCalendarService("work"),
    };
  } else {
    calendarService = new GoogleCalendarService("personal");
  }

  const results = {
    created: [],
    skipped: [],
    unchanged: [],
    errors: [],
    deleted: [],
    total: 0,
  };

  // Change detection applies only to the full-DB reconcile sources, which are the
  // ones paying the unconditional re-write cost. Windowed sources already fetch
  // only unsynced records.
  const changeDetectionMode = getChangeDetectionMode();
  const isFullDbSource = integrationConfig.databaseConfig?.syncEntireDb === true;
  // Once a day, write everything regardless of comparison — the backstop that
  // makes trusting the fast path the rest of the day safe.
  const fullResyncDue =
    isFullDbSource && changeDetectionMode !== "off" && isFullResyncDue();
  const useChangeDetection =
    changeDetectionMode !== "off" && isFullDbSource && !fullResyncDue;
  let unchangedMatches = 0;
  // Counted, not swallowed. If listing the calendar starts failing, every record
  // falls through to the write path — correct, but it silently returns the step
  // to its old ~340s cost and the fast path looks like it just stopped finding
  // matches. Surfacing this is the difference between a visible degradation and
  // a mysterious slowdown months later.
  let listFailures = 0;

  // One listEvents call per calendar, reused for every record. The cleanup phase
  // already lists this same range, so this reuses an established access pattern
  // rather than adding a per-record getEvent.
  const existingEventsByCalendar = new Map();
  async function getExistingEventsById(calService, calId) {
    if (!existingEventsByCalendar.has(calId)) {
      const events = await calService.listEvents(calId, startDate, endDate);
      const byId = new Map();
      for (const existing of events) byId.set(existing.id, existing);
      existingEventsByCalendar.set(calId, byId);
    }
    return existingEventsByCalendar.get(calId);
  }

  // Determine which pattern to use: event ID (text property) or checkbox
  const useEventIdPattern =
    repo.databaseConfig.calendarEventIdProperty !== undefined &&
    repo.databaseConfig.calendarEventIdProperty !== null;

  // Detect hybrid pattern via explicit databaseConfig flag.
  const useHybridPattern =
    useEventIdPattern && repo.databaseConfig.useHybridPattern === true;

  try {
    // Get records based on pattern
    // Hybrid pattern: fetch ALL records so existing ones can be updated
    // Event ID pattern: fetch only records missing event IDs
    // Checkbox pattern: fetch only unchecked records
    const records = useHybridPattern
      ? await repo.getAllInDateRange(startDate, endDate)
      : useEventIdPattern
      ? await repo.getUnsyncedByEventId(startDate, endDate)
      : await repo.getUnsynced(startDate, endDate);
    results.total = records.length;

    if (records.length === 0) {
      return results;
    }

    // Process each record
    for (const record of records) {
      try {
        // Transform to calendar event format
        const transformed = transformFn(record, repo);
        if (!transformed) {
          results.skipped.push({
            id: record.id,
            reason: metadata.skipReason || "Transformer returned null",
          });
          continue;
        }
        const { calendarId, event, accountType } = transformed;

        // Extract existing event ID for hybrid pattern (if record already has one)
        const existingEventId = useHybridPattern
          ? repo.extractEventId(record)
          : null;

        // Validate event
        if (!validateEvent(event, metadata.eventType)) {
          // Extract display name even when skipped
          const displayName = getDisplayName(record, repo, integrationConfig);

          results.skipped.push({
            skipped: true,
            pageId: record.id,
            reason: metadata.skipReason,
            displayName,
          });
          continue;
        }

        // Get the appropriate calendar service (GitHub uses accountType)
        const calService =
          accountType && calendarServices
            ? calendarServices[accountType]
            : calendarService;

        if (!calService) {
          throw new Error(`Invalid account type: ${accountType}`);
        }

        // Fast path: the calendar already holds exactly what we would write.
        // Skip the update, the Notion write-back, and the rate-limit delay.
        if (useChangeDetection && useHybridPattern && existingEventId) {
          let known = null;
          try {
            const byId = await getExistingEventsById(calService, calendarId);
            known = byId.get(existingEventId) || null;
          } catch (error) {
            // Listing failed — fall through to the unconditional write path,
            // but record it so the degradation is visible rather than silent.
            listFailures++;
            if (listFailures === 1) {
              results.errors.push({
                error: `Change detection unavailable, falling back to unconditional writes: ${error.message}`,
              });
            }
            known = null;
          }
          if (eventMatchesExisting(known, event)) {
            unchangedMatches++;
            if (changeDetectionMode === "on") {
              results.unchanged.push({
                pageId: record.id,
                eventId: existingEventId,
                // Carried so the cleanup phase below can resolve its calendar
                // without a second getAllInDateRange — in steady state every
                // record is unchanged and results.created is empty.
                calendarId,
                displayName:
                  getDisplayName(record, repo, integrationConfig) ||
                  event.summary,
              });
              continue;
            }
            // shadow mode: counted above, but still written below.
          }
        }

        // Create or update calendar event
        let createdEvent;
        let wasUpdated = false;

        try {
          if (useHybridPattern && existingEventId) {
            // Try to update existing event
            const existingEvent = await calService.getEvent(
              calendarId,
              existingEventId
            );
            if (existingEvent) {
              createdEvent = await calService.updateEvent(
                calendarId,
                existingEventId,
                event
              );
              wasUpdated = true;
            } else {
              // Event not found, create new one
              createdEvent = await calService.createEvent(calendarId, event);
            }
          } else {
            // Create new event
            createdEvent = await calService.createEvent(calendarId, event);
          }

          // Mark as synced in Notion (use appropriate pattern)
          if (useEventIdPattern) {
            await repo.markSyncedWithEventId(record.id, createdEvent.id);
          } else {
            await repo.markSynced(record.id);
          }

          // Extract display name for consistent reporting
          const displayName = getDisplayName(record, repo, integrationConfig);

          const result = {
            skipped: false,
            created: true,
            updated: wasUpdated,
            pageId: record.id,
            calendarId,
            eventId: createdEvent.id,
            summary: event.summary,
            displayName: displayName || event.summary,
          };

          // Add accountType for GitHub
          if (accountType) {
            result.accountType = accountType;
          }

          results.created.push(result);
        } catch (error) {
          // Don't mark as synced if calendar creation failed
          throw new Error(`Failed to create calendar event: ${error.message}`);
        }

        // Rate limiting between operations
        await delay(config.sources.rateLimits.googleCalendar.backoffMs);
      } catch (error) {
        results.errors.push({
          pageId: record.id,
          error: error.message,
        });
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to sync ${integrationId} to calendar: ${error.message}`
    );
  }

  // Run cleanup when the integration opts in via databaseConfig.cleanupOrphans.
  // Deletes calendar events that don't have a matching Notion Calendar Event ID.
  if (integrationConfig.databaseConfig?.cleanupOrphans === true) {
    try {
      // Get the calendar ID used for this integration
      // Use first record's calendarId from created events, or resolve from config
      let cleanupCalendarId = null;

      if (results.created.length > 0) {
        // Use calendarId from first created event
        cleanupCalendarId = results.created[0].calendarId;
      } else if (results.unchanged.length > 0) {
        // Steady state with change detection on: nothing was written, but the
        // skipped records know their calendar.
        cleanupCalendarId = results.unchanged[0].calendarId;
      } else {
        // Resolve calendarId from config (for when no events were created)
        const { resolveCalendarId } = require("../utils/calendar-mapper");
        // We need a dummy record to resolve calendar ID - get first record from date range
        const allRecords = await repo.getAllInDateRange(startDate, endDate);
        if (allRecords.length > 0) {
          const transformerModule = require(metadata.transformerFile);
          const transformFn = transformerModule[metadata.transformerFunction];
          const transformed = transformFn(allRecords[0], repo);
          cleanupCalendarId = transformed?.calendarId;
        }
      }

      if (cleanupCalendarId) {
        await cleanupOrphanedEvents(
          integrationId,
          repo,
          calendarService,
          cleanupCalendarId,
          startDate,
          endDate,
          results
        );
      }
    } catch (error) {
      // Log error but don't fail the entire sync
      results.errors.push({
        error: `Cleanup failed: ${error.message}`,
      });
    }
  }

  if (isFullDbSource && changeDetectionMode !== "off") {
    results.changeDetection = {
      mode: changeDetectionMode,
      matched: unchangedMatches,
      fullResync: fullResyncDue,
      listFailures,
    };
  }

  return results;
}

module.exports = {
  syncToCalendar,
  // Exported for test/change-detection.test.js. These decide whether a calendar
  // write is skipped, so they are the part of this file most worth pinning down.
  eventMatchesExisting,
  fieldMatches,
  getChangeDetectionMode,
  isFullResyncDue,
};
