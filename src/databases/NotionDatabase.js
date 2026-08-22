// Generic CRUD operations for Notion databases

const { Client } = require("@notionhq/client");
const config = require("../config");
const { formatDate, formatDateOnly } = require("../utils/date");
const { delay } = require("../utils/async");
const { chunkRichText } = require("../utils/notion-content");
const { pick } = require("../utils/property-lookup");

class NotionDatabase {
  constructor() {
    this.client = new Client({
      auth: config.notion.getToken(),
    });
  }

  /**
   * Query database with filters
   *
   * @param {string} databaseId - Database ID
   * @param {Object} filter - Notion filter object
   * @param {Array} sorts - Sort configuration
   * @returns {Promise<Array>} Query results
   */
  async queryDatabase(databaseId, filter = null, sorts = null) {
    try {
      const options = {
        database_id: databaseId,
      };

      if (filter) {
        options.filter = filter;
      }

      if (sorts) {
        options.sorts = sorts;
      }

      const response = await this.client.databases.query(options);
      return response.results;
    } catch (error) {
      throw new Error(`Failed to query database: ${error.message}`);
    }
  }

  /**
   * Query database with pagination support
   *
   * @param {string} databaseId - Database ID
   * @param {Object} filter - Notion filter object
   * @param {Array} sorts - Sort configuration
   * @returns {Promise<Array>} All results
   */
  async queryDatabaseAll(databaseId, filter = null, sorts = null) {
    try {
      let results = [];
      let hasMore = true;
      let startCursor = undefined;

      while (hasMore) {
        const options = {
          database_id: databaseId,
          start_cursor: startCursor,
        };

        if (filter) {
          options.filter = filter;
        }

        if (sorts) {
          options.sorts = sorts;
        }

        const response = await this.client.databases.query(options);
        results = results.concat(response.results);

        hasMore = response.has_more;
        startCursor = response.next_cursor;

        // Rate limiting
        if (hasMore) {
          await delay(config.sources.rateLimits.notion.backoffMs);
        }
      }

      return results;
    } catch (error) {
      throw new Error(
        `Failed to query database with pagination: ${error.message}`
      );
    }
  }

