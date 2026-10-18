// Guards send-daily-text.js — the exec-assistant text model (2026-10-18).
//
// What matters: the text lifts ONLY the summary subsection, keeps its paragraph
// breaks (a blank line in the note is a paragraph on the phone), resolves
// subsections inside the right zone (### Tasks exists in both zones), falls back
// to the slot's fallback subsection when the summary is missing or still a
// placeholder, and shortens absolute dates for the phone without touching the note.

const { assert, assertEqual } = require("./helpers");
const {
  buildMessage,
  cleanSummary,
  shortenDates,
  hasSummary,
  NO_SUMMARY_PREFIX,
} = require("../scripts/send-daily-text");

const NOW = new Date("2026-10-19T06:20:00-04:00");
const REL = "_daily/2026/2026-10/2026-10-19 Monday";

function note({ morningSummary, eveningSummary } = {}) {
  return `# Monday, October 19, 2026

<< [[2026-10-18 Sunday|Yesterday]] | [[2026-10-20 Tuesday|Tomorrow]] >>

**Week 43** · Oct 18 – Oct 24

## Morning Brief
<!-- zone comment
     spans lines -->

<!-- ### MORNING SUMMARY — spec comment -->

### MORNING SUMMARY
${morningSummary === undefined ? "" : morningSummary}

### AT A GLANCE
- Free until [[Michael Jensen|Mike]] at 9:30
- Booked noon to 4:30

### WORK TASKS
Coding
- Gradient PR

---

## Triage

### Triage (Granola)

---

## Evening Report
<!-- zone comment -->

### Evening Summary
<!-- spec comment -->
${eveningSummary === undefined ? "_not written yet_" : eveningSummary}

### Tasks
**Done**
- Gradient PR (Work / Coding)

**Not finished**
- Retro YTD (Personal / Admin)

### Work Meetings
_no meetings_
`.split("\n");
}

const MORNING = [
  "Morning. Free until [[Michael Jensen|Mike]] at 9:30, then booked noon to 4:30.",
  "",
  "Gradient PR is back for a fourth morning. It first appeared on Wed 2026-10-14 and has been pushed three times.",
  "",
  "Evening free after 4:30.",
].join("\n");

module.exports = {
  "morning: lifts only the summary, keeps paragraph breaks, strips wikilinks": () => {
    const { message, usedFallback } = buildMessage({ lines: note({ morningSummary: MORNING }), slot: "morning", relNoExt: REL, now: NOW });
    assertEqual(usedFallback, false, "summary present → no fallback");
    const paragraphs = message.split("\n\n");
    assertEqual(paragraphs[0], "Monday, October 19, 2026 · Week 43", "header first");
    assertEqual(paragraphs[1], "Morning. Free until Mike at 9:30, then booked noon to 4:30.", "wikilink → display text");
    assert(paragraphs[2].startsWith("Gradient PR is back for a fourth morning."), "second paragraph kept");
    assertEqual(paragraphs[3], "Evening free after 4:30.", "third paragraph kept");
    assert(paragraphs[4].startsWith("Tap to open in Obsidian:\nobsidian://open?vault=brickocampus&file="), "link last");
    assert(!message.includes("AT A GLANCE"), "rest of the zone stays in the note");
    assert(!message.includes("Gradient PR (Work"), "evening zone never leaks into the morning text");
  },

  "morning: absolute date in the note becomes the short form on the phone": () => {
    const { message } = buildMessage({ lines: note({ morningSummary: MORNING }), slot: "morning", relNoExt: REL, now: NOW });
    assert(message.includes("on Wed 10/14 and"), `expected Wed 10/14 in: ${message}`);
    assert(!message.includes("2026-10-14"), "ISO date must not reach the phone");
  },

  "morning: empty summary falls back to AT A GLANCE with the prefix": () => {
    const { message, usedFallback } = buildMessage({ lines: note({ morningSummary: "" }), slot: "morning", relNoExt: REL, now: NOW });
    assertEqual(usedFallback, true, "fallback flagged");
    assert(message.includes(`${NO_SUMMARY_PREFIX}\n\nAT A GLANCE\n• Free until Mike at 9:30\n• Booked noon to 4:30`), `fallback body: ${message}`);
    assert(!message.includes("WORK TASKS"), "fallback is one subsection, not the zone");
  },

  "evening: placeholder summary falls back to the Evening Report's Tasks, not the morning's": () => {
    const { message, usedFallback } = buildMessage({ lines: note(), slot: "evening", relNoExt: REL, now: NOW });
    assertEqual(usedFallback, true, "_not written yet_ counts as missing");
    assert(message.includes("Tasks\nDone\n• Gradient PR (Work / Coding)"), `evening fallback body: ${message}`);
    assert(message.includes("Not finished\n• Retro YTD (Personal / Admin)"), "blank-line groups flatten in fallback mode");
    assert(!message.includes("Coding\n• Gradient PR\n"), "morning WORK TASKS must not be picked");
  },

  "evening: real summary wins over the fallback": () => {
    const summary = "Day's done. Gradient PR is in, four mornings after it first appeared on Wed 2026-10-14.\n\nRetro YTD rolls to Tue 2026-10-20.";
    const { message, usedFallback } = buildMessage({ lines: note({ eveningSummary: summary }), slot: "evening", relNoExt: REL, now: NOW });
    assertEqual(usedFallback, false);
    assert(message.includes("Day's done. Gradient PR is in, four mornings after it first appeared on Wed 10/14.\n\nRetro YTD rolls to Tue 10/20."), message);
  },

  "nothing real anywhere → no send": () => {
    const lines = note({ morningSummary: "" }).map((l) => (l.startsWith("- Free until") || l.startsWith("- Booked") ? "" : l));
    const { message, reason } = buildMessage({ lines, slot: "morning", relNoExt: REL, now: NOW });
    assertEqual(message, null, "empty-night suppress");
    assert(/empty-night suppress/.test(reason), reason);
  },

  "hasSummary: false for empty, placeholder-only, or comment-only bodies": () => {
    assertEqual(hasSummary(note({ morningSummary: "" }), "morning", NOW), false, "empty");
    assertEqual(hasSummary(note({ morningSummary: "_not written yet_" }), "morning", NOW), false, "placeholder");
    assertEqual(hasSummary(note({ morningSummary: "<!-- still thinking -->" }), "morning", NOW), false, "comment");
    assertEqual(hasSummary(note({ morningSummary: MORNING }), "morning", NOW), true, "prose");
  },

  "cleanSummary: collapses runs of blank lines, drops comments and fences": () => {
    const out = cleanSummary(["", "One.", "", "", "", "Two **bold** and `code`.", "<!-- hidden", "still hidden -->", "```", "fenced", "```", "", "Three."], NOW);
    assertEqual(out, "One.\n\nTwo bold and code.\n\nThree.");
  },

  "shortenDates: weekday form, bare form, other-year form": () => {
    assertEqual(shortenDates("Thu 2026-09-03 and 2026-10-01.", NOW), "Thu 9/3 and 10/1.");
    assertEqual(shortenDates("since Mon 2025-12-29", NOW), "since Mon 12/29/25");
    assertEqual(shortenDates("no dates here", NOW), "no dates here");
  },
};
