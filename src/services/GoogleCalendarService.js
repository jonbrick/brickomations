/**
 * Google Calendar Service
 * Service for interacting with the Google Calendar API
 */

const { google } = require("googleapis");
const config = require("../config");

class GoogleCalendarService {
  constructor(accountType = "personal") {
    this.accountType = accountType;
    const credentials =
      accountType === "work"
        ? config.calendar.getWorkCredentials()
        : config.calendar.getPersonalCredentials();

    if (!credentials) {
      throw new Error(
        `Google Calendar credentials for ${accountType} account are not configured`
      );
    }

    if (
      !credentials.clientId ||
      !credentials.clientSecret ||
      !credentials.refreshToken
    ) {
      throw new Error(
        `Google Calendar credentials for ${accountType} account are incomplete`
      );
    }

    this.oauth2Client = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      "urn:ietf:wg:oauth:2.0:oob"
    );

    this.oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
    });

    this.calendar = google.calendar({ version: "v3", auth: this.oauth2Client });
  }

  /**
   * List all calendars
   *
   * @returns {Promise<Array>} List of calendars
   */
  async listCalendars() {
    try {
      const response = await this.calendar.calendarList.list();
      return response.data.items || [];
    } catch (error) {
      throw new Error(
        `Failed to list calendars: ${
          error.response?.data?.error?.message || error.message
        }`
      );
    }
  }

  /**
   * Get a calendar's event labels (the named colors in the event color picker)
   *
   * Labels past Google's 11 legacy colors carry no `colorId` on the event —
   * only `eventLabelId` — so the label name is the only way to classify them.
   *
   * @param {string} calendarId - Calendar ID
   * @returns {Promise<Object>} Map of label id → label name (unnamed labels omitted)
   */
  async getEventLabels(calendarId) {
    try {
      const response = await this.calendar.calendars.get({ calendarId });
      const labels = response.data.labelProperties?.eventLabels || [];
      return Object.fromEntries(
        labels.filter((l) => l.name).map((l) => [l.id, l.name])
      );
    } catch (error) {
      throw new Error(
        `Failed to get event labels: ${
          error.response?.data?.error?.message || error.message
        }`
      );
    }
  }

  /**
   * Create a calendar event
   *
   * @param {string} calendarId - Calendar ID
   * @param {Object} eventData - Event data
   * @returns {Promise<Object>} Created event
   */
  async createEvent(calendarId, eventData) {
    try {
      const response = await this.calendar.events.insert({
        calendarId: calendarId,
        resource: eventData,
      });

      return response.data;
    } catch (error) {
      throw new Error(
        `Failed to create calendar event: ${
          error.response?.data?.error?.message || error.message
        }`
      );
    }
  }

  /**
   * Get a calendar event by ID
   *
   * @param {string} calendarId - Calendar ID
   * @param {string} eventId - Event ID
   * @returns {Promise<Object|null>} Event object or null if not found
   */
  async getEvent(calendarId, eventId) {
    try {
      const response = await this.calendar.events.get({
        calendarId: calendarId,
        eventId: eventId,
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // Event not found
      }
      throw new Error(
        `Failed to get calendar event: ${
          error.response?.data?.error?.message || error.message
        }`
      );
    }
  }

  /**
   * Update a calendar event
   *
   * @param {string} calendarId - Calendar ID
   * @param {string} eventId - Event ID
   * @param {Object} eventData - Event data
   * @returns {Promise<Object>} Updated event
   */
  async updateEvent(calendarId, eventId, eventData) {
    try {
      const response = await this.calendar.events.update({
        calendarId: calendarId,
        eventId: eventId,
        resource: eventData,
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error("Event not found");
      }
      throw new Error(
        `Failed to update calendar event: ${
          error.response?.data?.error?.message || error.message
        }`
      );
    }
  }

  /**
   * Delete a calendar event
   *
   * @param {string} calendarId - Calendar ID
   * @param {string} eventId - Event ID
   * @returns {Promise<boolean>} True if deleted or already deleted
   */
  async deleteEvent(calendarId, eventId) {
    try {
      await this.calendar.events.delete({
        calendarId: calendarId,
        eventId: eventId,
      });
      return true;
    } catch (error) {
      if (error.response?.status === 404) {
        return true; // Already deleted, treat as success
      }
      throw new Error(
        `Failed to delete calendar event: ${
          error.response?.data?.error?.message || error.message
        }`
      );
    }
  }

  /**
   * List events in a calendar for a date range
   *
   * @param {string} calendarId - Calendar ID
   * @param {Date} timeMin - Start time
   * @param {Date} timeMax - End time
   * @returns {Promise<Array>} List of events
   */
  async listEvents(calendarId, timeMin, timeMax) {
    try {
      const items = [];
      let pageToken;
      do {
        const response = await this.calendar.events.list({
          calendarId: calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          pageToken,
        });
        if (response.data.items) items.push(...response.data.items);
        pageToken = response.data.nextPageToken;
      } while (pageToken);
      return items;
    } catch (error) {
      throw new Error(
        `Failed to list calendar events: ${
          error.response?.data?.error?.message || error.message
        }`
      );
    }
  }

  /**
   * Refresh the access token
   * Uses the refresh token to get a new access token
   *
   * @returns {Promise<Object>} Token info
   */
  async refreshToken() {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);
      return credentials;
    } catch (error) {
      // Preserve invalid_grant errors for better error handling upstream
      const errorMessage = error.response?.data?.error || error.message;
      if (errorMessage.includes("invalid_grant")) {
        throw new Error(
          `invalid_grant: ${
            error.response?.data?.error_description ||
            "Refresh token expired or revoked"
          }`
        );
      }
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  /**
   * Sleep helper for rate limiting
   *
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Promise that resolves after delay
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = GoogleCalendarService;
