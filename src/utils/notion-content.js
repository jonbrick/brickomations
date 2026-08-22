/**
 * Notion block ↔ markdown conversion utilities
 *
 * Converts Notion page content (blocks) to/from markdown.
 * Handles the common block types used in task pages:
 * paragraphs, to_do, headings, lists, code, quotes, dividers.
 *
 * @layer utility
 */

// --- Rich text helpers ---

/**
 * Split a string into Notion rich_text elements ≤ maxLen chars each.
 * Notion caps each rich_text element's content at 2000 chars but accepts an
 * array of many elements per property (concatenated on display).
 *
 * Prefers `\n` then space boundaries for readability when inspecting the
 * raw API response; falls back to a hard cut.
 */
function chunkRichText(value, maxLen = 2000) {
  if (value === "" || value == null) return [];
  if (value.length <= maxLen) return [{ text: { content: value } }];

  const chunks = [];
  let remaining = value;
  while (remaining.length > maxLen) {
    const window = remaining.slice(0, maxLen);
    const nl = window.lastIndexOf("\n");
    const sp = window.lastIndexOf(" ");
    const cut = nl > 0 ? nl + 1 : sp > 0 ? sp + 1 : maxLen;
    chunks.push({ text: { content: remaining.slice(0, cut) } });
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) chunks.push({ text: { content: remaining } });
  return chunks;
}

/**
 * Convert Notion rich_text array to markdown string
 */
function richTextToMarkdown(richText) {
  if (!richText || !Array.isArray(richText)) return "";

  return richText
    .map((segment) => {
      // API blocks carry plain_text/href; locally-built blocks
      // (markdownToBlocks output) only have text.content / text.link.url.
      // The fallbacks let markdown → blocks → markdown round-trip without
      // an API write, which body change-detection relies on.
      let text = segment.plain_text ?? segment.text?.content ?? "";
      if (!text) return "";

      const ann = segment.annotations || {};

      // Apply annotations inside-out: code first, then bold/italic/strikethrough
      if (ann.code) text = `\`${text}\``;
      if (ann.bold) text = `**${text}**`;
      if (ann.italic) text = `*${text}*`;
      if (ann.strikethrough) text = `~~${text}~~`;

      // Links
      const href = segment.href || segment.text?.link?.url;
      if (href) {
        text = `[${text}](${href})`;
      }

      return text;
    })
    .join("");
}

/**
 * Convert markdown inline text to Notion rich_text array.
 * Handles: bold, italic, strikethrough, code, links.
 * For simplicity, treats the whole string as one text segment with annotations.
 */
function markdownToRichText(text) {
  if (!text) return [];

  // Simple approach: parse basic inline formatting
  // For round-trip fidelity on task pages, this covers 99% of cases
  const segments = [];
  let remaining = text;

  // Parse links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(remaining)) !== null) {
    // Text before the link
    if (match.index > lastIndex) {
      segments.push(...parseInlineFormatting(remaining.slice(lastIndex, match.index)));
    }
    // The link itself. Linear wraps URLs in angle brackets
    // ([text](<url>)) — strip them, or Notion percent-encodes the
    // brackets into the stored URL and round-trips never converge.
    const url = match[2].replace(/^<(.*)>$/, "$1");
    segments.push({
      type: "text",
      text: { content: match[1], link: { url } },
    });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last link
  if (lastIndex < remaining.length) {
    segments.push(...parseInlineFormatting(remaining.slice(lastIndex)));
  }

  if (segments.length === 0 && text) {
    segments.push({ type: "text", text: { content: text } });
  }

  return segments;
}

/**
 * Parse inline markdown formatting (bold, italic, code, strikethrough)
 * Returns array of Notion rich_text segments
 */
function parseInlineFormatting(text) {
  if (!text) return [];

  // For simplicity, return as plain text — Notion preserves formatting from pull,
  // and most task content is plain text or checkboxes. Chunked so a single
  // long line can't exceed Notion's 2000-char rich_text element cap.
  return chunkRichText(text).map((seg) => ({ type: "text", ...seg }));
}

// --- Blocks → Markdown ---

/**
 * Convert an array of Notion blocks to a markdown string.
 * Handles nested children with indentation.
 *
 * @param {Array} blocks - Notion block objects
 * @param {number} depth - Indentation level (0 = top-level)
 * @returns {string} Markdown string
 */