  /**
   * Create a new page in a database
   *
   * @param {string} databaseId - Database ID
   * @param {Object} properties - Page properties
   * @param {Array} children - Page content blocks
   * @param {string|null} configKey - Optional config key to scope property type detection
   * @returns {Promise<Object>} Created page
   */
  async createPage(databaseId, properties, children = [], configKey = null) {
    try {
      const response = await this.client.pages.create({
        parent: { database_id: databaseId },
        properties: this._formatProperties(properties, configKey),
        children,
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to create page: ${error.message}`);
    }
  }

  /**
   * Update an existing page
   *
   * @param {string} pageId - Page ID
   * @param {Object} properties - Properties to update
   * @param {string|null} configKey - Optional config key to scope property type detection
   * @returns {Promise<Object>} Updated page
   */
  async updatePage(pageId, properties, configKey = null) {
    try {
      const response = await this.client.pages.update({
        page_id: pageId,
        properties: this._formatProperties(properties, configKey),
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to update page: ${error.message}`);
    }
  }

  /**
   * Set a page's icon to an emoji.
   *
   * @param {string} pageId - Page ID
   * @param {string} emoji - Emoji character
   * @returns {Promise<Object>} Updated page
   */
  async setPageIcon(pageId, emoji) {
    try {
      return await this.client.pages.update({
        page_id: pageId,
        icon: { type: "emoji", emoji },
      });
    } catch (error) {
      throw new Error(`Failed to set page icon: ${error.message}`);
    }
  }

  /**
   * Retrieve a page by ID
   *
   * @param {string} pageId - Page ID
   * @returns {Promise<Object>} Page object
   */
  async getPage(pageId) {
    try {
      const response = await this.client.pages.retrieve({
        page_id: pageId,
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to retrieve page: ${error.message}`);
    }
  }

  /**
   * Archive (delete) a page
   *
   * @param {string} pageId - Page ID
   * @returns {Promise<Object>} Archived page
   */
  async archivePage(pageId) {
    try {
      const response = await this.client.pages.update({
        page_id: pageId,
        archived: true,
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to archive page: ${error.message}`);
    }
  }

  /**
   * Batch create pages
   *
   * @param {string} databaseId - Database ID
   * @param {Array} pagesData - Array of {properties, children} objects
   * @returns {Promise<Array>} Created pages
   */
  async batchCreatePages(databaseId, pagesData) {
    const results = [];

    for (const pageData of pagesData) {
      try {
        const page = await this.createPage(
          databaseId,
          pageData.properties,
          pageData.children || []
        );
        results.push(page);

        // Rate limiting
        await delay(config.sources.rateLimits.notion.backoffMs);
      } catch (error) {
        results.push({ error: error.message });
      }
    }

    return results;
  }

  /**
   * Batch update pages
   *
   * @param {Array} updates - Array of {pageId, properties} objects
   * @returns {Promise<Array>} Updated pages
   */
  async batchUpdatePages(updates) {
    const results = [];

    for (const update of updates) {
      try {
        const page = await this.updatePage(update.pageId, update.properties);
        results.push(page);

        // Rate limiting
        await delay(config.sources.rateLimits.notion.backoffMs);
      } catch (error) {
        results.push({ pageId: update.pageId, error: error.message });
      }
    }

    return results;
  }

  /**
   * Fetch all block children of a page, with one level of nesting.
   *
   * @param {string} pageId - Page or block ID
   * @returns {Promise<Array>} Block objects (with nested children populated)
   */
  async getPageBlocks(pageId) {
    try {
      let blocks = [];
      let hasMore = true;
      let startCursor = undefined;

      while (hasMore) {
        const response = await this.client.blocks.children.list({
          block_id: pageId,
          start_cursor: startCursor,
        });

        blocks = blocks.concat(response.results);
        hasMore = response.has_more;
        startCursor = response.next_cursor;

        if (hasMore) {
          await delay(config.sources.rateLimits.notion.backoffMs);
        }
      }

      // Fetch one level of nested children
      for (const block of blocks) {
        if (block.has_children) {
          await delay(config.sources.rateLimits.notion.backoffMs);
          block.children = await this.getPageBlocks(block.id);
        }
      }

      return blocks;
    } catch (error) {
      throw new Error(`Failed to fetch page blocks: ${error.message}`);
    }
  }

  /**
   * Replace all content blocks on a page.
   * Deletes existing blocks then appends new ones.
   *
   * @param {string} pageId - Page ID
   * @param {Array} newBlocks - Notion block objects to write
   * @returns {Promise<Object>} { deleted: number, created: number }
   */
  async replacePageContent(pageId, newBlocks) {
    // 1. List existing blocks
    const existing = await this.client.blocks.children.list({
      block_id: pageId,
    });

    // 2. Delete each existing block
    let deleted = 0;
    for (const block of existing.results) {
      await delay(config.sources.rateLimits.notion.backoffMs);
      await this.client.blocks.delete({ block_id: block.id });
      deleted++;
    }

    // Handle pagination — delete remaining blocks
    let hasMore = existing.has_more;
    let cursor = existing.next_cursor;
    while (hasMore) {
      await delay(config.sources.rateLimits.notion.backoffMs);
      const more = await this.client.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
      });
      for (const block of more.results) {
        await delay(config.sources.rateLimits.notion.backoffMs);
        await this.client.blocks.delete({ block_id: block.id });
        deleted++;
      }
      hasMore = more.has_more;
      cursor = more.next_cursor;
    }

    // 3. Append new blocks (Notion allows max 100 children per append)
    let created = 0;
    if (newBlocks.length > 0) {
      for (let i = 0; i < newBlocks.length; i += 100) {
        const batch = newBlocks.slice(i, i + 100);
        await delay(config.sources.rateLimits.notion.backoffMs);
        await this.client.blocks.children.append({
          block_id: pageId,
          children: batch,
        });
        created += batch.length;
      }
    }

    return { deleted, created };
  }

