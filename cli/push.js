#!/usr/bin/env node
/**
 * Push CLI
 * Reads local JSON files and syncs changes back to Notion + Google Calendar
 *
 * Usage: yarn push
 *        yarn push --auto   # Non-interactive, pushes all sections
 * Input: data/*.json
 */

require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const inquirer = require("inquirer");
const config = require("../src/config");
const NotionDatabase = require("../src/databases/NotionDatabase");
const GoogleCalendarService = require("../src/services/GoogleCalendarService");
const { CALENDARS } = require("../src/config/unified-sources");
const { delay } = require("../src/utils/async");
const { createSpinner } = require("../src/utils/cli");
const { markdownToBlocks } = require("../src/utils/notion-content");

const { readFileSyncRetry, writeFileSyncRetry } = require("../src/utils/fs-retry");
const DATA_DIR = path.join(__dirname, "..", "data");
const db = new NotionDatabase();

const NYC_CONFIG_KEYS = {
  museums: "nycMuseums",
  restaurants: "nycRestaurants",
  tattoos: "nycTattoos",
  venues: "nycVenues",
};

const RETRO_CONFIG_KEYS = {
  personalWeekly: "personalRetro",
  workWeekly: "workRetro",
};

const LIFE_CONFIG_KEYS = {
  goals: "goals",
  themes: "themes",
  relationships: "relationships",
  tasks: "tasks",
  habits: "personalHabits",
  personalMonthlyPlans: "personalMonthlyPlan",
  workMonthlyPlans: "workMonthlyPlan",
};

const dryRun = process.argv.includes("--dry-run");
const autoMode = process.argv.includes("--auto");

// --- Hashing (must match pull.js) ---

const META_KEYS = new Set(["_notionId", "_lastPulled", "_hash", "_titleKey", "_propertyTypes", "_calendarId", "_calendarName", "_contentHash", "_notionEditedTime"]);

/**
 * Recompute hash of a record's non-metadata fields.
 * If it matches _hash from pull, the record is unchanged.
 */
function computeHash(record) {
  const data = {};
  for (const [key, value] of Object.entries(record)) {
    if (META_KEYS.has(key)) continue;
    data[key] = value;
  }
  return crypto.createHash("md5").update(JSON.stringify(data)).digest("hex");
}

function isChanged(record) {
  if (!record._hash) return true; // No hash = always push
  return computeHash(record) !== record._hash;
}

/**
 * Read a JSON data file
 */
function readDataFile(filename) {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`  ✗ ${filename} not found (run yarn pull first)`);
    return null;
  }
  return JSON.parse(readFileSyncRetry(filepath, "utf-8"));
}

// Notion property types that are safe to push back
const PUSHABLE_TYPES = new Set([
  "title", "rich_text", "number", "select", "multi_select", "status",
  "checkbox", "url", "email", "phone_number",
]);

/**
 * Build Notion properties from a local record's flat key-value pairs.
 * Uses _propertyTypes from pull to know exactly which fields are pushable.
 * Skips relations, rollups, formulas, dates, and synthetic fields.
 */
function buildPropertiesFromRecord(record) {
  const properties = {};
  const types = record._propertyTypes || {};

  for (const [key, value] of Object.entries(record)) {
    // Skip internal/meta fields
    if (key.startsWith("_")) continue;

    // Skip synthetic " End" fields created by pull for date ranges
    if (key.endsWith(" End")) continue;

    // Skip null/undefined
    if (value === null || value === undefined) continue;

    // If we have type info, only include pushable types
    const type = types[key];
    if (type && !PUSHABLE_TYPES.has(type)) continue;

    // If no type info (legacy data), skip arrays (likely relations)
    if (!type && Array.isArray(value)) continue;

    // Pre-format status types so _formatProperties doesn't treat them as rich_text
    if (type === "status") {
      properties[key] = { status: { name: value } };
      continue;
    }

    // Pre-format title types — needed for DBs without static config (e.g. retros).
    // _formatProperties falls back to rich_text when the static config doesn't
    // declare the title property, which Notion rejects with "X is expected to be title."
    if (type === "title") {
      properties[key] = { title: [{ text: { content: String(value) } }] };
      continue;
    }

    // Pre-format select types — needed for DBs without static config (e.g. personalProjects).
    // _formatProperties' cross-DB fallback only finds properties declared in config;
    // undeclared select props fall through to rich_text and Notion rejects with
    // "X is expected to be select."
    if (type === "select") {
      properties[key] = { select: { name: String(value) } };
      continue;
    }

    properties[key] = value;
  }

  return properties;
}

/**
 * Push an array of records to Notion
 * @param {Array} records - Records with _notionId
 * @param {string} label - Display label for logging
 * @param {Object} spinner - CLI spinner
 * @param {string|null} configKey - Optional config key for property type detection
 * @returns {Object} { updated, skipped, created, errors }
 */
