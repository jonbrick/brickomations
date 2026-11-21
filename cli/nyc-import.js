#!/usr/bin/env node
/**
 * NYC Import CLI
 * One-time import of NYC CSV files into Notion databases
 *
 * Usage: yarn nyc:import
 * Input: CSV files from ~/Downloads/
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const config = require("../src/config");
const NotionDatabase = require("../src/databases/NotionDatabase");
const { delay } = require("../src/utils/async");
const { createSpinner } = require("../src/utils/cli");

const db = new NotionDatabase();

const NYC_DATABASES = {
  museums: {
    csvFile: path.join(process.env.HOME, "Downloads", "nyc-museums.csv"),
    envVar: "NYC_MUSEUMS_DATABASE_ID",
    configKey: "nycMuseums",
    label: "Museums",
  },
  restaurants: {
    csvFile: path.join(process.env.HOME, "Downloads", "nyc-restaurants.csv"),
    envVar: "NYC_RESTAURANTS_DATABASE_ID",
    configKey: "nycRestaurants",
    label: "Restaurants",
  },
  tattoos: {
    csvFile: path.join(process.env.HOME, "Downloads", "nyc-tattoos.csv"),
    envVar: "NYC_TATTOOS_DATABASE_ID",
    configKey: "nycTattoos",
    label: "Tattoos",
  },
  venues: {
    csvFile: path.join(process.env.HOME, "Downloads", "nyc-venues.csv"),
    envVar: "NYC_VENUES_DATABASE_ID",
    configKey: "nycVenues",
    label: "Venues",
  },
};

function readCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

function buildProperties(row) {
  const props = {};
  for (const [key, value] of Object.entries(row)) {
    if (!value || value.trim() === "") continue;
    props[key] = value.trim();
  }
  return props;
}

async function importCsv(dbConfig, spinner) {
  const databaseId = process.env[dbConfig.envVar];
  if (!databaseId) {
    console.log(`  - ${dbConfig.label}: ${dbConfig.envVar} not set, skipping`);
    return { created: 0, skipped: 0, errors: 0 };
  }

  if (!fs.existsSync(dbConfig.csvFile)) {
    console.log(`  - ${dbConfig.label}: CSV not found at ${dbConfig.csvFile}`);
    return { created: 0, skipped: 0, errors: 0 };
  }

  const rows = readCsv(dbConfig.csvFile);
  const results = { created: 0, skipped: 0, errors: 0 };

  for (const row of rows) {
    const name = row.Name?.trim();
    if (!name) {
      results.skipped++;
      continue;
    }

    // Check for duplicates by title
    try {
      spinner.start(`Importing ${dbConfig.label}...`);
      const existing = await db.queryDatabase(databaseId, {
        property: "Name",
        title: { equals: name },
      });

      if (existing.length > 0) {
        results.skipped++;
        await delay(config.sources.rateLimits.notion.backoffMs);
        continue;
      }

      const properties = buildProperties(row);
      await db.createPage(databaseId, properties, [], dbConfig.configKey);
      results.created++;
      await delay(config.sources.rateLimits.notion.backoffMs);
    } catch (error) {
      results.errors++;
      spinner.stop(`  ! Error importing "${name}": ${error.message}`);
    }
  }

  spinner.stop();
  console.log(
    `  ${dbConfig.label}: ${results.created} created, ${results.skipped} skipped, ${results.errors} errors`
  );
  return results;
}

async function main() {
  console.log("\nNYC Import - CSV to Notion\n");

  const spinner = createSpinner("Importing...");
  let totalCreated = 0;
  let totalErrors = 0;

  for (const [key, dbConfig] of Object.entries(NYC_DATABASES)) {
    await importCsv(dbConfig, spinner);
  }

  console.log("\nImport complete.\n");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
