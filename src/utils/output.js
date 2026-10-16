/**
 * Unified Output System
 * Consolidated CLI output patterns, standardized formatting, and reusable helpers
 */

// Re-export helpers from cli.js
const {
  showProgress: cliShowProgress,
  showSuccess: cliShowSuccess,
  showError: cliShowError,
  showWarning: cliShowWarning,
  showInfo: cliShowInfo,
} = require("./cli");

/**
 * Emoji Constants
 * Single source of truth for emoji usage across CLI
 */
const EMOJI = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  progress: "⏳",
  info: "ℹ️",
  data: "📊",
  calendar: "📅",
  skip: "⏭️",
  delete: "🗑️",
  star: "🌟",
  robot: "🤖",
  list: "📋",
};

/**
 * Create a horizontal divider line
 * @param {string} char - Character to use for divider (default: "─")
 * @param {number} length - Length of divider (default: 60)
 * @returns {string} Divider string
 */
function divider(char = "─", length = 60) {
  return char.repeat(length);
}

/**
 * Create a section header with title
 * @param {string} title - Header title
 * @param {string} char - Character to use for separator (default: "═")
 * @param {number} length - Length of separator (default: 60)
 * @returns {void} Prints header to console
 */
function header(title, char = "═", length = 60) {
  const separator = divider(char, length);
  console.log("\n" + separator);
  console.log(title);
  console.log(separator + "\n");
}

/**
 * Create a formatted section header with progress indicator
 * @param {string} title - Section title (e.g., "Processing Oura")
 * @param {number} current - Current step number (optional)
 * @param {number} total - Total steps (optional)
 * @returns {void} Prints section header to console
 */
function sectionHeader(title, current = null, total = null) {
  if (current !== null && total !== null) {
    console.log(`\n[${current}/${total}] ${title}...`);
  } else {
    console.log(`\n${title}...`);
  }
  console.log(divider("-", 60) + "\n");
}

/**
 * Display progress phase indicator
 * @param {number} current - Current phase number
 * @param {number} total - Total phases
 * @param {string} name - Phase name
 * @returns {void} Prints phase indicator
 */
function phase(current, total, name) {
  console.log(`[${current}/${total}] ${name}`);
}

/**
 * Display sub-phase progress indicator
 * @param {string} message - Sub-phase message
 * @returns {void} Prints sub-phase indicator
 */
function subphase(message) {
  console.log(`├── ${message}`);
}

/**
 * Display completion message with optional duration
 * @param {string} message - Completion message
 * @param {number|string} duration - Optional duration (seconds or formatted string)
 * @returns {void} Prints completion message
 */
function done(message, duration = null) {
  if (duration !== null) {
    const durationStr = typeof duration === "number" ? `${duration}s` : duration;
    console.log(`${EMOJI.success} ${message} (${durationStr})`);
  } else {
    console.log(`${EMOJI.success} ${message}`);
  }
}

/**
 * Format sync results in compact or detailed format
 * @param {Object} results - Sync results object
 * @param {Array} results.created - Created records
 * @param {Array} results.skipped - Skipped records
 * @param {Array} [results.deleted] - Deleted records (optional)
 * @param {Array} results.errors - Error records
 * @param {number} [results.total] - Total records processed
 * @param {Object} options - Formatting options
 * @param {boolean} [options.showDetails=false] - Show detailed itemized lists
 * @param {number} [options.detailLimit=5] - Limit for detailed items shown
 * @param {string} [options.title] - Custom title (default: "SYNC RESULTS")
 * @param {Function} [options.formatItem] - Function to format individual items
 * @param {string} [options.sourceType] - Source type for formatting
 * @returns {void} Prints sync results
 */
