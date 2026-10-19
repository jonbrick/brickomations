#!/usr/bin/env node
/**
 * send-daily-text.js — text yourself the day's summary from the Obsidian daily note,
 * with a tappable obsidian:// deep link back into the note.
 *
 * Exec-assistant model (2026-10-18): the text is no longer a mirror of the note.
 * Each slot lifts ONE subsection — the short prose summary the Cowork task writes —
 * and sends it as paragraphs, plus the note header and the link. The rest of the
 * zone (calendar, task lists, meeting recaps) stays in the note, one tap away.
 *
 *   morning → ## Morning Brief  › ### MORNING SUMMARY   (AM Morning Brief, Step 6.5)
 *   evening → ## Evening Report › ### Evening Summary   (PM Evening Processor, Step 4.7)
 *
 * Waiting: the Cowork tasks start with a randomized delay and run for a variable
 * time, so a live send for TODAY polls the note every 30 s until the summary lands
 * or the slot's deadline passes (morning 06:35, evening 22:00). Bounded by design —
 * see the automation readme, "Bounded runtime is load-bearing".
 *
 * Fallback: no summary by the deadline → send the slot's fallback subsection
 * instead (morning ### AT A GLANCE, evening ### Tasks), prefixed "(no summary
 * today)", so a dead Cowork run still produces a useful text. Fallback empty too →
 * nothing is sent (empty-night suppress).
 *
 * Rendering (summary): paragraphs preserved (blank line = paragraph), [[wikilinks]]
 * → display text, bold / italic / code markers stripped, `Thu 2026-09-03` → `Thu 9/3`
 * (the note keeps absolute dates; the phone gets the short form).
 *
 * Usage:
 *   node scripts/send-daily-text.js [--date YYYY-MM-DD] [--slot morning|evening] [--dry-run] [--no-wait]
 *
 * --dry-run and --date <not today> never wait; --no-wait skips the poll on a live send.
 * The recipient number is read from brickomations's .env (ALERT_IMESSAGE_TARGET),
 * never hardcoded. Dry-run needs no send config at all.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const VAULT_DIR = path.join(os.homedir(), "projects", "brickocampus");
const VAULT_NAME = "brickocampus";
const BRICKOMATIONS_DIR = path.join(os.homedir(), "projects", "brickomations");

// Each slot lifts exactly one `### ` subsection out of one `## ` zone. `fallback`
// (same zone) is what goes out when the summary never lands by `deadline` (local
// HH:MM, today). Subsections are resolved INSIDE the zone — `### Tasks` exists in
// both zones in different case, so a file-global heading match would be wrong.
const SLOTS = {
  morning: {
    zone: "Morning Brief",
    summary: "MORNING SUMMARY",
    fallback: "AT A GLANCE",
    deadline: "06:35",
  },
  evening: {
    zone: "Evening Report",
    summary: "Evening Summary",
    fallback: "Tasks",
    deadline: "22:00",
  },
};

const POLL_INTERVAL_MS = 30 * 1000;
const NO_SUMMARY_PREFIX = "(no summary today)";
const LINK_LABEL = "Tap to open in Obsidian:";

// ---- args -----------------------------------------------------------------

function parseArgs(argv) {
  const args = { date: null, slot: "morning", dryRun: false, noWait: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-wait") args.noWait = true;
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

// ---- zone / subsection extraction -----------------------------------------

// Pre-2026-08-03 notes carry `## Logs` where the Evening Report zone now lives.
// Only matters for manual `--date` runs on historical notes.
const LEGACY_ALIASES = { "Evening Report": ["Logs"] };

// Body lines of a `## <zone>` — everything up to the next H2, a `---` rule, or EOF,
// INCLUDING the zone's `### ` subheadings. null if the zone (and any alias) is absent.
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

// Body lines of `### <heading>` inside a zone body — up to the next `### `, or the
// end of the zone. Exact heading match. null if the subsection is absent.
function extractSubsection(zoneBody, heading) {
  const idx = zoneBody.findIndex((l) => l.trim() === `### ${heading}`);
  if (idx === -1) return null;
  const body = [];
  for (let i = idx + 1; i < zoneBody.length; i++) {
    if (/^###\s/.test(zoneBody[i])) break;
    body.push(zoneBody[i]);
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

// `Thu 2026-09-03` → `Thu 9/3` (year dropped when it's the current year, else
// `Thu 9/3/25`); a bare `2026-09-03` → `9/3`. The note keeps absolute dates — the
// short form is a phone-only rendering.
const WEEKDAY_DATE_RE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{4})-(\d{2})-(\d{2})\b/g;
const BARE_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

function shortDate(y, m, d, now) {
  const md = `${Number(m)}/${Number(d)}`;
  return Number(y) === now.getFullYear() ? md : `${md}/${String(y).slice(2)}`;
}

function shortenDates(text, now = new Date()) {
  return text
    .replace(WEEKDAY_DATE_RE, (_m, wd, y, mo, d) => `${wd} ${shortDate(y, mo, d, now)}`)
    .replace(BARE_DATE_RE, (_m, y, mo, d) => shortDate(y, mo, d, now));
}

// Non-blank, non-comment content of a subsection body (raw, pre-clean). Skips whole
// HTML comment blocks, including multi-line ones, so a template comment above a
// placeholder doesn't read as real content.
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

const isPlaceholderLine = (l) => /^_.+_$/.test(l.trim());

// A subsection whose only content is italic placeholders (`_no tasks_`,
// `_not written yet_`) carries nothing.
function isPlaceholderOnly(rawBody) {
  const real = realBodyLines(rawBody);
  return real.length > 0 && real.every(isPlaceholderLine);
}

// Fallback rendering: compact plain-text lines, blank lines dropped, `- ` → `• `.
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

// Summary rendering: paragraphs survive (a blank line in the note is a paragraph
// break on the phone), comments / fences / italic placeholders are dropped, inline
// markdown is cleaned, dates are shortened. "" when there's nothing real.
function cleanSummary(rawBody, now = new Date()) {
  const paragraphs = [];
  let current = [];
  let inFence = false;
  let inComment = false;
  const flush = () => {
    if (current.length) paragraphs.push(current.join("\n"));
    current = [];
  };
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
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (isPlaceholderLine(line)) continue;
    current.push(cleanInline(line.replace(/^(\s*)-\s+/, "$1• ")).trim());
  }
  flush();
  return shortenDates(paragraphs.join("\n\n"), now);
}

// ---- message assembly -----------------------------------------------------

function buildHeader(lines) {
  const h1 = lines.find((l) => /^#\s/.test(l));
  const dateLabel = h1 ? h1.replace(/^#\s+/, "").trim() : "Daily note";
  const weekLine = lines.find((l) => /\*\*Week\s+\d+\*\*/.test(l));
  const weekMatch = weekLine && weekLine.match(/Week\s+(\d+)/);
  return weekMatch ? `${dateLabel} · Week ${weekMatch[1]}` : dateLabel;
}