async function pushRecords(records, label, spinner, configKey = null) {
  const results = { updated: 0, skipped: 0, created: 0, errors: 0 };

  if (!records || records.length === 0) {
    console.log(`  → ${label}: no records`);
    return results;
  }

  for (const record of records) {
    // Delta detection: skip records that haven't changed since pull
    if (!isChanged(record)) {
      results.skipped++;
      continue;
    }

    const notionId = record._notionId;
    const properties = buildPropertiesFromRecord(record);

    // Skip if no meaningful properties to push
    if (Object.keys(properties).length === 0) {
      results.skipped++;
      continue;
    }

    if (!notionId) {
      // New record - would need to create
      if (dryRun) {
        const name = Object.values(properties).find((v) => typeof v === "string") || "(unnamed)";
        console.log(`  + Would create: ${name}`);
        results.created++;
      } else {
        // Skip creation for now - v1 only updates existing records
        results.skipped++;
      }
      continue;
    }

    if (dryRun) {
      const name = Object.values(properties).find((v) => typeof v === "string") || notionId;
      console.log(`  ~ Would update: ${name}`);
      results.updated++;
      continue;
    }

    try {
      spinner.start();
      await db.updatePage(notionId, properties, configKey);
      results.updated++;
      await delay(config.sources.rateLimits.notion.backoffMs);
    } catch (error) {
      results.errors++;
      spinner.stop(`  ✗ Failed to update ${notionId}: ${error.message}`);
    }
  }

  spinner.stop();
  console.log(
    `  ✓ ${label}: ${results.updated} updated, ${results.skipped} skipped, ${results.errors} errors`
  );

  return results;
}

// --- Push functions ---

async function pushPlanData(spinner) {
  const data = readDataFile("plan.json");
  if (!data) return;

  console.log("\nPushing plan data...");

  await pushRecords(data.weeks, "Weeks", spinner, "weeks");
  await pushRecords(data.months, "Months", spinner, "months");
  await pushRecords(data.rocks, "Rocks", spinner, "rocks");
  await pushRecords(data.events, "Events", spinner, "events");
  await pushRecords(data.trips, "Trips", spinner, "trips");
}

async function pushCollectedData(spinner) {
  const data = readDataFile("collected.json");
  if (!data) return;

  console.log("\nPushing collected data...");

  for (const [key, records] of Object.entries(data)) {
    if (key === "_meta") continue;
    if (!Array.isArray(records)) continue;
    await pushRecords(records, key, spinner, key);
  }
}

async function pushSummaries(spinner) {
  const data = readDataFile("summaries.json");
  if (!data) return;

  console.log("\nPushing summaries...");

  await pushRecords(data.personalWeekly, "Personal Weekly", spinner, "personalSummary");
  await pushRecords(data.workWeekly, "Work Weekly", spinner, "workSummary");
  await pushRecords(data.personalMonthlyRecap, "Personal Monthly Recap", spinner, "personalMonthlyRecap");
  await pushRecords(data.workMonthlyRecap, "Work Monthly Recap", spinner, "workMonthlyRecap");
}

