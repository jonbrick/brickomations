#!/usr/bin/env node
/**
 * send-daily-text.js — text yourself a plain-text mirror of one zone of the day's
 * Obsidian daily note, with a tappable obsidian:// deep link for hand-edits.
 *
 * 1:1 zone lift: the daily note is authored to BE the message. Each slot lifts one
 * whole `## ` zone verbatim and renders it plain — no section cherry-picking, no
 * reordering, no reworded headers. The note is the source of truth; this script is a
 * read-only mirror. It never edits the note.
 *
 *   morning → ## Morning Brief   (morning/afternoon/evening frame · birthdays · today's tasks · planned events · calendar · training/meals)
 *   evening → ## Evening Report  (completed tasks · completed events · workout/etc · meeting recaps)
 *
 * Rendering is minimal (content stays 1:1 with the note):
 *   - `### Subsection` → a plain label line
 *   - `[[wikilinks]]` → display text; a trailing `— from [[note]]` provenance link is dropped
 *   - `**bold**` / `_italic_` / `` `code` `` markers stripped; `- ` bullets → `• `
 *   - subsections whose only content is an italic placeholder (`_no meetings_`) are skipped
 *   - if the whole zone is placeholders (nothing real happened) → nothing is sent
 *
 * Usage:
 *   node scripts/send-daily-text.js [--date YYYY-MM-DD] [--slot morning|evening] [--dry-run]
 *
 * The recipient number is read from brickbot's .env (ALERT_IMESSAGE_TARGET),
 * never hardcoded. Dry-run needs no send config at all.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const VAULT_DIR = path.join(os.homedir(), "projects", "brickocampus");
const VAULT_NAME = "brickocampus";
const BRICKBOT_DIR = path.join(os.homedir(), "projects", "brickbot");

// Each slot lifts exactly one `## ` zone from the daily note, verbatim.
const ZONE_FOR_SLOT = {
  morning: "Morning Brief",
  evening: "Evening Report",
};

// ---- args -----------------------------------------------------------------

function parseArgs(argv) {
  const args = { date: null, slot: "morning", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--date") args.date = argv[++i];
    else if (a.startsWith("--date=")) args.date = a.slice("--date=".length);
    else if (a === "--slot") args.slot = argv[++i];
    else if (a.startsWith("--slot=")) args.slot = a.slice("--slot=".length);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---- note resolution ------------------------------------------------------

// Find the daily note file for a YYYY-MM-DD date. Filenames carry the weekday
// (e.g. "2026-07-31 Friday.md"), so match by date prefix rather than guessing it.
function resolveNote(dateISO) {
  const year = dateISO.slice(0, 4);
  const yearMonth = dateISO.slice(0, 7);
  const dir = path.join(VAULT_DIR, "_daily", year, yearMonth);
  if (!fs.existsSync(dir)) {
    throw new Error(`Daily-note folder not found: ${dir}`);
  }
  const match = fs
    .readdirSync(dir)
    .find((f) => f.startsWith(`${dateISO} `) && f.endsWith(".md"));
  if (!match) {
    throw new Error(`No daily note found for ${dateISO} in ${dir}`);
  }
  const abs = path.join(dir, match);
  const relNoExt = path.relative(VAULT_DIR, abs).replace(/\.md$/, "");
  return { abs, relNoExt };
}

// ---- zone extraction ------------------------------------------------------

// Pre-2026-08-03 notes carry `## Logs` where the Evening Report zone now lives.
// Only matters for manual `--date` runs on historical notes — today/future notes
// use the new heading. Mirrors the evening-processor's legacy fallback.
const LEGACY_ALIASES = { "Evening Report": ["Logs"] };

// Body lines of a `## <zone>` — everything up to the next H2, a `---` rule, or EOF.
// INCLUDES the zone's `### ` subheadings and their bodies (that's the whole point:
// we lift the entire zone). Returns null if the zone (and any legacy alias) is absent.
function extractZone(lines, zone) {
  const candidates = [zone, ...(LEGACY_ALIASES[zone] || [])];
  let startIdx = -1;
  for (const name of candidates) {
    startIdx = lines.findIndex((l) => l.trim() === `## ${name}`);
    if (startIdx !== -1) break;
  }
  if (startIdx === -1) return null;
  const body = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break; // next H2 = next zone (### does not match \s after ##)
    if (/^---\s*$/.test(l)) break; // zone separator
    body.push(l);
  }
  return body;
}

// ---- markdown -> plain text -----------------------------------------------

function cleanInline(text) {
  return text
    .replace(/\s*—\s*from\s+\[\[[^\]]+\]\]\s*$/i, "") // drop vault provenance backlink (— from [[note]])
    .replace(/\[\[([^\]]+)\]\]/g, (_m, inner) => inner.split("|").pop()) // wikilinks -> display text
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/_([^_\n]+)_/g, "$1"); // italic
}

// Non-blank, non-comment content of a subsection body (raw, pre-clean).
// Skips whole HTML comment blocks, including multi-line ones — their interior
// lines don't start with `<!--`, and letting them through made a placeholder-only
// section (a template comment above `_no meetings_`) read as real content, which
// defeated both this-section suppression and the empty-night suppress. Mirrors the
// inComment tracking in cleanBody().
function realBodyLines(rawBody) {
  const out = [];
  let inComment = false;
  for (const raw of rawBody) {
    const l = raw.trim();
    if (inComment) {
      if (l.includes("-->")) inComment = false;
      continue;
    }
    if (l.includes("<!--")) {
      if (!l.includes("-->")) inComment = true; // single-line comment closes on this line
      continue;
    }
    if (!l) continue;
    out.push(l);
  }
  return out;
}

// A subsection whose only content is italic placeholders (e.g. "_no meetings_")
// carries nothing — skip it rather than print a "Header / no X" line.
function isPlaceholderOnly(rawBody) {
  const real = realBodyLines(rawBody);
  return real.length > 0 && real.every((l) => /^_.+_$/.test(l));
}

// Clean a subsection body into compact plain-text lines.
function cleanBody(rawBody) {
  const out = [];
  let inFence = false;
  let inComment = false;
  for (const raw of rawBody) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line.includes("<!--")) inComment = true;
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.trim() === "") continue;
    const bulleted = line.replace(/^(\s*)-\s+/, "$1• ");
    out.push(cleanInline(bulleted));
  }
  return out;
}

// ---- message assembly -----------------------------------------------------

function buildHeader(lines) {
  const h1 = lines.find((l) => /^#\s/.test(l));
  const dateLabel = h1 ? h1.replace(/^#\s+/, "").trim() : "Daily note";
  const weekLine = lines.find((l) => /\*\*Week\s+\d+\*\*/.test(l));
  const weekMatch = weekLine && weekLine.match(/Week\s+(\d+)/);
  return weekMatch ? `${dateLabel} · Week ${weekMatch[1]}` : dateLabel;
}

