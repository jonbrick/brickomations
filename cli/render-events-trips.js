/**
 * @layer 1 - Integration (CLI)
 *
 * Events + trips grouped by side, then type. Shared by plan-view and
 * month-view so a departure, a launch, a lease, an election each land under
 * their own heading instead of a flat list.
 *
 * Shape (restructured Fri 2026-10-16): `Category` is the side (💼 Work /
 * 🌱 Personal / 🫥 N/A). Events keep the type in the side's column —
 * `PERSONAL Category` (the former Subcategory) or `WORK Category`; Trips keep
 * one combined `Subcategory` (multi-select). Types are Jon's own lists, not
 * the Tasks lanes, so nothing here hard-codes them: groups appear in the order
 * their first record does, which for date-sorted input is chronological.
 */

const WORK = "💼 Work";
const NA = "🫥 N/A";
const NO_TYPE = "(no type)";

// Side order is the readout order: personal, work, then ambient context.
const SIDES = [
  { key: "personal", label: "🌱 personal", typed: true },
  { key: "work", label: "💼 work", typed: true },
  { key: "na", label: "🫥 n/a", typed: false },
];

const sideOf = (r) =>
  r && r.Category === WORK ? "work" : r && r.Category === NA ? "na" : "personal";

// Events: PERSONAL Category / WORK Category. Trips: Subcategory (array).
function typeOf(r) {
  if (!r) return "";
  const t = r["PERSONAL Category"] || r["WORK Category"] || r.Subcategory;
  if (Array.isArray(t)) return t.filter(Boolean).join(" · ");
  return t || "";
}

// Side · type · Status — the tag a DAY BY DAY line carries.
function typeTag(r) {
  if (!r) return "";
  return [r.Category, typeOf(r), r.Status].filter(Boolean).join(" · ");
}

/**
 * Group records by side, then type.
 * @returns {Array<{key, label, count, types: Array<{type: string|null, items: Array}>}>}
 *   Sides with no records are omitted. Types appear in first-record order;
 *   a record with no type lands under "(no type)" last. The 🫥 N/A side has no
 *   type heading (one group with `type: null`). Items keep input order.
 */
function groupBySideAndType(records) {
  const out = [];
  for (const side of SIDES) {
    const mine = (records || []).filter((r) => sideOf(r) === side.key);
    if (!mine.length) continue;
    if (!side.typed) {
      out.push({ key: side.key, label: side.label, count: mine.length, types: [{ type: null, items: mine }] });
      continue;
    }
    const byType = new Map();
    for (const r of mine) {
      const t = typeOf(r) || NO_TYPE;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(r);
    }
    const order = [...byType.keys()].filter((t) => t !== NO_TYPE);
    if (byType.has(NO_TYPE)) order.push(NO_TYPE);
    out.push({
      key: side.key,
      label: side.label,
      count: mine.length,
      types: order.map((type) => ({ type, items: byType.get(type) })),
    });
  }
  return out;
}

/**
 * Render a titled block: title, then side → type → item lines.
 * @param {string} title            e.g. "EVENTS (12)" (caller stamps the count)
 * @param {Array} records           date-sorted by the caller
 * @param {(r: object) => string} line   one item as text, no indent
 * @param {string} [indent="  "]    indent of the side label; types +2, items +4
 * @returns {string[]}
 */
function sideTypeLines(title, records, line, indent = "  ") {
  const out = [title];
  for (const g of groupBySideAndType(records)) {
    out.push(`${indent}${g.label} (${g.count})`);
    for (const { type, items } of g.types) {
      if (type !== null) out.push(`${indent}  ${type}`);
      const itemIndent = type !== null ? `${indent}    ` : `${indent}  `;
      for (const r of items) out.push(`${itemIndent}${line(r)}`);
    }
  }
  return out;
}

module.exports = {
  groupBySideAndType,
  sideTypeLines,
  typeTag,
  typeOf,
  sideOf,
  NO_TYPE,
};