  /**
   * Filter pages by date range
   *
   * @param {string} databaseId - Database ID
   * @param {string} dateProperty - Name of date property
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} Filtered pages
   */
  async filterByDateRange(databaseId, dateProperty, startDate, endDate) {
    const filter = {
      and: [
        {
          property: dateProperty,
          date: {
            on_or_after: startDate.toISOString().split("T")[0],
          },
        },
        {
          property: dateProperty,
          date: {
            on_or_before: endDate.toISOString().split("T")[0],
          },
        },
      ],
    };

    return await this.queryDatabaseAll(databaseId, filter);
  }

  /**
   * Filter pages by checkbox property
   *
   * @param {string} databaseId - Database ID
   * @param {string} checkboxProperty - Name of checkbox property
   * @param {boolean} checked - Checkbox value to filter
   * @returns {Promise<Array>} Filtered pages
   */
  async filterByCheckbox(databaseId, checkboxProperty, checked = false) {
    const filter = {
      property: checkboxProperty,
      checkbox: {
        equals: checked,
      },
    };

    return await this.queryDatabaseAll(databaseId, filter);
  }

  /**
   * Check if a page exists with a specific property value
   *
   * @param {string} databaseId - Database ID
   * @param {string} propertyName - Property name to check
   * @param {string} value - Value to search for
   * @returns {Promise<Object|null>} Existing page or null
   */
  async findPageByProperty(databaseId, propertyName, value) {
    try {
      // Detect property type and use appropriate filter
      const propertyType = this._getPropertyType(databaseId, propertyName);

      let filter;

      if (propertyType === "number") {
        // Convert to number if it's a string
        const numValue = typeof value === "string" ? parseFloat(value) : value;
        filter = {
          property: propertyName,
          number: {
            equals: numValue,
          },
        };
      } else {
        // Default to rich_text filter
        filter = {
          property: propertyName,
          rich_text: {
            equals: value,
          },
        };
      }

      const results = await this.queryDatabase(databaseId, filter);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      throw new Error(`Failed to find page by property: ${error.message}`);
    }
  }

  /**
   * Get property type for a database
   *
   * @param {string} databaseId - Database ID
   * @param {string} propertyName - Property name
   * @returns {string} Property type
   */
  _getPropertyType(databaseId, propertyName) {
    const properties = config.notion.properties;

    // Find the database key that matches this databaseId
    for (const dbKey in properties) {
      const dbId = config.notion.databases[dbKey];
      if (dbId === databaseId) {
        // Find the property that matches the propertyName
        const props = properties[dbKey];
        for (const propKey in props) {
          if (props[propKey].name === propertyName) {
            return props[propKey].type || "rich_text";
          }
        }
      }
    }

    // Default to rich_text if not found
    return "rich_text";
  }

  /**
   * Extract property value from page
   *
   * @param {Object} page - Notion page object
   * @param {string} propertyName - Property name
   * @returns {any} Property value
   */
  extractProperty(page, propertyName) {
    const property = pick(page.properties, propertyName);

    if (!property) {
      return null;
    }

    switch (property.type) {
      case "title":
        return property.title[0]?.plain_text || "";

      case "rich_text":
        return (property.rich_text || [])
          .map((s) => s.plain_text || "")
          .join("");

      case "number":
        return property.number;

      case "select":
        return property.select?.name || null;

      case "status":
        return property.status?.name || null;

      case "multi_select":
        return property.multi_select.map((item) => item.name);

      case "date":
        return property.date?.start || null;

      case "checkbox":
        return property.checkbox;

      case "url":
        return property.url;

      case "email":
        return property.email;

      case "phone_number":
        return property.phone_number;

      case "people":
        return property.people.map((person) => person.name);

      case "files":
        return property.files.map((file) => file.name);

      case "formula": {
        const formula = property.formula;
        if (!formula) return null;
        const t = formula.type;
        if (t === "string" && formula.string != null) return formula.string;
        if (t === "number" && formula.number != null) return String(formula.number);
        if (t === "boolean" && formula.boolean != null) return String(formula.boolean);
        if (t === "date" && formula.date?.start != null) return formula.date.start;
        return null;
      }

      case "rollup": {
        const rollup = property.rollup;
        if (!rollup) return null;
        if (rollup.type === "number") return rollup.number;
        if (rollup.type === "date") return rollup.date?.start || null;
        if (rollup.type === "array") {
          // Each array item is the rolled-up target property value of one related page
          return rollup.array.flatMap((item) =>
            item.type === "relation" ? item.relation.map((r) => r.id) : []
          );
        }
        return null;
      }

      default:
        return null;
    }
  }

