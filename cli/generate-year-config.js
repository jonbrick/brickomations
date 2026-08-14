/**
 * Database Configuration for Year Generation
 * Contains configuration for all databases to be created
 *
 * Source database IDs live in gitignored local/year-source-ids.json,
 * keyed by envVar — brickomations is a public repo; workspace IDs stay out
 * of committed code.
 */

const path = require("path");

const DATABASE_CONFIG = [
  // Under year page directly (16 databases)
  {
    name: "{year} Trips",
    icon: "✈️",
    envVar: "NOTION_TRIPS_DATABASE_ID",
    parent: "year",
    omitProperties: ["Locations"],
  },
  {
    name: "{year} Events",
    icon: "🎟️",
    envVar: "NOTION_EVENTS_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Relationships",
    icon: "❤️",
    envVar: "NOTION_RELATIONSHIPS_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Themes",
    icon: "🏔️",
    envVar: "NOTION_THEMES_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Goals",
    icon: "🏆",
    envVar: "NOTION_GOALS_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Rocks",
    icon: "🪨",
    envVar: "NOTION_ROCKS_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Tasks",
    icon: "✅",
    envVar: "TASKS_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Weeks",
    icon: "⏰",
    envVar: "WEEKS_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Months",
    icon: "🗓️",
    envVar: "MONTHS_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Personal Summaries Weeks",
    icon: "☮️",
    envVar: "PERSONAL_WEEK_SUMMARY_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Work Summaries Weeks",
    icon: "🪖",
    envVar: "WORK_WEEK_SUMMARY__DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Personal Retro Weeks",
    icon: "🌱",
    envVar: "PERSONAL_WEEK_RETRO_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Work Retro Weeks",
    icon: "🏢",
    envVar: "WORK_WEEK_RETRO_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Personal Recaps - Month",
    icon: "🌍",
    envVar: "PERSONAL_MONTHLY_RECAP_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Work Recaps - Month",
    icon: "🚀",
    envVar: "WORK_MONTHLY_RECAP_DATABASE_ID",
    parent: "year",
  },
  {
    name: "{year} Year",
    icon: "☀️",
    envVar: "NOTION_YEARS_DATABASE_ID",
    parent: "year",
  },
  // Under "{year} Databases" subpage (8 databases)
  {
    name: "GitHub Data",
    icon: "💾",
    envVar: "NOTION_PRS_DATABASE_ID",
    parent: "databases",
  },
  {
    name: "Oura Data",
    icon: "🛏️",
    envVar: "NOTION_SLEEP_DATABASE_ID",
    parent: "databases",
  },
  {
    name: "Steam Data",
    icon: "🎮",
    envVar: "NOTION_VIDEO_GAMES_DATABASE_ID",
    parent: "databases",
  },
  {
    name: "Strava Data",
    icon: "💪",
    envVar: "NOTION_WORKOUTS_DATABASE_ID",
    parent: "databases",
  },
  {
    name: "Withings Data",
    icon: "⚖️",
    envVar: "NOTION_BODY_WEIGHT_DATABASE_ID",
    parent: "databases",
  },
  {
    name: "Blood Pressure",
    icon: "🫀",
    envVar: "NOTION_BLOOD_PRESSURE_DATABASE_ID",
    parent: "databases",
  },
  {
    name: "Medication",
    icon: "💊",
    envVar: "NOTION_MEDICATIONS_DATABASE_ID",
    parent: "databases",
  },
  {
    name: "Supplements",
    icon: "🍬",
    envVar: "NOTION_SUPPLEMENTS_DATABASE_ID",
    parent: "databases",
  },
];

const SOURCE_IDS_PATH = path.join(
  __dirname,
  "..",
  "local",
  "year-source-ids.json"
);

let sourceIds;
try {
  sourceIds = require(SOURCE_IDS_PATH);
} catch {
  throw new Error(
    `Missing ${SOURCE_IDS_PATH} — create it as { "<envVar>": "<source database id>" } with an entry for every DATABASE_CONFIG record.`
  );
}

const missingIds = DATABASE_CONFIG.filter((db) => !sourceIds[db.envVar]);
if (missingIds.length) {
  throw new Error(
    `${SOURCE_IDS_PATH} missing source ids for: ${missingIds
      .map((db) => db.envVar)
      .join(", ")}`
  );
}
for (const db of DATABASE_CONFIG) {
  db.sourceId = sourceIds[db.envVar];
}

