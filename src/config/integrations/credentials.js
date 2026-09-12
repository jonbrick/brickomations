// API settings and credentials for external data sources

const { execSync } = require("child_process");

// GitHub token via `gh auth token` (OAuth, stored in macOS Keychain by gh CLI).
// Avoids long-lived PATs in .env. Cached per-process.
//
// Full path used because launchd jobs have a minimal PATH that doesn't
// include /opt/homebrew/bin where Homebrew puts `gh`. Falls back to bare
// `gh` if the Homebrew path isn't there (e.g., Intel Macs at /usr/local).
const fs = require("fs");
const GH_BIN = fs.existsSync("/opt/homebrew/bin/gh")
  ? "/opt/homebrew/bin/gh"
  : fs.existsSync("/usr/local/bin/gh")
    ? "/usr/local/bin/gh"
    : "gh";

let _ghTokenCache = null;
function getGitHubToken() {
  if (_ghTokenCache !== null) return _ghTokenCache;
  try {
    // gh echoes a GITHUB_TOKEN/GH_TOKEN env var instead of the Keychain
    // login when one is set — a stale PAT in .env (loaded by dotenv) would
    // silently shadow the live token. Strip both so the Keychain always wins.
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    _ghTokenCache = execSync(`${GH_BIN} auth token`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      env,
    }).trim();
  } catch {
    _ghTokenCache = undefined;
  }
  return _ghTokenCache;
}

// Oura Ring configuration
const oura = {
  token: process.env.OURA_TOKEN,
  apiBaseUrl: "https://api.ouraring.com/v2",
  // Oura dates are in UTC and represent the "end" of the sleep session
  // "Night of" = Oura date - 1 day
  // Date offset is now handled in dateHandling.oura.dateOffset
};

// Strava configuration
const strava = {
  clientId: process.env.STRAVA_CLIENT_ID,
  clientSecret: process.env.STRAVA_CLIENT_SECRET,
  accessToken: process.env.STRAVA_ACCESS_TOKEN,
  refreshToken: process.env.STRAVA_REFRESH_TOKEN,
  tokenExpiry: process.env.STRAVA_TOKEN_EXPIRY,
  redirectUri:
    process.env.STRAVA_REDIRECT_URI || "http://localhost:3000/callback",
  apiBaseUrl: "https://www.strava.com/api/v3",
};

// Withings configuration
const withings = {
  clientId: process.env.WITHINGS_CLIENT_ID,
  clientSecret: process.env.WITHINGS_CLIENT_SECRET,
  accessToken: process.env.WITHINGS_ACCESS_TOKEN,
  refreshToken: process.env.WITHINGS_REFRESH_TOKEN,
  userId: process.env.WITHINGS_USER_ID,
  apiBaseUrl: "https://wbsapi.withings.net",
  redirectUri:
    process.env.WITHINGS_REDIRECT_URI || "http://localhost:3000/callback",
};

// Steam configuration
const steam = {
  apiBaseUrl: process.env.STEAM_URL,
};

// GitHub configuration
const github = {
  token: getGitHubToken(),
  username: process.env.GITHUB_USERNAME,
  apiBaseUrl: "https://api.github.com",
  workOrg: process.env.GITHUB_WORK_ORG,
  workRepos:
    process.env.GITHUB_WORK_REPOS?.split(",")
      .map((r) => r.trim())
      .filter(Boolean) || [],
};

// Rate limiting configurations
const rateLimits = {
  oura: {
    requestsPerMinute: 300, // Oura allows 5000 per day, ~300 per minute to be safe
    backoffMs: 200,
  },

  strava: {
    requestsPerMinute: 100, // Strava: 100 per 15 min, ~7 per minute to be safe
    backoffMs: 200,
  },

  withings: {
    requestsPerMinute: 60, // Withings: conservative rate limit
    backoffMs: 1000,
  },

  steam: {
    requestsPerMinute: 60, // Steam Lambda: conservative rate limit
    backoffMs: 200,
  },

  github: {
    requestsPerMinute: 60, // GitHub: 5000 req/hour = ~83 req/min, conservative: 60 req/min
    backoffMs: 1000,
  },

  notion: {
    requestsPerSecond: 3, // Notion: 3 requests per second
    backoffMs: 350,
  },

  googleCalendar: {
    requestsPerSecond: 3, // Google Calendar API: 3 requests per second
    backoffMs: 350,
  },
};

