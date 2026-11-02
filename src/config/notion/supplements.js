/**
 * @fileoverview Supplements Database Configuration
 * @layer 1 - Notion-only (no API collection)
 *
 * Purpose: Defines Notion database properties for daily Supplements tracking.
 * Split from the medications DB (see ./medications.js).
 *
 * Tracking model (2026-11): five checkboxes per day — AM Supps / PM Supps
 * (taken), AM Supps Skipped / PM Supps Skipped, No Supps — folded by the
 * Status formula into one string ("✅ Taken", "Morning only", "⏭️ Skipped",
 * "Morning ✅ · evening pending", "❌ Not logged", …). Status is the sync
 * contract: the transformer reads it through utils/day-status.js and never
 * re-derives the day from the boxes. The AM Skipped / PM Skipped
 * multi-selects still name the individual misses inside a taken batch.
 * Collagen + Vitamin C are workout-coupled (training days only) and live
 * outside the routine — in the 🍬 Supplements List DB, not tracked here.
 */

const database = process.env.NOTION_SUPPLEMENTS_DATABASE_ID;

// Canonical daily routine, in display order. Drives the ✅/❌ block in the
// calendar event. The AM/PM Skipped multi-select option labels must match
// these names exactly so a skipped item flips to ❌.
const SUPPLEMENT_ROUTINE = {
  am: [
    "B-Complex",
    "Vitamin D3",
    "CoQ10",
    "Creatine",
    "Magnesium Glycinate",
    "Kyolic AGE",
    "Omega-3",
  ],
  pm: ["Creatine", "Magnesium Glycinate", "Kyolic AGE", "Omega-3"],
};

const properties = {
  name: { name: "Name", type: "title", enabled: true },
  date: { name: "Date", type: "date", enabled: true },
  calendarEventId: {
    name: "Calendar Event ID",
    type: "rich_text",
    enabled: true,
  },
  amSupps: { name: "AM Supps", type: "checkbox", enabled: true },
  pmSupps: { name: "PM Supps", type: "checkbox", enabled: true },
  amSkipped: { name: "AM Skipped", type: "multi_select", enabled: true },
  pmSkipped: { name: "PM Skipped", type: "multi_select", enabled: true },
  noSupps: { name: "No Supps", type: "checkbox", enabled: true },
  amSuppsSkipped: { name: "AM Supps Skipped", type: "checkbox", enabled: true },
  pmSuppsSkipped: { name: "PM Supps Skipped", type: "checkbox", enabled: true },
  status: { name: "Status", type: "formula", enabled: true },
};

const fieldMappings = {
  name: "name",
  date: "date",
  calendarEventId: "calendarEventId",
  amSupps: "amSupps",
  pmSupps: "pmSupps",
  amSkipped: "amSkipped",
  pmSkipped: "pmSkipped",
  noSupps: "noSupps",
  amSuppsSkipped: "amSuppsSkipped",
  pmSuppsSkipped: "pmSuppsSkipped",
  status: "status",
};

module.exports = {
  SUPPLEMENT_ROUTINE,
  database,
  properties,
  fieldMappings,
};
