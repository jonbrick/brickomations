#!/usr/bin/env node
/**
 * Update Calendar CLI
 * Sync sleep and workout records from Notion to Google Calendar
 */

require("dotenv").config();
const inquirer = require("inquirer");
const NotionDatabase = require("../src/databases/NotionDatabase");
const IntegrationDatabase = require("../src/databases/IntegrationDatabase");
const { selectDateRange, createSpinner, parseDateRangeFromArgv } = require("../src/utils/cli");
const { formatDate } = require("../src/utils/date");
const output = require("../src/utils/output");
const { formatRecordForLogging } = require("../src/utils/display-names");
const {
  formatRecordsForDisplay,
  displayRecordsTable,
} = require("../src/utils/sweep-display");
const {
  getUpdater,
  getUpdaterIds,
  getCalendarSyncMetadata,
} = require("../src/updaters");
const { INTEGRATIONS } = require("../src/config/unified-sources");

const dryRun = process.argv.includes("--dry-run");
const autoMode = process.argv.includes("--auto");

const { range: cliDateRange, error: cliDateRangeError } = parseDateRangeFromArgv(process.argv);
if (cliDateRangeError) {
  console.error(cliDateRangeError);
  process.exit(1);
}

/**
 * Select source and action type (display only or sync to calendar)
 * @param {Object} options
 * @param {boolean} options.dryRun - If true, skip action prompt and use display-only
 */
async function selectSourceAndAction(options = {}) {
  const { dryRun: isDryRun = false } = options;
  const updaterIds = getUpdaterIds();

  // Build choices from updater registry
  const sortedUpdaters = updaterIds
    .map((id) => ({
      id,
      name: INTEGRATIONS[id].name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const choices = [
    {
      name: `All Sources (${sortedUpdaters
        .map((s) => s.name)
        .join(", ")})`,
      value: "all",
    },
    ...sortedUpdaters.map((s) => ({
      name: s.name,
      value: s.id,
    })),
  ];

  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "source",
      message: "Select data source:",
      choices,
      pageSize: 20, // Show all options without scrolling
    },
    {
      type: "list",
      name: "action",
      message: "What would you like to do?",
      choices: [
        { name: "Sync to Calendar", value: "sync" },
        { name: "Display only (debug)", value: "display" },
      ],
      when: () => !isDryRun,
    },
  ]);
  return {
    source: answers.source,
    action: isDryRun ? "display" : answers.action,
  };
}

/**
 * Handle all calendar syncs sequentially
 */
