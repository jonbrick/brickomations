/**
 * @layer 1 - Integration (CLI)
 *
 * Events + trips grouped by side, then lane. Shared by plan-view and
 * month-view so a departure, a launch, a lease, an election each land in the
 * lane they belong to instead of a flat list.
 *
 * Two-field category model — `Category` is the side (💼 Work / 🌱 Personal /
 * 🫥 N/A); the lane lives in `PERSONAL Category` / `WORK Category`. Tasks,
 * Projects and Big Rocks adopted it 2026-08-16; Events and Trips followed on
 * Fri 2026-10-16 (scripts/migrate-events-trips-categories.js). Lane order is
 * the Notion option order, read from the task-category maps so the three
 * record kinds never drift.
 */

const {
  PERSONAL_TASK_CATEGORY_MAPPING,
  WORK_TASK_CATEGORY_MAPPING,
} = require("../src/config/notion/task-categories");

const WORK = "💼 Work";
const NA = "🫥 N/A";
const PERSONAL_LANES = Object.keys(PERSONAL_TASK_CATEGORY_MAPPING);
const WORK_LANES = Object.keys(WORK_TASK_CATEGORY_MAPPING);
const NO_LANE = "(no lane)";

// Side order is the readout order: personal, work, then ambient context.
const SIDES = [
  { key: "personal", label: "🌱 personal", lanes: PERSONAL_LANES },
  { key: "work", label: "💼 work", lanes: WORK_LANES },
  { key: "na", label: "🫥 n/a", lanes: [] },
];

const sideOf = (r) =>
  r && r.Category === WORK ? "work" : r && r.Category === NA ? "na" : "personal";

const laneOf = (r) =>
  (r && (r["PERSONAL Category"] || r["WORK Category"])) || "";

// Side · lane · Subcategory · Status — the tag a DAY BY DAY line carries.
// Trips' Subcategory is a multi-select (array); flat() folds it in.
function laneTag(r) {
  if (!r) return "";
  return [r.Category, laneOf(r), r.Subcategory, r.Status]
    .flat()
    .filter(Boolean)
    .join(" · ");
}

/**
 * Group records by side, then lane.
 * @returns {Array<{key, label, count, lanes: Array<{lane: string|null, items: Array}>}>}
 *   Sides with no records are omitted. Lanes come in canonical order; a record
 *   whose lane is blank or unknown lands under "(no lane)" after them. A side
 *   with no lane set (🫥 N/A) yields one lane group with `lane: null`.
 *   Items keep input order — callers sort by date first.
 */
function groupBySideAndLane(records) {
  const out = [];
  for (const side of SIDES) {
    const mine = (records || []).filter((r) => sideOf(r) === side.key);
    if (!mine.length) continue;
    if (!side.lanes.length) {
      out.push({ key: side.key, label: side.label, count: mine.length, lanes: [{ lane: null, items: mine }] });
      continue;
    }
    const byLane = new Map();
    for (const r of mine) {
      const lane = laneOf(r) || NO_LANE;
      if (!byLane.has(lane)) byLane.set(lane, []);
      byLane.get(lane).push(r);
    }
    const known = side.lanes.filter((l) => byLane.has(l));
    const unknown = [...byLane.keys()].filter((l) => !side.lanes.includes(l)).sort();
    out.push({
      key: side.key,
      label: side.label,
      count: mine.length,
      lanes: [...known, ...unknown].map((lane) => ({ lane, items: byLane.get(lane) })),
    });
  }
  return out;
}

/**
 * Render a titled block: title, then side → lane → item lines.
 * @param {string} title            e.g. "EVENTS (12)" (caller stamps the count)
 * @param {Array} records
 * @param {(r: object) => string} line   one item as text, no indent
 * @param {string} [indent="  "]    indent of the side label; lanes +2, items +4
 * @returns {string[]}
 */
function sideLaneLines(title, records, line, indent = "  ") {
  const out = [title];
  for (const g of groupBySideAndLane(records)) {
    out.push(`${indent}${g.label} (${g.count})`);
    for (const { lane, items } of g.lanes) {
      if (lane !== null) out.push(`${indent}  ${lane}`);
      const itemIndent = lane !== null ? `${indent}    ` : `${indent}  `;
      for (const r of items) out.push(`${itemIndent}${line(r)}`);
    }
  }
  return out;
}

module.exports = {
  groupBySideAndLane,
  sideLaneLines,
  laneTag,
  laneOf,
  sideOf,
  PERSONAL_LANES,
  WORK_LANES,
  NO_LANE,
};