// True when the slot's summary subsection holds real prose (not empty, not a placeholder).
function hasSummary(lines, slot, now = new Date()) {
  const cfg = SLOTS[slot];
  const zoneBody = extractZone(lines, cfg.zone);
  if (!zoneBody) return false;
  const raw = extractSubsection(zoneBody, cfg.summary);
  return !!raw && cleanSummary(raw, now).length > 0;
}

function buildMessage({ lines, slot, relNoExt, now = new Date() }) {
  const cfg = SLOTS[slot];
  if (!cfg) throw new Error(`Unknown slot "${slot}"`);
  const zoneBody = extractZone(lines, cfg.zone);
  if (zoneBody === null) {
    return { message: null, reason: `zone "## ${cfg.zone}" not found in note`, usedFallback: false };
  }
  const header = buildHeader(lines);
  const link =
    `obsidian://open?vault=${VAULT_NAME}` +
    `&file=${encodeURIComponent(relNoExt)}`;
  const linkBlock = `${LINK_LABEL}\n${link}`;

  const summaryRaw = extractSubsection(zoneBody, cfg.summary);
  const summary = summaryRaw ? cleanSummary(summaryRaw, now) : "";
  if (summary) {
    return { message: [header, summary, linkBlock].join("\n\n"), reason: null, usedFallback: false };
  }

  const fallbackRaw = extractSubsection(zoneBody, cfg.fallback);
  const fallback =
    fallbackRaw && !isPlaceholderOnly(fallbackRaw)
      ? cleanBody(fallbackRaw).map((l) => shortenDates(l, now))
      : [];
  if (fallback.length === 0) {
    return {
      message: null,
      reason: `no ### ${cfg.summary} and nothing real in ### ${cfg.fallback} — empty-night suppress`,
      usedFallback: false,
    };
  }
  const body = `${NO_SUMMARY_PREFIX}\n\n${cfg.fallback}\n${fallback.join("\n")}`;
  return { message: [header, body, linkBlock].join("\n\n"), reason: null, usedFallback: true };
}