async function handleAllCalendarSyncs(startDate, endDate, action) {
  output.header("SYNCING ALL SOURCES TO CALENDAR");
  console.log(`Date range: ${formatDate(startDate)} to ${formatDate(endDate)}`);
  console.log(`Action: ${action === "sync" ? "Sync to Calendar" : "Display only"}\n`);

  const startTime = Date.now();
  const updaterIds = getUpdaterIds();

  // Build sources list with names from INTEGRATIONS
  const sources = updaterIds
    .map((id) => ({
      id,
      name: INTEGRATIONS[id].name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const aggregatedResults = {
    successful: [],
    failed: [],
    errors: [],
  };

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    
    // Phase indicator
    output.phase(i + 1, sources.length, source.name);

    let spinner;
    try {
      spinner = createSpinner(`Processing ${source.name}...`);
      spinner.start();
      const result = await handleCalendarSync(source.id, startDate, endDate, action);
      spinner.stop();
      aggregatedResults.successful.push(source.name);

      // Handle all output cases
      if (result.fetchedCount === 0) {
        console.log(result.metadata.emptyMessage);
      } else if (action === "sync" && result.results) {
        const { created, skipped, unchanged, deleted, errors, changeDetection } = result.results;
        const recordLabel = result.fetchedCount === 1 ? "record" : "records";
        const deletedCount = deleted?.length || 0;
        const errorCount = errors?.length || 0;
        const errorSection = errorCount > 0 ? ` | ${errorCount} errors` : "";
        // Unchanged is reported separately from skipped: skipped means the record
        // was unusable (missing date/name), unchanged means the calendar was
        // already correct. Collapsing them would hide a drop in write volume.
        const unchangedCount = unchanged?.length || 0;
        const unchangedSection = unchangedCount > 0 ? ` | ${unchangedCount} unchanged` : "";
        console.log(`✅ ${result.fetchedCount} ${recordLabel} → ${created.length} synced | ${skipped.length} skipped${unchangedSection} | ${deletedCount} deleted${errorSection}\n`);

        // Say why everything was written on the daily full pass, so a full-resync
        // run isn't mistaken for change detection having quietly stopped working.
        // A degraded fast path looks exactly like a slow one. Say so out loud.
        if (changeDetection?.listFailures > 0) {
          console.log(`   ⚠️  change detection degraded — calendar listing failed, ${changeDetection.listFailures} record(s) written unconditionally\n`);
        }

        if (changeDetection?.fullResync) {
          console.log(`   [full resync] daily backstop — every record written unconditionally\n`);
        } else if (changeDetection?.mode === "shadow") {
          // Shadow mode writes everything as before; this line is the only signal
          // of what the fast path would have done. See SYNC_CHANGE_DETECTION.
          //
          // Counted against created.length, not fetchedCount: syncEntireDb sources
          // widen the date range inside the workflow and process far more records
          // than the windowed fetchedCount shown above. Matched records are a
          // subset of the writes actually performed.
          const stillWritten = Math.max(0, created.length - changeDetection.matched);
          console.log(`   [shadow] change detection would skip ${changeDetection.matched} of ${created.length} writes — ${stillWritten} would still be written\n`);
        }
        
        // Collect errors for final summary
        if (errorCount > 0) {
          errors.forEach((error) => {
            const identifier =
              error.session ||
              error.activity ||
              error.measurementId ||
              error.pageId ||
              "Unknown";
            aggregatedResults.errors.push({
              source: source.name,
              identifier,
              error: error.error || error.message || "Unknown error",
            });
            console.log(`   ❌ ${identifier}: ${error.error || error.message || "Unknown error"}`);
          });
          console.log(); // Blank line after errors
        }
      } else if (action === "display" && result.displayData) {
        displayRecordsTable(result.displayData, result.metadata.sourceId);
      }
    } catch (error) {
      if (spinner) spinner.stop();
      console.log(`❌ ${source.name} failed: ${error.message}\n`);
      aggregatedResults.failed.push({
        source: source.name,
        error: error.message,
      });
    }

    // Rate limit delay between sources
    if (i < sources.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Final summary
  console.log(output.divider());
  const duration = Math.round((Date.now() - startTime) / 1000);
  const errorCount = aggregatedResults.errors.length;
  const failedCount = aggregatedResults.failed.length;
  const problemCount = errorCount + failedCount;
  const errorText = problemCount > 0 ? ` (${problemCount} error${problemCount !== 1 ? "s" : ""})` : "";
  output.done(`${aggregatedResults.successful.length} sources completed${errorText}`, `${duration}s`);

  return aggregatedResults;
}

/**
 * Generic handler for syncing Notion records to calendar
 * Returns data only - caller handles all output
 * @param {string} sourceId - Source identifier (e.g., 'oura', 'strava')
 * @param {string} startDate - Start date string for query range
 * @param {string} endDate - End date string for query range
 * @param {string} action - Action to perform ('display' or 'sync')
 * @returns {Promise<Object>} Result object with { fetchedCount, results, displayData, metadata }
 */
async function handleCalendarSync(sourceId, startDate, endDate, action) {
  const updater = getUpdater(sourceId);
  if (!updater) {
    throw new Error(`Unknown source: ${sourceId}`);
  }

  const { syncFn, calendarSyncMetadata } = updater;
  const { emptyMessage, sourceType } = calendarSyncMetadata;
  const sourceName = INTEGRATIONS[sourceId].name;

  // Create IntegrationDatabase instance to check pattern
  const repo = new IntegrationDatabase(sourceId);

  // Determine which pattern to use: event ID (text property) or checkbox
  const useEventIdPattern =
    repo.databaseConfig.calendarEventIdProperty !== undefined &&
    repo.databaseConfig.calendarEventIdProperty !== null;

  // Detect hybrid pattern via explicit databaseConfig flag.
  const useHybridPattern =
    useEventIdPattern && repo.databaseConfig.useHybridPattern === true;

  // Daily-aggregation workflows (BP, body weight) are brute-force idempotent —
  // they always rebuild events for the full date range from current Notion
  // state. Gating them on per-record "unsynced" state means Notion-side
  // deletions (e.g. cleaning up junk rows) never propagate to the calendar.
  const aggregateByDay = INTEGRATIONS[sourceId].aggregateByDay === true;

  // Get records based on pattern
  let records;
  if (aggregateByDay || useHybridPattern) {
    // Fetch ALL records so the workflow can rebuild the range from scratch.
    records = await repo.getAllInDateRange(startDate, endDate);
  } else if (useEventIdPattern) {
    // Use new event ID pattern
    records = await repo.getUnsyncedByEventId(startDate, endDate);
  } else {
    // Fallback to IntegrationDatabase.getUnsynced() for checkbox pattern
    records = await repo.getUnsynced(startDate, endDate);
  }

  // Early return for empty data
  if (records.length === 0) {
    return {
      fetchedCount: 0,
      results: null,
      displayData: null,
      metadata: { emptyMessage, sourceType, sourceId }
    };
  }

  // Format for display (only needed for display mode)
  let displayData = null;
  if (action === "display") {
    // Use repo for new pattern, NotionDatabase for legacy pattern
    const serviceForDisplay = useEventIdPattern ? repo : new NotionDatabase();
    displayData = formatRecordsForDisplay(
      records,
      sourceId,
      serviceForDisplay
    );
  }

  // Sync to calendar if requested
  if (action === "sync") {
    const results = await syncFn(startDate, endDate);
    return {
      fetchedCount: records.length,
      results,
      displayData: null,
      metadata: { emptyMessage, sourceType, sourceId }
    };
  }

  // Display mode: return display data
  return {
    fetchedCount: records.length,
    results: null,
    displayData,
    metadata: { emptyMessage, sourceType, sourceId }
  };
}

async function main() {
  console.log("\n🤖 Brickbot - Sync to Calendar\n");

  let spinner;
  try {
    // Check if calendar sync is enabled
    if (process.env.ENABLE_CALENDAR_SYNC !== "true") {
      console.log("⚠️  Calendar sync is not enabled.");
      console.log(
        "   Set ENABLE_CALENDAR_SYNC=true in your .env file to enable.\n"
      );
      return;
    }

    if (dryRun) {
      console.log("ℹ️ Dry run: displaying only (no sync to Calendar)\n");
    }

    let source, action, startDate, endDate;

    if (autoMode) {
      // Auto mode: all sources, sync.
      // Default range is ±3 days from today; --date/--from/--to override (used by `yarn sync --date=...` backfill).
      source = "all";
      action = "sync";
      if (cliDateRange) {
        startDate = cliDateRange.fromDate;
        endDate = cliDateRange.toDate;
        console.log(`Auto mode: all sources, ${formatDate(startDate)} to ${formatDate(endDate)}\n`);
      } else {
        const today = new Date();
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 3);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(today);
        endDate.setDate(today.getDate() + 3);
        endDate.setHours(23, 59, 59, 999);
        console.log(`Auto mode: all sources, +/- 3 days (${formatDate(startDate)} to ${formatDate(endDate)})\n`);
      }
    } else {
      // Interactive mode
      const selected = await selectSourceAndAction({ dryRun });
      source = selected.source;
      action = selected.action;

      // --from/--to passed without --auto: honor the flags, skip the prompt.
      if (cliDateRange) {
        startDate = cliDateRange.fromDate;
        endDate = cliDateRange.toDate;
        console.log(`Date range from flags: ${formatDate(startDate)} to ${formatDate(endDate)}\n`);
      } else {
        const dateResult = await selectDateRange({
          minGranularity: "day",
          allowFuture: false,
        });
        startDate = dateResult.startDate;
        endDate = dateResult.endDate;
        if (dateResult.displayText) console.log(dateResult.displayText);
      }
    }

    // Route to appropriate handler
    if (source === "all") {
      const results = await handleAllCalendarSyncs(startDate, endDate, action);
      if (autoMode && (results.failed.length > 0 || results.errors.length > 0)) {
        process.exit(1);
      }
    } else {
      spinner = createSpinner(`Processing ${INTEGRATIONS[source].name}...`);
      spinner.start();
      const result = await handleCalendarSync(source, startDate, endDate, action);
      spinner.stop();
      
      // Handle output based on result
      if (result.fetchedCount === 0) {
        console.log(`\n${result.metadata.emptyMessage}`);
      } else if (action === "sync" && result.results) {
        output.syncResults(result.results, {
          showDetails: true,
          title: "CALENDAR SYNC RESULTS",
          formatItem: formatRecordForLogging,
          sourceType: result.metadata.sourceType
        });
      } else if (action === "display" && result.displayData) {
        displayRecordsTable(result.displayData, result.metadata.sourceId);
      }
    }

    console.log("✅ Done!\n");
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    if (spinner) spinner.stop();
  }
}

// Run main function
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