const RELATION_CONFIG = [
  // Weeks relations (10 relations)
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Months",
    sourcePropertyName: "🗓️ {year} Months",
    targetPropertyName: "⏰ {year} Weeks",
  },
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Personal Summaries Weeks",
    sourcePropertyName: "☮️ {year} Personal Summaries Weeks",
    targetPropertyName: "⏰ {year} Weeks",
  },
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Work Summaries Weeks",
    sourcePropertyName: "🪖 {year} Work Summaries Weeks",
    targetPropertyName: "⏰ {year} Weeks",
  },
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Personal Retro Weeks",
    sourcePropertyName: "🌱 {year} Personal Retro Weeks",
    targetPropertyName: "⏰ {year} Weeks",
  },
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Work Retro Weeks",
    sourcePropertyName: "🏢 {year} Work Retro Weeks",
    targetPropertyName: "⏰ {year} Weeks",
  },
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Goals",
    sourcePropertyName: "🏆 {year} Goals",
    targetPropertyName: "⏰ {year} Weeks",
  },
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Rocks",
    sourcePropertyName: "🪨 {year} Rocks",
    targetPropertyName: "⏰ {year} Weeks",
  },
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Trips",
    sourcePropertyName: "✈️ {year} Trips",
    targetPropertyName: "⏰ {year} Weeks",
  },
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Events",
    sourcePropertyName: "🎟️ {year} Events",
    targetPropertyName: "⏰ {year} Weeks",
  },
  {
    sourceDb: "{year} Weeks",
    targetDb: "{year} Relationships",
    sourcePropertyName: "❤️ {year} Relationships",
    targetPropertyName: "⏰ {year} Weeks",
  },
  // Months relations (3 relations)
  {
    sourceDb: "{year} Months",
    targetDb: "{year} Year",
    sourcePropertyName: "☀️ {year} Year",
    targetPropertyName: "🗓️ {year} Months",
  },
  {
    sourceDb: "{year} Months",
    targetDb: "{year} Personal Recaps - Month",
    sourcePropertyName: "🌍 {year} Personal Recaps - Month",
    targetPropertyName: "🗓️ {year} Months",
  },
  {
    sourceDb: "{year} Months",
    targetDb: "{year} Work Recaps - Month",
    sourcePropertyName: "🚀 {year} Work Recaps - Month",
    targetPropertyName: "🗓️ {year} Months",
  },
  // Year relations (1 relation)
  {
    sourceDb: "{year} Year",
    targetDb: "{year} Months",
    sourcePropertyName: "🗓️ {year} Months",
    targetPropertyName: "☀️ {year} Year",
  },
  // Trips relations (1 relation)
  {
    sourceDb: "{year} Trips",
    targetDb: "{year} Events",
    sourcePropertyName: "🎟️ {year} Events",
    targetPropertyName: "✈️ {year} Trips",
  },
  // Goals relations (1 relation)
  // No Goals↔Tasks relation: since 2026-07-11, a task's "🏆 {year} Goals" is a
  // rollup deriving from the Projects relation → the project's "🏆 Goal".
  // The Projects DB and that rollup are created manually, not by this generator.
  {
    sourceDb: "{year} Goals",
    targetDb: "{year} Themes",
    sourcePropertyName: "🏔️ {year} Themes",
    targetPropertyName: "🏆 {year} Goals",
  },
  // Rocks relations (1 relation)
  {
    sourceDb: "{year} Rocks",
    targetDb: "{year} Tasks",
    sourcePropertyName: "✅ {year} Tasks",
    targetPropertyName: "🪨 {year} Rocks",
  },
  // Summary → Recap relations
  {
    sourceDb: "{year} Personal Summaries Weeks",
    targetDb: "{year} Personal Recaps - Month",
    sourcePropertyName: "🌒 {year} Recap Months",
    targetPropertyName: "☮️ {year} Personal Summaries Weeks",
  },
  {
    sourceDb: "{year} Work Summaries Weeks",
    targetDb: "{year} Work Recaps - Month",
    sourcePropertyName: "💼 {year} Work Recaps - Month",
    targetPropertyName: "🪖 {year} Work Summaries Weeks",
  },
];

module.exports = { DATABASE_CONFIG, RELATION_CONFIG };
