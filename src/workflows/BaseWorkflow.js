// Provides common batch processing logic for all workflows

const { delay } = require("../utils/async");
const config = require("../config");

class BaseWorkflow {
  /**
   * Process a batch of items with rate limiting and error handling
   *
   * @param {Array} items - Array of items to process
   * @param {Function} syncSingleFn - Async function to process a single item
   * @param {number} rateLimitMs - Delay between operations in milliseconds
   * @param {Object} options - Options
   * @returns {Promise<Object>} Results object with created, skipped, errors arrays
   */
  static async syncBatch(items, syncSingleFn, rateLimitMs = null, options = {}) {
    const results = {
      created: [],
      updated: [],
      skipped: [],
      errors: [],
      total: items.length,
    };

    // Use default rate limit if not provided
    const delayMs = rateLimitMs || config.sources.rateLimits.notion.backoffMs;

    for (const item of items) {
      try {
        const result = await syncSingleFn(item);

        if (result.skipped) {
          results.skipped.push(result);
        } else if (result.updated) {
          results.updated.push(result);
        } else {
          results.created.push(result);
        }

        // Rate limiting between operations
        if (items.indexOf(item) < items.length - 1) {
          await delay(delayMs);
        }
      } catch (error) {
        results.errors.push({
          item: this._extractItemIdentifier(item),
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Process a batch of items to Notion with standard flow
   * Checks for existing record, transforms, and creates
   *
   * @param {Array} items - Array of items to sync
   * @param {Object} repository - Database instance (Notion database)
   * @param {Function} findExistingFn - Function to find existing record
   * @param {Function} transformFn - Function to transform item to Notion properties
   * @param {string} databaseId - Notion database ID
   * @param {Function} formatResultFn - Function to format result object
   * @param {Object} options - Options. `options.updateExisting` opts an
   *   integration into upsert: (item, existing, repository) => truthy when it
   *   rewrote the page, falsy to leave it alone. Sources whose data is settled
   *   once published omit it and keep the create-or-skip default.
   * @returns {Promise<Object>} Results object
   */
  static async syncToNotion(
    items,
    repository,
    findExistingFn,
    transformFn,
    databaseId,
    formatResultFn,
    options = {}
  ) {
    const syncSingle = async (item) => {
      // Check for existing record
      const existing = await findExistingFn(item, repository);

      if (existing) {
        if (typeof options.updateExisting === "function") {
          const update = await options.updateExisting(item, existing, repository);
          if (update) {
            return formatResultFn(item, {
              skipped: false,
              updated: true,
              pageId: existing.id,
              ...(typeof update === "object" ? update : {}),
            });
          }
        }
        return formatResultFn(item, { skipped: true, existingPageId: existing.id });
      }

      // Transform and create
      const properties = transformFn(item);
      const page = await repository.createPage(databaseId, properties);

      return formatResultFn(item, { skipped: false, created: true, pageId: page.id });
    };

    return await this.syncBatch(
      items,
      syncSingle,
      config.sources.rateLimits.notion.backoffMs,
      options
    );
  }

  /**
   * Process a batch of Notion records to Calendar with standard flow
   *
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @param {Object} repository - Database instance (Notion database)
   * @param {Object} calendarService - Calendar service instance
   * @param {Function} transformFn - Function to transform record to calendar event
   * @param {Function} validateFn - Function to validate transformed event
   * @param {Function} formatResultFn - Function to format result object
   * @param {Object} options - Options
   * @returns {Promise<Object>} Results object
   */
  static async syncToCalendar(
    startDate,
    endDate,
    repository,
    calendarService,
    transformFn,
    validateFn,
    formatResultFn,
    options = {}
  ) {
    const results = {
      created: [],
      skipped: [],
      errors: [],
      total: 0,
    };

    try {
      // Get unsynced records
      const records = await repository.getUnsynced(startDate, endDate);
      results.total = records.length;

      if (records.length === 0) {
        return results;
      }

      const syncSingle = async (record) => {
        // Transform to calendar event format
        const transformed = transformFn(record, repository);
        const { calendarId, event, accountType } = transformed;

        // Validate
        const validation = validateFn(event, record, repository);
        if (!validation.valid) {
          return {
            skipped: true,
            pageId: record.id,
            reason: validation.reason,
            displayName: validation.displayName,
          };
        }

        // Get calendar service if multiple accounts
        const calService = accountType && options.calendarServices
          ? options.calendarServices[accountType]
          : calendarService;

        // Create calendar event
        const createdEvent = await calService.createEvent(calendarId, event);

        // Mark as synced in Notion
        await repository.markSynced(record.id);

        return formatResultFn(record, {
          skipped: false,
          created: true,
          calendarId,
          eventId: createdEvent.id,
          summary: event.summary,
        }, repository);
      };

      return await this.syncBatch(
        records,
        syncSingle,
        config.sources.rateLimits.googleCalendar.backoffMs,
        options
      );
    } catch (error) {
      throw new Error(`Failed to sync to calendar: ${error.message}`);
    }
  }

  /**
   * Extract identifier from item for error reporting
   *
   * @param {*} item - Item to extract identifier from
   * @returns {string} Identifier
   */
  static _extractItemIdentifier(item) {
    if (typeof item === "object") {
      return item.id || item.sleepId || item.activityId || item.uniqueId || item.measurementId || "unknown";
    }
    return String(item);
  }
}

module.exports = BaseWorkflow;