// Retry configurations
const retryConfig = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 10000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Date handling configuration per source
 * 
 * Defines how dates are extracted, transformed, and formatted for each integration.
 * Used by `date-handler.js` to apply source-specific date processing.
 * 
 * **Configuration Fields:**
 * - `sourceFormat`: Format of raw date from API
 *   - "date_string": YYYY-MM-DD string (e.g., Oura)
 *   - "iso_local": ISO datetime string already in local timezone (e.g., Strava)
 *   - "iso_utc": ISO datetime string in UTC (e.g., GitHub, Steam)
 *   - "unix_timestamp": Unix timestamp in seconds (e.g., Withings)
 * 
 * - `sourceTimezone`: Timezone of the source data (informational)
 * - `targetTimezone`: Target timezone for storage (informational)
 * 
 * - `extractionMethod`: Transformation to apply after parsing
 *   - "calculateNightOf": Subtracts 1 day (Oura - converts wake-up date to "night of")
 *   - "convertUTCToEasternDate": Converts UTC to Eastern Time with DST handling (GitHub, Steam)
 *   - "split": Extracts date portion from ISO string (Strava)
 *   - "unixToLocal": Converts Unix timestamp to local Date (Withings - already handled in sourceFormat)
 * 
 * - `dateOffset`: Additional day offset to apply AFTER extractionMethod (usually 0)
 *   - Applied last in the pipeline: sourceFormat → extractionMethod → dateOffset
 *   - For Oura: Must be 0 because calculateNightOf already handles -1 day
 *   - Can be used for edge cases where extractionMethod + offset is needed
 * 
 * - `formatMethod`: Method to format date for storage (currently all use "formatDateOnly")
 * 
 * **Processing Pipeline:**
 * 1. Parse raw date based on `sourceFormat` → Date object
 * 2. Apply `extractionMethod` → transformed Date object
 * 3. Apply `dateOffset` → final Date object
 * 4. Format using `formatMethod` → YYYY-MM-DD string for storage
 */
