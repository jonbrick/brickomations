/**
 * @fileoverview World of Warcraft Database Configuration
 * @layer 1 - API → Notion (Integration name)
 *
 * WoW sessions share the Steam video games DB (NOTION_VIDEO_GAMES_DATABASE_ID)
 * with identical properties, so this re-exports the Steam config.
 */

module.exports = require("./steam");