async function pushCalendar(spinner) {
  const data = readDataFile("calendar.json");
  if (!data) return;

  console.log("\nPushing calendar events...");

  let personalService;
  try {
    personalService = new GoogleCalendarService("personal");
  } catch (error) {
    console.log("  ✗ Personal Google Calendar not configured");
  }

  let workService;
  try {
    workService = new GoogleCalendarService("work");
  } catch (error) {
    // Work calendar is optional
  }

  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const [calId, events] of Object.entries(data)) {
    if (calId === "_meta") continue;
    if (!Array.isArray(events)) continue;

    const calConfig = CALENDARS[calId];
    if (!calConfig) continue;

    const calendarId = process.env[calConfig.envVar];
    if (!calendarId) continue;

    const isWorkCalendar = calId === "workCalendar" || calId === "workPRs";
    const service = isWorkCalendar ? workService : personalService;
    if (!service) continue;

    for (const event of events) {
      // Delta detection: skip unchanged calendar events
      if (!isChanged(event)) {
        totalSkipped++;
        continue;
      }

      if (!event._calendarId) {
        totalSkipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  ~ Would update calendar event: ${event.summary}`);
        totalUpdated++;
        continue;
      }

      try {
        spinner.start();
        const eventData = {
          summary: event.summary,
          description: event.description || "",
          location: event.location || "",
        };

        // Preserve start/end format
        if (event.start && event.start.includes("T")) {
          eventData.start = { dateTime: event.start };
          eventData.end = { dateTime: event.end };
        } else if (event.start) {
          eventData.start = { date: event.start };
          eventData.end = { date: event.end };
        }

        await service.updateEvent(calendarId, event._calendarId, eventData);
        totalUpdated++;
      } catch (error) {
        totalErrors++;
        spinner.stop(`  ✗ Failed to update event ${event.summary}: ${error.message}`);
      }
    }
  }

  spinner.stop();
  console.log(
    `  ✓ Calendar: ${totalUpdated} updated, ${totalSkipped} skipped, ${totalErrors} errors`
  );
}

async function pushNycData(spinner) {
  const data = readDataFile("nyc.json");
  if (!data) return;

  console.log("\nPushing NYC data...");

  for (const [key, records] of Object.entries(data)) {
    if (key === "_meta") continue;
    if (!Array.isArray(records)) continue;
    const configKey = NYC_CONFIG_KEYS[key] || null;
    await pushRecords(records, key, spinner, configKey);
  }
}

async function pushRetroData(spinner) {
  const data = readDataFile("retro.json");
  if (!data) return;

  console.log("\nPushing retro data...");

  for (const [key, records] of Object.entries(data)) {
    if (key === "_meta") continue;
    if (!Array.isArray(records)) continue;
    const configKey = RETRO_CONFIG_KEYS[key] || null;
    await pushRecords(records, key, spinner, configKey);
  }
}

/**
 * Check if a task's page content has changed since pull.
 * Compares current _content against stored _contentHash.
 */
function isContentChanged(record) {
  if (!record._contentHash) return !!record._content;
  const currentHash = crypto.createHash("md5").update(record._content || "").digest("hex");
  return currentHash !== record._contentHash;
}

async function pushLifeData(spinner) {
  const data = readDataFile("life.json");
  if (!data) return;

  console.log("\nPushing life data...");

  for (const [key, records] of Object.entries(data)) {
    if (key === "_meta") continue;
    if (!Array.isArray(records)) continue;
    const configKey = LIFE_CONFIG_KEYS[key] || null;
    await pushRecords(records, key, spinner, configKey);
  }

  // Push task content changes
  if (data.tasks) {
    const contentChanges = data.tasks.filter(
      (t) => t._notionId && t._content !== undefined && isContentChanged(t)
    );

    if (contentChanges.length > 0) {
      console.log(`\n  Pushing task content (${contentChanges.length} changed)...`);
      let contentUpdated = 0;
      let contentErrors = 0;

      for (const task of contentChanges) {
        if (dryRun) {
          const name = task[task._titleKey] || task._notionId;
          console.log(`  ~ Would update content: ${name}`);
          contentUpdated++;
          continue;
        }

        try {
          spinner.start();
          const blocks = markdownToBlocks(task._content || "");
          await db.replacePageContent(task._notionId, blocks);
          contentUpdated++;
        } catch (error) {
          contentErrors++;
          spinner.stop(`  ✗ Content update failed for ${task._notionId}: ${error.message}`);
        }
      }

      spinner.stop();
      console.log(`  ✓ Task content: ${contentUpdated} updated, ${contentErrors} errors`);
    }
  }
}

// --- Main ---

async function main() {
  console.log("\n🤖 Brickomations - Push Data\n");

  if (dryRun) {
    console.log("ℹ️  Dry run mode: showing what would change, no API calls\n");
  }

  let sections;

  if (autoMode) {
    sections = ["plan", "collected", "summaries", "calendar", "nyc", "retro", "life"];
  } else {
    const answer = await inquirer.prompt([
      {
        type: "checkbox",
        name: "sections",
        message: "What would you like to push?",
        choices: [
          { name: "Plan data", value: "plan", checked: true },
          { name: "Collected data", value: "collected", checked: true },
          { name: "Summaries & Recaps", value: "summaries", checked: true },
          { name: "Calendar events", value: "calendar", checked: true },
          { name: "NYC data", value: "nyc", checked: true },
          { name: "Retro data", value: "retro", checked: true },
          { name: "Life data", value: "life", checked: true },
        ],
        validate: (answer) => answer.length > 0 ? true : "Select at least one",
      },
    ]);
    sections = answer.sections;

    if (!dryRun) {
      const { confirmed } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirmed",
          message: `Push ${sections.join(", ")} to Notion/Calendar?`,
          default: true,
        },
      ]);
      if (!confirmed) {
        console.log("Cancelled.");
        return;
      }
    }
  }

  const spinner = createSpinner("Pushing...");

  try {
    if (sections.includes("plan")) await pushPlanData(spinner);
    if (sections.includes("collected")) await pushCollectedData(spinner);
    if (sections.includes("summaries")) await pushSummaries(spinner);
    if (sections.includes("calendar")) await pushCalendar(spinner);
    if (sections.includes("nyc")) await pushNycData(spinner);
    if (sections.includes("retro")) await pushRetroData(spinner);
    if (sections.includes("life")) await pushLifeData(spinner);

    console.log("\n✅ Push complete.\n");
  } catch (error) {
    spinner.stop();
    console.error("\n❌ Error:", error.message);
    if (process.env.DEBUG) console.error(error.stack);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