const dateHandling = {
  /**
   * Oura Ring Configuration
   * 
   * **Special Case: Dual Date Extraction**
   * Oura API returns dates representing the wake-up morning (end of sleep session).
   * We store the "night of" date (the night you went to sleep).
   * 
   * **Why both ouraDate and nightOf?**
   * - `ouraDate`: Raw wake-up date from API (for reference/debugging)
   * - `nightOf`: Transformed "night of" date (for storage in Notion)
   * 
   * **Date Transformation:**
   * - API returns: "2025-10-28" (wake-up date)
   * - We store: "2025-10-27" (night of date)
   * - Logic: `calculateNightOf()` subtracts 1 day
   * - `dateOffset: 0` because calculateNightOf already handles the -1 day offset
   *   (setting dateOffset to -1 would cause double subtraction = -2 days, which is wrong)
   * 
   * **Note:** The OuraService also adds 1 day to endDate when querying the API
   * to include sleep sessions that wake up on the end date.
   */
  oura: {
    sourceFormat: "date_string", // API returns YYYY-MM-DD string
    sourceTimezone: "UTC",
    targetTimezone: "America/New_York",
    dateOffset: 0, // calculateNightOf already handles the -1 day offset (DO NOT set to -1)
    extractionMethod: "calculateNightOf", // Converts wake-up date to "night of" date
    formatMethod: "formatDateOnly",
  },
  /**
   * Strava Configuration
   * 
   * **Date Extraction:**
   * - API provides `start_date_local` which is already in local timezone
   * - Format: ISO datetime string (e.g., "2025-10-28T14:30:00-04:00")
   * - We extract just the date portion using "split" method
   * - No timezone conversion needed (already local)
   * - No date offset needed
   * 
   * **Note:** Time formatting (for calendar events) uses `formatTimestampWithOffset()`
   * directly from `date.js`, not the centralized handler, because it's time formatting,
   * not date extraction.
   */
  strava: {
    sourceFormat: "iso_local", // start_date_local is already in local timezone
    sourceTimezone: "local",
    targetTimezone: "local",
    dateOffset: 0,
    extractionMethod: "split", // Extract date portion from ISO datetime string
    formatMethod: "formatDateOnly",
  },
  /**
   * GitHub Configuration
   * 
   * **Date Extraction:**
   * - API provides commit dates in UTC (ISO format)
   * - We convert to Eastern Time for consistent date grouping
   * - Automatically handles DST transitions (EDT vs EST)
   * - No date offset needed (only timezone conversion)
   * 
   * **Why UTC to Eastern?**
   * - Commits made late at night UTC might be on a different calendar day in Eastern Time
   * - Converting ensures commits are grouped by the correct calendar day in Eastern Time
   * - Example: Commit at 2:00 AM UTC on Oct 28 = 10:00 PM EDT on Oct 27
   * 
   * **Note:** Date formatting for grouping uses `formatDate()` directly from `date.js`
   * because it's simple formatting, not extraction logic.
   */
  github: {
    sourceFormat: "iso_utc", // Commits are in UTC from GitHub API
    sourceTimezone: "UTC",
    targetTimezone: "America/New_York",
    dateOffset: 0,
    extractionMethod: "convertUTCToEasternDate", // Converts UTC to Eastern Time with DST handling
    formatMethod: "formatDateOnly",
  },
  /**
   * Steam Configuration
   * 
   * **Date Extraction:**
   * - API provides gaming session times in UTC
   * - We convert to Eastern Time for date extraction
   * - Automatically handles DST transitions (EDT vs EST)
   * - Date may adjust if gaming session crosses midnight in Eastern Time
   * 
   * **Important Distinction:**
   * - **Date extraction**: Uses centralized handler (`extractSourceDate`) for consistency
   * - **Time formatting**: Uses manual timezone conversion in collector for precise calendar event times
   * 
   * **Why manual time formatting?**
   * - Calendar events need precise ISO datetime strings with timezone offsets
   * - The collector needs to format startTime/endTime for calendar API
   * - This is time formatting (not date extraction), so it's handled separately
   * - Uses `getEasternOffset()` helper for DST-aware offset calculation
   * 
   * **Note:** The date extraction uses the centralized handler, but time formatting
   * is manual because calendar events require full datetime strings, not just dates.
   */
  steam: {
    sourceFormat: "iso_utc", // API returns UTC times
    sourceTimezone: "UTC",
    targetTimezone: "America/New_York",
    dateOffset: 0,
    extractionMethod: "convertUTCToEasternDate", // Converts UTC to Eastern Time with DST handling
    formatMethod: "formatDateOnly",
  },
  /**
   * Withings Configuration
   * 
   * **Date Extraction:**
   * - API provides Unix timestamps (seconds since epoch)
   * - We convert to local Date object (not UTC) to avoid timezone issues
   * - Uses local time to determine calendar day (not UTC)
   * 
   * **Why local time, not UTC?**
   * - Measurements taken at 7:07 PM EST should be stored as the same calendar day
   * - If we used UTC, a 7:07 PM EST measurement (12:07 AM UTC next day) would be wrong
   * - Example: Measurement at 7:07 PM EST on Oct 28 → stored as Oct 28 (not Oct 29)
   * 
   * **Processing:**
   * - `sourceFormat: "unix_timestamp"` converts seconds to milliseconds and creates Date
   * - `extractionMethod: "unixToLocal"` is a no-op (conversion already handled in sourceFormat)
   * - The Date object uses local timezone automatically when created from Unix timestamp
   */
  withings: {
    sourceFormat: "unix_timestamp", // API returns Unix timestamp in seconds
    sourceTimezone: "UTC",
    targetTimezone: "local", // Use local time to determine calendar day
    dateOffset: 0,
    extractionMethod: "unixToLocal", // No-op: conversion already handled in sourceFormat
    formatMethod: "formatDateOnly",
  },
};

module.exports = {
  oura,
  strava,
  withings,
  steam,
  github,
  rateLimits,
  retryConfig,
  dateHandling,
};
