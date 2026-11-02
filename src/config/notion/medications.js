/**
 * @fileoverview Medications Database Configuration
 * @layer 1 - Notion-only (no API collection)
 *
 * Purpose: Defines Notion database properties for Medications tracking.
 * Supplements live in a separate DB (see ./supplements.js).
 *
 * Tracking model (2026-11): five checkboxes per day — AM Meds / PM Meds
 * (taken), AM Meds Skipped / PM Meds Skipped, No Meds — folded by the Status
 * formula into one string ("✅ Taken", "Morning only", "⏭️ Skipped",
 * "Morning ✅ · evening pending", "❌ Not logged", …). Status is the sync
 * contract: the transformer reads it through utils/day-status.js and never
 * re-derives the day from the boxes, so the methodology is a Notion edit.
 * The per-day regimen is held as relations to the 💊 Medications List DB
 * (AM Medication / PM Medication); the AM/PM Medication List formulas render
 * those relations as comma-separated name strings, so the transformer never
 * resolves relation IDs. A single skipped med is recorded by removing it from
 * that day's relation. A changing Rx is pure data: edit the Medications List
 * DB and the day relations, no code change.
 */

const database = process.env.NOTION_MEDICATIONS_DATABASE_ID;

const properties = {
  name: { name: "Name", type: "title", enabled: true },
  date: { name: "Date", type: "date", enabled: true },
  calendarEventId: {
    name: "Calendar Event ID",
    type: "rich_text",
    enabled: true,
  },
  amMeds: { name: "AM Meds", type: "checkbox", enabled: true },
  pmMeds: { name: "PM Meds", type: "checkbox", enabled: true },
  amMedList: { name: "AM Medication List", type: "formula", enabled: true },
  pmMedList: { name: "PM Medication List", type: "formula", enabled: true },
  noMeds: { name: "No Meds", type: "checkbox", enabled: true },
  amMedsSkipped: { name: "AM Meds Skipped", type: "checkbox", enabled: true },
  pmMedsSkipped: { name: "PM Meds Skipped", type: "checkbox", enabled: true },
  status: { name: "Status", type: "formula", enabled: true },
};

const fieldMappings = {
  name: "name",
  date: "date",
  calendarEventId: "calendarEventId",
  amMeds: "amMeds",
  pmMeds: "pmMeds",
  amMedList: "amMedList",
  pmMedList: "pmMedList",
  noMeds: "noMeds",
  amMedsSkipped: "amMedsSkipped",
  pmMedsSkipped: "pmMedsSkipped",
  status: "status",
};

module.exports = {
  database,
  properties,
  fieldMappings,
};
