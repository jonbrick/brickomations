/**
 * @fileoverview Day Status classifier for the 💊 Medication and 🍬 Supplements trackers
 * @layer 2 - Domain
 *
 * Both DBs carry a `Status` formula that folds the day's five checkboxes
 * (AM / PM taken, AM / PM skipped, No Meds / No Supps) into one string. The
 * methodology lives in that formula — this file only reads its result, so a
 * change to the tracking rules is a Notion edit, not a code change.
 *
 * Strings are matched on their words, not their decoration: "✅ Taken" and
 * "Taken" both classify as `taken`, so the emoji can be restyled freely in
 * Notion. Anything unrecognised classifies as `unknown` so the calendar sync
 * names it in its skip log instead of silently dropping the day.
 *
 * Kinds:
 *   taken         AM + PM taken                     → calendar event (AM + PM)
 *   morning-only  AM taken, PM explicitly skipped   → calendar event (AM)
 *   evening-only  PM taken, AM explicitly skipped   → calendar event (PM)
 *   skipped       both skipped, or No Meds / Supps  → no event; a logged day
 *   pending       one batch logged, the other open  → no event yet
 *   not-logged    nothing checked                   → no event; a dark day
 *   conflict      a batch both taken and skipped    → no event; flagged
 *   unknown       a string the formula grew since   → no event; flagged
 *   missing       no Status value at all            → caller decides
 */

/** Strip emoji and punctuation, collapse whitespace, lowercase. */
function normalizeStatus(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * Classify a Status formula string.
 *
 * @param {string|null|undefined} raw - the Status formula value
 * @returns {{ kind: string, am: boolean, pm: boolean, raw: string|null }}
 *   `am` / `pm` are true only for the batches that were taken on a resolved day.
 */
function classifyDayStatus(raw) {
  const words = normalizeStatus(raw);
  const out = (kind, am = false, pm = false) => ({
    kind,
    am,
    pm,
    raw: raw === null || raw === undefined ? null : String(raw),
  });
  if (!words) return out("missing");
  if (words.includes("conflict")) return out("conflict");
  if (words.includes("pending")) return out("pending");
  if (words === "taken") return out("taken", true, true);
  if (words === "morning only") return out("morning-only", true, false);
  if (words === "evening only") return out("evening-only", false, true);
  if (words === "skipped") return out("skipped");
  if (words === "not logged") return out("not-logged");
  return out("unknown");
}

/** Kinds that produce a calendar event. */
const EVENT_KINDS = new Set(["taken", "morning-only", "evening-only"]);

/** Kinds the retro-readiness Gaps block reports — the day still needs a hand. */
const GAP_KINDS = new Set(["not-logged", "pending"]);

module.exports = { classifyDayStatus, normalizeStatus, EVENT_KINDS, GAP_KINDS };