// Split a zone body into { title, rawBody } subsections keyed by `### ` headings,
// then render each (skipping placeholder-only ones) into a labeled text block.
function renderZone(zoneBody) {
  const subs = [];
  let current = null;
  for (const l of zoneBody) {
    const h3 = l.match(/^###\s+(.*)$/);
    if (h3) {
      current = { title: h3[1].trim(), rawBody: [] };
      subs.push(current);
      continue;
    }
    if (!current) {
      // Content before any ### (a zone-level comment or stray line) — bucket headless.
      current = { title: null, rawBody: [] };
      subs.push(current);
    }
    current.rawBody.push(l);
  }

  const blocks = [];
  for (const s of subs) {
    if (isPlaceholderOnly(s.rawBody)) continue;
    const cleaned = cleanBody(s.rawBody);
    if (cleaned.length === 0) continue;
    blocks.push((s.title ? `${s.title}\n` : "") + cleaned.join("\n"));
  }
  return blocks;
}

function buildMessage({ lines, zone, relNoExt }) {
  const zoneBody = extractZone(lines, zone);
  if (zoneBody === null) {
    return { message: null, reason: `zone "## ${zone}" not found in note` };
  }
  const blocks = renderZone(zoneBody);
  if (blocks.length === 0) {
    return { message: null, reason: "nothing real in the zone — empty-night suppress" };
  }
  const link =
    `obsidian://open?vault=${VAULT_NAME}` +
    `&file=${encodeURIComponent(relNoExt)}`;
  const parts = [
    buildHeader(lines),
    ...blocks,
    `Tap to open & edit in Obsidian:\n${link}`,
  ];
  return { message: parts.join("\n\n"), reason: null };
}

// ---- send -----------------------------------------------------------------

function readAlertTarget() {
  const envPath = path.join(BRICKBOT_DIR, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env not found at ${envPath}`);
  }
  const line = fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("ALERT_IMESSAGE_TARGET="));
  if (!line) throw new Error("ALERT_IMESSAGE_TARGET not set in .env");
  return line.slice("ALERT_IMESSAGE_TARGET=".length).trim();
}

function sendIMessage(target, message) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `tell application "Messages"
    set theService to 1st service whose service type = iMessage
    set theBuddy to buddy "${esc(target)}" of theService
    send "${esc(message)}" to theBuddy
end tell`;
  const tmp = path.join(os.tmpdir(), `brickbot-daily-text-${process.pid}.applescript`);
  fs.writeFileSync(tmp, script);
  try {
    execFileSync("osascript", [tmp], { stdio: "ignore", timeout: 30000 });
  } finally {
    fs.unlinkSync(tmp);
  }
}

// ---- main -----------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dateISO = args.date || todayLocalISO();
  const zone = ZONE_FOR_SLOT[args.slot];
  if (!zone) {
    throw new Error(`Unknown slot "${args.slot}" (expected: ${Object.keys(ZONE_FOR_SLOT).join(", ")})`);
  }

  const { abs, relNoExt } = resolveNote(dateISO);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const { message, reason } = buildMessage({ lines, zone, relNoExt });

  if (message === null) {
    // Empty-night suppress (or missing zone): send nothing, exit cleanly.
    console.log(`[send-daily-text] ${dateISO} ${args.slot}: no send — ${reason}`);
    return;
  }

  if (args.dryRun) {
    console.log(`[dry-run] date=${dateISO} slot=${args.slot} zone="## ${zone}"`);
    console.log(`[dry-run] note: ${abs}`);
    console.log(`[dry-run] message length: ${message.length} chars`);
    console.log("\n----- message -----\n");
    console.log(message);
    console.log("\n----- end -----");
    return;
  }

  const target = readAlertTarget();
  sendIMessage(target, message);
  console.log(`Sent ${args.slot} digest for ${dateISO} to your number.`);
}

main();
