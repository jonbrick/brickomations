// Transforms WoW activities to Notion properties.
// WoW rows live in the Steam DB with identical properties, so this reuses the
// Steam transformer as-is.

const {
  transformSteamToNotion,
  batchTransformSteamToNotion,
} = require("./steam-to-notion-steam");

module.exports = {
  transformWowToNotion: transformSteamToNotion,
  batchTransformWowToNotion: batchTransformSteamToNotion,
};
