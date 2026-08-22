/**
 * 📋 Daily Records — one thin row per vault daily note. NOT year-scoped
 * (single DB across years), so it stays out of generate-year-config.
 * Written one-way by cli/daily-records.js (a `yarn sync` step); never edited
 * in Notion. The ⏰ 2026 Weeks relation isn't declarable in this schema
 * family — the sync script writes it through the raw client.
 */
module.exports = {
  database: process.env.NOTION_DAILY_RECORDS_DATABASE_ID,
  properties: {
    day: { name: "Day", type: "title", enabled: true },
    date: { name: "Date", type: "date", enabled: true },
    source: { name: "Source", type: "rich_text", enabled: true },
    synced: { name: "Synced", type: "date", enabled: true },
  },
  fieldMappings: {},
};