  /**
   * Extract date range from a Notion date property
   * Returns both start and end dates for date range properties
   *
   * @param {Object} page - Notion page object
   * @param {string} propertyName - Property name
   * @returns {Object|null} Object with { start: "YYYY-MM-DD", end: "YYYY-MM-DD" } or null
   */
  extractDateRange(page, propertyName) {
    const property = page.properties[propertyName];

    if (!property || property.type !== "date" || !property.date) {
      return null;
    }

    const start = property.date.start;
    const end = property.date.end || property.date.start; // Fallback to start if no end

    if (!start) {
      return null;
    }

    // Format as YYYY-MM-DD for all-day events (strip time portion if present)
    const formatDate = (dateStr) => {
      if (!dateStr) return null;
      // Extract date portion (YYYY-MM-DD) from ISO string
      return dateStr.split("T")[0];
    };

    return {
      start: formatDate(start),
      end: formatDate(end),
    };
  }

  /**
   * Format properties for Notion API
   *
   * @param {Object} properties - Simple key-value properties
   * @param {string|null} configKey - Optional config key to scope property type detection
   * @returns {Object} Formatted Notion properties
   */
  _formatProperties(properties, configKey = null) {
    const formatted = {};

    Object.entries(properties).forEach(([key, value]) => {
      // Skip null/undefined values
      if (value === null || value === undefined) {
        return;
      }

      // Detect property type and format accordingly
      if (typeof value === "string") {
        // Skip empty strings for date properties
        const isDateOnlyProperty = this._isDateOnlyProperty(key);
        if (isDateOnlyProperty) {
          if (!value || value === "") {
            return; // Skip empty date strings
          }
          // String value for a date property - format as date
          formatted[key] = {
            date: { start: value },
          };
        } else {
          // Check if this property should be formatted as a title based on config
          const isTitleProperty = this._isTitleProperty(key, configKey);
          if (isTitleProperty) {
            formatted[key] = {
              title: [{ text: { content: value } }],
            };
          } else {
            // Check if this property should be a select type
            const isSelectProperty = this._isSelectProperty(key, configKey);
            if (isSelectProperty) {
              formatted[key] = {
                select: { name: value },
              };
            } else {
              // Check if this property should be a URL type
              const isUrlProperty = this._isUrlProperty(key, configKey);
              if (isUrlProperty) {
                formatted[key] = {
                  url: value || null,
                };
              } else {
                // Allow empty strings for rich_text to enable clearing fields
                // Notion API accepts empty rich_text arrays to clear fields.
                // Long values are split across multiple elements — Notion caps
                // each element at 2000 chars but concatenates them on display.
                formatted[key] = {
                  rich_text: chunkRichText(value),
                };
              }
            }
          }
        }
      } else if (typeof value === "number") {
        formatted[key] = {
          number: value,
        };
      } else if (typeof value === "boolean") {
        formatted[key] = {
          checkbox: value,
        };
      } else if (value instanceof Date) {
        // Check if this property should be date-only based on config
        const isDateOnlyProperty = this._isDateOnlyProperty(key);
        const dateValue = isDateOnlyProperty
          ? formatDateOnly(value)
          : value.toISOString();
        formatted[key] = {
          date: { start: dateValue },
        };
      } else if (Array.isArray(value)) {
        formatted[key] = {
          multi_select: value.map((item) => ({ name: item })),
        };
      } else if (typeof value === "object") {
        // Check if it's already a Notion API-formatted property
        const notionPropertyKeys = ['status', 'select', 'title', 'date', 'number', 'checkbox', 'rich_text', 'url', 'multi_select'];
        const hasNotionPropertyKey = Object.keys(value).some(key => notionPropertyKeys.includes(key));
        
        if (hasNotionPropertyKey) {
          // Already formatted for Notion API
          formatted[key] = value;
        } else if (value.type) {
          // Legacy format with type property
          formatted[key] = value;
        }
        // Otherwise skip (object doesn't match any pattern)
      }
    });

    return formatted;
  }