// ---- waiting --------------------------------------------------------------

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Epoch ms of today's `HH:MM` (local time).
function deadlineEpoch(hhmm, now = new Date()) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// Read the note. On a live send for today (`wait`), keep re-reading until the
// summary has landed or the slot deadline passes — the note itself may not exist
// yet in the first minutes of the morning window. Returns the note + its lines.
function readNoteWithWait({ dateISO, slot, wait }) {
  const cfg = SLOTS[slot];
  const deadline = deadlineEpoch(cfg.deadline);
  let attempts = 0;
  for (;;) {
    attempts++;
    const timeLeft = deadline - Date.now();
    let note = null;
    let err = null;
    try {
      note = resolveNote(dateISO);
    } catch (e) {
      err = e;
    }
    if (note) {
      const lines = fs.readFileSync(note.abs, "utf8").split("\n");
      if (!wait || timeLeft <= 0 || hasSummary(lines, slot)) {
        return { ...note, lines, attempts };
      }
    } else if (!wait || timeLeft <= 0) {
      throw err;
    }
    sleepMs(Math.min(POLL_INTERVAL_MS, Math.max(timeLeft, 1000)));
  }
}

// ---- send -----------------------------------------------------------------

function readAlertTarget() {
  const envPath = path.join(BRICKOMATIONS_DIR, ".env");
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
  const tmp = path.join(os.tmpdir(), `brickomations-daily-text-${process.pid}.applescript`);
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
  const cfg = SLOTS[args.slot];
  if (!cfg) {
    throw new Error(`Unknown slot "${args.slot}" (expected: ${Object.keys(SLOTS).join(", ")})`);
  }

  // Only a live send for today waits on the Cowork task; historical / dry runs read once.
  const wait = !args.dryRun && !args.noWait && dateISO === todayLocalISO();
  const { abs, relNoExt, lines, attempts } = readNoteWithWait({ dateISO, slot: args.slot, wait });
  const { message, reason, usedFallback } = buildMessage({ lines, slot: args.slot, relNoExt });
  const mode = usedFallback ? `fallback (### ${cfg.fallback})` : `summary (### ${cfg.summary})`;

  if (message === null) {
    // Empty-night suppress (or missing zone): send nothing, exit cleanly.
    console.log(`[send-daily-text] ${dateISO} ${args.slot}: no send — ${reason}`);
    return;
  }

  if (args.dryRun) {
    console.log(`[dry-run] date=${dateISO} slot=${args.slot} mode=${mode}`);
    console.log(`[dry-run] note: ${abs}`);
    console.log(`[dry-run] message length: ${message.length} chars`);
    console.log("\n----- message -----\n");
    console.log(message);
    console.log("\n----- end -----");
    return;
  }

  const target = readAlertTarget();
  sendIMessage(target, message);
  console.log(
    `[send-daily-text] ${dateISO} ${args.slot}: sent ${mode} after ${attempts} read${attempts === 1 ? "" : "s"}.`
  );
}

if (require.main === module) main();

module.exports = {
  SLOTS,
  NO_SUMMARY_PREFIX,
  extractZone,
  extractSubsection,
  cleanInline,
  cleanBody,
  cleanSummary,
  shortenDates,
  isPlaceholderOnly,
  hasSummary,
  buildHeader,
  buildMessage,
  deadlineEpoch,
};
