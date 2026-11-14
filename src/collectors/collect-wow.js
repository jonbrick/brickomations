// Reads World of Warcraft sessions logged by scripts/wow-tracker.js
// (local/wow/sessions.jsonl) and shapes them like Steam activities — same
// Notion DB, same properties, same Activity ID format.

const fs = require("fs");
const path = require("path");
const { parseDate } = require("../utils/date");
const { sessionsToActivities } = require("../utils/wow-sessions");

const DEFAULT_SESSIONS_PATH = path.join(__dirname, "..", "..", "local", "wow", "sessions.jsonl");

function formatLocalDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function readSessions(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((s) => s && s.start && s.end);
}

/**
 * Fetch WoW sessions for date range
 *
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} Steam-shaped gaming activities
 */
async function fetchWowData(startDate, endDate) {
  const filePath = process.env.WOW_SESSIONS_PATH || DEFAULT_SESSIONS_PATH;
  const sessions = readSessions(filePath);
  if (sessions.length === 0) return [];

  return sessionsToActivities(sessions, formatLocalDay(startDate), formatLocalDay(endDate)).map(
    ({ dateStr, ...activity }) => ({
      ...activity,
      date: parseDate(dateStr),
      dateObj: parseDate(dateStr),
    })
  );
}

module.exports = { fetchWowData };