  /**
   * Check if a property key should be formatted as a title type
   * @param {string} key - Property key/name
   * @param {string|null} configKey - Optional config key to scope the check
   * @returns {boolean} True if it's a title property
   */
  _isTitleProperty(key, configKey = null) {
    const properties = config.notion.properties;

    // If configKey provided, only check that specific integration
    if (configKey) {
      const props = properties[configKey];
      if (props) {
        for (const propKey in props) {
          if (props[propKey].name === key && props[propKey].type === "title") {
            return true;
          }
        }
      }
      return false;
    }

    // Otherwise, check all databases (backward compatibility)
    let foundInConfig = false;
    let isTitleType = false;

    // Check all databases for this property
    for (const dbKey in properties) {
      const props = properties[dbKey];
      for (const propKey in props) {
        if (props[propKey].name === key) {
          foundInConfig = true;
          if (props[propKey].type === "title") {
            isTitleType = true;
            break;
          }
        }
      }
      if (foundInConfig && isTitleType) break;
    }

    // If found in config, use the config type
    if (foundInConfig) {
      return isTitleType;
    }

    return false;
  }

  /**
   * Check if a property key should be formatted as a date-only type
   * @param {string} key - Property key/name
   * @returns {boolean} True if it's a date-only property
   */
  _isDateOnlyProperty(key) {
    const properties = config.notion.properties;

    // Check all databases for date properties
    for (const dbKey in properties) {
      const props = properties[dbKey];
      for (const propKey in props) {
        if (props[propKey].name === key && props[propKey].type === "date") {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a property key should be formatted as a select type
   * @param {string} key - Property key/name
   * @param {string|null} configKey - Optional config key to scope the check
   * @returns {boolean} True if it's a select property
   */
  _isSelectProperty(key, configKey = null) {
    const properties = config.notion.properties;

    // If configKey provided, only check that specific integration
    if (configKey) {
      const props = properties[configKey];
      if (props) {
        for (const propKey in props) {
          if (props[propKey].name === key && props[propKey].type === "select") {
            return true;
          }
        }
      }
      return false;
    }

    // Otherwise, check all databases (backward compatibility)
    // Check all databases for select properties
    for (const dbKey in properties) {
      const props = properties[dbKey];
      for (const propKey in props) {
        if (props[propKey].name === key && props[propKey].type === "select") {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a property key should be formatted as a URL type
   * @param {string} key - Property key/name
   * @param {string|null} configKey - Optional config key to scope the check
   * @returns {boolean} True if it's a URL property
   */
  _isUrlProperty(key, configKey = null) {
    const properties = config.notion.properties;

    // If configKey provided, only check that specific integration
    if (configKey) {
      const props = properties[configKey];
      if (props) {
        for (const propKey in props) {
          if (props[propKey].name === key && props[propKey].type === "url") {
            return true;
          }
        }
      }
      return false;
    }

    // Otherwise, check all databases (backward compatibility)
    // Check all databases for URL properties
    for (const dbKey in properties) {
      const props = properties[dbKey];
      for (const propKey in props) {
        if (props[propKey].name === key && props[propKey].type === "url") {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Helper to format date as YYYY-MM-DD
   *
   * @param {Date} date - Date to format
   * @returns {string} Formatted date string
   */
  _formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

module.exports = NotionDatabase;