function syncResults(results, options = {}) {
  const {
    showDetails = false,
    detailLimit = 5,
    title = "SYNC RESULTS",
    formatItem = null,
    sourceType = null,
  } = options;

  const { created = [], skipped = [], deleted = [], errors = [], total = 0 } =
    results;

  // Split created into actual creates vs updates
  const actualCreated = created.filter((item) => !item.updated);
  const actualUpdated = created.filter((item) => item.updated);

  // Compact format (default)
  if (!showDetails) {
    const parts = [];
    if (actualCreated.length > 0) parts.push(`${EMOJI.success} ${actualCreated.length} created`);
    if (actualUpdated.length > 0) parts.push(`🔄 ${actualUpdated.length} updated`);
    if (skipped.length > 0) parts.push(`${EMOJI.skip} ${skipped.length} skipped`);
    if (deleted && deleted.length > 0)
      parts.push(`${EMOJI.delete} ${deleted.length} deleted`);
    if (errors.length > 0) parts.push(`${EMOJI.error} ${errors.length} errors`);

    if (parts.length > 0) {
      console.log(parts.join(" | "));
    } else {
      console.log(`${EMOJI.info} No results`);
    }
    return;
  }

  // Detailed format
  header(title, "═", 60);

  if (total > 0) {
    console.log(`${EMOJI.data} Total records processed: ${total}`);
  }

  // Helper to print items in a section
  const printItems = (items, emoji) => {
    const itemsToShow = items.slice(0, detailLimit);
    itemsToShow.forEach((item) => {
      if (formatItem) {
        console.log(`   ${emoji} ${formatItem(item, sourceType)}`);
      } else if (item.displayName) {
        console.log(`   ${emoji} ${item.displayName}`);
      } else if (item.summary) {
        console.log(`   ${emoji} ${item.summary}`);
      } else {
        console.log(`   ${emoji} ${JSON.stringify(item)}`);
      }
    });
    if (items.length > detailLimit) {
      console.log(`   ... and ${items.length - detailLimit} more`);
    }
  };

  // Created section
  if (actualCreated.length > 0) {
    console.log(`${EMOJI.success} Created: ${actualCreated.length}`);
    printItems(actualCreated, EMOJI.success);
    console.log();
  }

  // Updated section
  if (actualUpdated.length > 0) {
    console.log(`🔄 Updated: ${actualUpdated.length}`);
    printItems(actualUpdated, "🔄");
    console.log();
  }

  // Skipped section
  if (skipped.length > 0) {
    // One reason → name it; several → count them (the per-item lines carry each).
    const skipReasons = [...new Set(skipped.map((s) => s.reason).filter(Boolean))];
    const skipReason =
      skipReasons.length === 0
        ? "duplicates"
        : skipReasons.length === 1
        ? skipReasons[0]
        : `${skipReasons.length} reasons`;
    console.log(`${EMOJI.skip} Skipped: ${skipped.length} (${skipReason})`);
    const itemsToShow = skipped.slice(0, detailLimit);
    itemsToShow.forEach((item) => {
      if (formatItem) {
        const formatted = formatItem(item, sourceType);
        const reason = item.reason ? ` - ${item.reason}` : "";
        console.log(`   ${EMOJI.skip} ${formatted}${reason}`);
      } else if (item.displayName) {
        const reason = item.reason ? ` - ${item.reason}` : "";
        console.log(`   ${EMOJI.skip} ${item.displayName}${reason}`);
      } else if (item.pageId) {
        const reason = item.reason ? ` - ${item.reason}` : "";
        console.log(`   ${EMOJI.skip} Page ID: ${item.pageId}${reason}`);
      } else {
        console.log(`   ${EMOJI.skip} ${JSON.stringify(item)}`);
      }
    });
    if (skipped.length > detailLimit) {
      console.log(`   ... and ${skipped.length - detailLimit} more`);
    }
    console.log();
  }

  // Deleted section
  if (deleted && deleted.length > 0) {
    console.log(`${EMOJI.delete} Deleted: ${deleted.length}`);
    const itemsToShow = deleted.slice(0, detailLimit);
    itemsToShow.forEach((item) => {
      const summary = item.summary || "Unknown";
      const eventId = item.eventId ? ` (Event ID: ${item.eventId})` : "";
      console.log(`   ${EMOJI.delete} ${summary}${eventId}`);
    });
    if (deleted.length > detailLimit) {
      console.log(`   ... and ${deleted.length - detailLimit} more`);
    }
    console.log();
  }

  // Errors section
  if (errors.length > 0) {
    console.log(`${EMOJI.error} Errors: ${errors.length}`);
    errors.forEach((error) => {
      const identifier =
        error.session ||
        error.activity ||
        error.measurementId ||
        error.pageId ||
        "Unknown";
      console.log(`   ${EMOJI.error} ${identifier}: ${error.error || error.message || "Unknown error"}`);
    });
    console.log();
  }

  console.log(divider("═", 60) + "\n");
}

/**
 * Display summary statistics
 * @param {Object} stats - Statistics object
 * @returns {void} Prints summary
 */
function summary(stats) {
  const parts = [];
  if (stats.total !== undefined) parts.push(`${stats.total} total`);
  if (stats.successful !== undefined) parts.push(`${stats.successful} successful`);
  if (stats.failed !== undefined) parts.push(`${stats.failed} failed`);

  if (parts.length > 0) {
    console.log(`${EMOJI.data} Summary: ${parts.join(" | ")}`);
  }
}

/**
 * Display empty state message
 * @param {string} type - Type of data that's empty (e.g., "records", "events")
 * @returns {void} Prints empty state message
 */
function empty(type) {
  console.log(`${EMOJI.info} No ${type} found`);
}

/**
 * Check if debug mode is active
 * Checks for displayOnly flag, action === "display", or process.env.DEBUG
 * @param {Object} [context] - Optional context object
 * @param {boolean} [context.displayOnly] - Display-only flag
 * @param {string} [context.action] - Action string (checks if === "display")
 * @returns {boolean} True if debug mode is active
 */
function isDebugMode(context = {}) {
  // Check process.env.DEBUG
  if (process.env.DEBUG) {
    return true;
  }

  // Check displayOnly flag
  if (context.displayOnly === true) {
    return true;
  }

  // Check action === "display"
  if (context.action === "display") {
    return true;
  }

  return false;
}

/**
 * Execute function only if debug mode is active
 * @param {Function} fn - Function to execute
 * @param {Object} [context] - Optional context object for isDebugMode
 * @returns {*} Function result if debug mode, undefined otherwise
 */
function debugOnly(fn, context = {}) {
  if (isDebugMode(context)) {
    return fn();
  }
  return undefined;
}

// Re-export cli.js helpers with consistent naming
const showProgress = cliShowProgress;
const showSuccess = cliShowSuccess;
const showError = cliShowError;
const showWarning = cliShowWarning;
const showInfo = cliShowInfo;

module.exports = {
  // Constants
  EMOJI,
  // Separators
  divider,
  header,
  sectionHeader,
  // Progress
  phase,
  subphase,
  done,
  // Results
  syncResults,
  // Summary
  summary,
  empty,
  // Debug
  isDebugMode,
  debugOnly,
  // Re-exports from cli.js
  showProgress,
  showSuccess,
  showError,
  showWarning,
  showInfo,
};

