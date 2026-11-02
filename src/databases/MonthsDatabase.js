/**
 * Months Database
 * Queries Notion months database to get weeks for a month via relation properties
 */

const NotionDatabase = require("./NotionDatabase");
const config = require("../config");

class MonthsDatabase extends NotionDatabase {
  constructor() {
    super();
    // Get property configs
    this.yearsProps = config.notion.properties.years;
    this.monthsProps = config.notion.properties.months;
    this.summaryProps = config.notion.properties.personalSummary;
    
    this.databaseId = config.notion.databases.months;
    this.yearsDatabaseId = config.notion.databases.years;
  }

  /**
   * Get Year page ID from Years database
   * @param {number} year - Year number (e.g., 2025)
   * @returns {Promise<string|null>} Year page ID or null if not found
   */
  async getYearPageId(year) {
    if (!this.yearsDatabaseId) {
      throw new Error("NOTION_YEARS_DATABASE_ID is not configured");
    }

    try {
      const filter = {
        property: config.notion.getPropertyName(this.yearsProps.year),
        title: {
          equals: year.toString(),
        },
      };

      const results = await this.queryDatabase(this.yearsDatabaseId, filter);

      if (results.length === 0) {
        if (process.env.DEBUG) {
          console.warn(`Year ${year} not found in Years database`);
        }
        return null;
      }

      return results[0].id;
    } catch (error) {
      throw new Error(`Failed to get Year page ID: ${error.message}`);
    }
  }

  /**
   * Find a month page by formatted title and year
   * @param {number} month - Month number (1-12)
   * @param {number} year - Year
   * @returns {Promise<Object|null>} Notion page or null
   */
  async findMonthPage(month, year) {
    if (!this.databaseId) {
      throw new Error("MONTHS_DATABASE_ID is not configured");
    }

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const monthAbbr = monthNames[month - 1];
    if (!monthAbbr) {
      throw new Error(`Invalid month number: ${month}. Must be 1-12`);
    }

    const title = `${String(month).padStart(2, "0")}. ${monthAbbr}`;

    // Get Year page ID
    const yearPageId = await this.getYearPageId(year);
    if (!yearPageId) {
      return null;
    }

    try {
      const filter = {
        and: [
          {
            property: config.notion.getPropertyName(this.monthsProps.month),
            title: { equals: title },
          },
          {
            property: config.notion.getPropertyName(this.monthsProps.year),
            relation: { contains: yearPageId },
          },
        ],
      };

      const results = await this.queryDatabase(this.databaseId, filter);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      throw new Error(`Failed to find month page: ${error.message}`);
    }
  }

  /**
   * Extract week number from week page title
   * Handles formats like "Week 11", "Week 11 Personal Summary", "Week 11 Work Summary"
   * @param {Object} weekPage - Notion week page object
   * @returns {number|null} Week number or null if not found
   */
  extractWeekNumberFromPage(weekPage) {
    // Use config to get title property name
    const weeksProps = config.notion.properties.weeks;
    const titlePropName = config.notion.getPropertyName(weeksProps.week);
    const prop = weekPage.properties[titlePropName];
    let title = "";
    
    if (prop && prop.type === "title" && prop.title && prop.title.length > 0) {
      title = prop.title[0].plain_text || "";
    }

    if (!title) {
      return null;
    }

    // Match "Week 11" or "Week 11 Personal Summary" etc.
    const match = title.match(/Week (\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Get weeks for a month from Notion relation property
   * @param {number} month - Month number (1-12)
   * @param {number} year - Year
   * @returns {Promise<Array>} Array of {weekNumber, year} objects, sorted by week number
   */
  async getWeeksForMonth(month, year) {
    if (!this.databaseId) {
      throw new Error("MONTHS_DATABASE_ID is not configured");
    }

    // Find the month page
    const monthPage = await this.findMonthPage(month, year);
    if (!monthPage) {
      return [];
    }

    // Get "Weeks" relation property from config
    const relationPropName = config.notion.getPropertyName(this.monthsProps.weeks);
    const relationProperty = monthPage.properties[relationPropName];

    if (!relationProperty || relationProperty.type !== "relation") {
      if (process.env.DEBUG) {
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        const monthName = monthNames[month - 1];
        console.warn(
          `No "Weeks" relation column found on ${monthName} ${year} page.`
        );
      }
      return [];
    }

    const weekRelations = relationProperty.relation || [];
    if (weekRelations.length === 0) {
      return [];
    }

    // Fetch each linked week page and extract week number
    const weeks = [];
    for (const rel of weekRelations) {
      try {
        const weekPage = await this.getPage(rel.id);

        const weekNumber = this.extractWeekNumberFromPage(weekPage);
        if (weekNumber !== null) {
          weeks.push({
            weekNumber,
            year,
          });
        }
      } catch (error) {
        // Skip invalid week pages, but log warning
        if (process.env.DEBUG) {
          console.warn(
            `Warning: Could not fetch week page ${rel.id}: ${error.message}`
          );
        }
      }
    }

    // Sort by week number
    return weeks.sort((a, b) => a.weekNumber - b.weekNumber);
  }
}

module.exports = MonthsDatabase;
