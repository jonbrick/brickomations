#!/usr/bin/env node
/**
 * send-daily-text.js — text yourself a plain-text digest of the day's Obsidian
 * daily note, with a tappable obsidian:// deep link back into the note for hand-edits.
 *
 * Read-only surface of Cowork's already-generated content: the script reads the
 * finished daily note, pulls the chosen sections, strips markdown so it reads
 * clean in iMessage, and (unless --dry-run) sends via the same osascript +
 * Messages.app path the heartbeat watchdog uses. It never edits the note.
 *
 * Usage:
 *   node scripts/send-daily-text.js [--date YYYY-MM-DD] [--slot morning|evening] [--dry-run]
 *
 *   --date     Target daily note date. Default: today (local time).
 *   --slot     Which section set to send. Default: morning.
 *   --dry-run  Print the composed message to the console; send nothing.
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

// Which `## ` sections go in each slot. Morning is the proven set; evening is a
// placeholder until the evening sections are settled.
const SECTION_SETS = {
  morning: ["Today", "Calendar Blocks", "Training & Meals"],
  evening: ["Today", "Work Meetings", "Personal Meetings"],
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
  const relNoExt = path
    .relative(VAULT_DIR, abs)
    .replace(/\.md$/, ""); // e.g. "_daily/2026/2026-07/2026-07-31 Friday"
  return { abs, relNoExt };
}

// ---- section extraction ---------------------------------------------------

// Body lines under a `## <heading>`, up to the next heading, `---`, or EOF.
// Skips fenced code blocks and HTML comments (dataview/tasks queries, template notes).
function extractSection(lines, heading) {
  const startIdx = lines.findIndex((l) => {
    const t = l.trim();
    return t === `## ${heading}` || t === `### ${heading}`;
  });
  if (startIdx === -1) return null; // heading absent

  const body = [];
  let inFence = false;
  let inComment = false;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!inFence && !inComment && (/^#{1,6}\s/.test(l) || /^---\s*$/.test(l))) break;

    if (/^\s*```/.test(l)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (l.includes("<!--")) inComment = true;
    if (inComment) {
      if (l.includes("-->")) inComment = false;
      continue;
    }
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

// Clean a section body into compact plain-text lines. Empty -> [].
function cleanSection(body) {
  const out = [];
  for (const raw of body) {
    const line = raw.replace(/\s+$/, "");
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

function buildMessage({ lines, sectionNames, relNoExt }) {
  const parts = [buildHeader(lines)];
  const skipped = [];

  for (const name of sectionNames) {
    const body = extractSection(lines, name);
    if (body === null) {
      skipped.push(`${name} (heading absent)`);
      continue;
    }
    const cleaned = cleanSection(body);
    if (cleaned.length === 0) {
      skipped.push(`${name} (empty)`);
      continue;
    }
    parts.push(`\n${name}\n${cleaned.join("\n")}`);
  }

  const link =
    `obsidian://open?vault=${VAULT_NAME}` +
    `&file=${encodeURIComponent(relNoExt)}`;
  parts.push(`\nTap to open & edit in Obsidian:\n${link}`);

  return { message: parts.join("\n"), skipped };
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
  const sectionNames = SECTION_SETS[args.slot];
  if (!sectionNames) {
    throw new Error(`Unknown slot "${args.slot}" (expected: ${Object.keys(SECTION_SETS).join(", ")})`);
  }

  const { abs, relNoExt } = resolveNote(dateISO);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const { message, skipped } = buildMessage({ lines, sectionNames, relNoExt });

  if (args.dryRun) {
    console.log(`[dry-run] date=${dateISO} slot=${args.slot}`);
    console.log(`[dry-run] note: ${abs}`);
    console.log(`[dry-run] sections: ${sectionNames.join(", ")}`);
    if (skipped.length) console.log(`[dry-run] skipped: ${skipped.join(", ")}`);
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
