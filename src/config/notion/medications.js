/**
 * @fileoverview Medications Database Configuration
 * @layer 1 - Notion-only (no API collection)
 *
 * Purpose: Defines Notion database properties for Medications tracking.
 * Supplements live in a separate DB (see ./supplements.js).
 *
 * Tracking model (2026-08): assume-the-routine, log-exceptions, with a per-day
 * regimen held as relations to the 💊 Medications List DB (AM Medication /
 * PM Medication). The AM/PM Medication List formula properties render those
 * relations as comma-separated name strings — the transformer reads the
 * formulas, so it never resolves relation IDs. AM Meds / PM Meds checkboxes
 * mark which batch was taken; a partially-skipped batch is recorded by
 * removing the med from that day's relation. A changing Rx is pure data:
 * edit the Medications List DB and the day relations, no code change.
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
};

module.exports = {
  database,
  properties,
  fieldMappings,
};