function blocksToMarkdown(blocks, depth = 0) {
  if (!blocks || blocks.length === 0) return "";

  const indent = "  ".repeat(depth);
  const lines = [];
  let numberedCounter = 0;

  for (const block of blocks) {
    const type = block.type;

    // Reset numbered counter when we hit a non-numbered block
    if (type !== "numbered_list_item") {
      numberedCounter = 0;
    }

    switch (type) {
      case "paragraph":
        lines.push(indent + richTextToMarkdown(block.paragraph?.rich_text));
        break;

      case "heading_1":
        lines.push(indent + "# " + richTextToMarkdown(block.heading_1?.rich_text));
        break;

      case "heading_2":
        lines.push(indent + "## " + richTextToMarkdown(block.heading_2?.rich_text));
        break;

      case "heading_3":
        lines.push(indent + "### " + richTextToMarkdown(block.heading_3?.rich_text));
        break;

      case "bulleted_list_item":
        lines.push(indent + "- " + richTextToMarkdown(block.bulleted_list_item?.rich_text));
        break;

      case "numbered_list_item":
        numberedCounter++;
        lines.push(indent + `${numberedCounter}. ` + richTextToMarkdown(block.numbered_list_item?.rich_text));
        break;

      case "to_do": {
        const checked = block.to_do?.checked ? "x" : " ";
        lines.push(indent + `- [${checked}] ` + richTextToMarkdown(block.to_do?.rich_text));
        break;
      }

      case "code":
        lines.push(indent + "```" + (block.code?.language || ""));
        lines.push(indent + richTextToMarkdown(block.code?.rich_text));
        lines.push(indent + "```");
        break;

      case "quote":
        lines.push(indent + "> " + richTextToMarkdown(block.quote?.rich_text));
        break;

      case "callout": {
        const icon = block.callout?.icon?.emoji || "";
        lines.push(indent + "> " + icon + " " + richTextToMarkdown(block.callout?.rich_text));
        break;
      }

      case "divider":
        lines.push(indent + "---");
        break;

      case "toggle":
        lines.push(indent + richTextToMarkdown(block.toggle?.rich_text));
        break;

      case "image": {
        const url = block.image?.file?.url || block.image?.external?.url || "";
        const caption = richTextToMarkdown(block.image?.caption) || "image";
        if (url) lines.push(indent + `![${caption}](${url})`);
        break;
      }

      case "bookmark":
        lines.push(indent + (block.bookmark?.url || ""));
        break;

      case "table_of_contents":
        // Skip — not meaningful in markdown export
        break;

      default:
        // For unknown block types, try to extract any rich_text
        if (block[type]?.rich_text) {
          lines.push(indent + richTextToMarkdown(block[type].rich_text));
        }
        break;
    }

    // Handle nested children
    if (block.children && block.children.length > 0) {
      lines.push(blocksToMarkdown(block.children, depth + 1));
    }
  }

  return lines.join("\n");
}

// --- Markdown → Blocks ---

/**
 * Convert a markdown string to Notion block objects.
 * Handles the block types commonly used in task pages.
 *
 * @param {string} markdown - Markdown string
 * @returns {Array} Notion block objects ready for API
 */
function markdownToBlocks(markdown) {
  if (!markdown || !markdown.trim()) return [];

  const lines = markdown.split("\n");
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) continue;

    // Code blocks
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3) || "plain text";
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      // Chunked: a long code block easily exceeds the 2000-char element cap.
      blocks.push({
        type: "code",
        code: {
          rich_text: chunkRichText(codeLines.join("\n")).map((seg) => ({
            type: "text",
            ...seg,
          })),
          language,
        },
      });
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      blocks.push({
        type: "heading_3",
        heading_3: { rich_text: markdownToRichText(line.slice(4)) },
      });
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({
        type: "heading_2",
        heading_2: { rich_text: markdownToRichText(line.slice(3)) },
      });
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({
        type: "heading_1",
        heading_1: { rich_text: markdownToRichText(line.slice(2)) },
      });
      continue;
    }

    // Dividers
    if (line.trim() === "---" || line.trim() === "***" || line.trim() === "___") {
      blocks.push({ type: "divider", divider: {} });
      continue;
    }

    // To-do items
    const todoMatch = line.match(/^- \[([ xX])\] (.*)$/);
    if (todoMatch) {
      blocks.push({
        type: "to_do",
        to_do: {
          rich_text: markdownToRichText(todoMatch[2]),
          checked: todoMatch[1].toLowerCase() === "x",
        },
      });
      continue;
    }

    // Bulleted list
    if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: markdownToRichText(line.slice(2)),
        },
      });
      continue;
    }

    // Numbered list
    const numberedMatch = line.match(/^(\d+)\. (.*)$/);
    if (numberedMatch) {
      blocks.push({
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: markdownToRichText(numberedMatch[2]),
        },
      });
      continue;
    }

    // Block quotes
    if (line.startsWith("> ")) {
      blocks.push({
        type: "quote",
        quote: { rich_text: markdownToRichText(line.slice(2)) },
      });
      continue;
    }

    // Default: paragraph
    blocks.push({
      type: "paragraph",
      paragraph: { rich_text: markdownToRichText(line) },
    });
  }

  return blocks;
}

module.exports = {
  blocksToMarkdown,
  markdownToBlocks,
  richTextToMarkdown,
  markdownToRichText,
  chunkRichText,
};
