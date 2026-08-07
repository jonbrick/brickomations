#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Plan view: a deterministic, human-readable render of a week's plan
 * bundle. Consumes buildBundle() from plan-bundle.js — SAME joins, SAME
 * dates — so /plan-week can relay this output verbatim instead of
 * hand-assembling the week from the JSON.
 *
 * Why this exists: hand-transcribing bundle records into a day-by-day
 * table is lossy — Wk 29 mis-grouped four Sunday events under Monday.
 * Every date/time/day here is keyed off a record's own `start` field.
 *
 * Read-only. Usage: yarn plan:view <wk>
 */

const fs = require("fs");
const path = require("path");
const { buildBundle } = require("./plan-bundle");

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// --- date helpers (UTC arithmetic — no timezone drift on day math) ---
const ymd = (s) => String(s || "").slice(0, 10);
const parseYMD = (s) => {
  const [y, m, d] = String(s).split("-").map(Number);
  return { y, m, d };
};
const weekdayOf = (s) => {
  const { y, m, d } = parseYMD(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const pretty = (s) => {
  const { m, d } = parseYMD(s);
  return `${WEEKDAYS[weekdayOf(s)]} ${MONTHS[m - 1]} ${d}`;
};
function eachDay(start, end) {
  const out = [];
  const s = parseYMD(start);
  const e = parseYMD(end);
  let cur = Date.UTC(s.y, s.m - 1, s.d);
  const stop = Date.UTC(e.y, e.m - 1, e.d);
  while (cur <= stop) {
    const dt = new Date(cur);
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`
    );
    cur += 86400000;
  }
  return out;
}

// --- event helpers ---
const isAllDay = (ev) => String(ev.start || "").length === 10;
function to12(hhmm) {
  let [h, mm] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, "0")}${ap}`;
}
const timeOf = (ev) =>
  isAllDay(ev) ? "all-day" : to12(String(ev.start).slice(11, 16));
const isDNS = (ev) =>
  /^\s*(🛑\s*)?(DNS\b|Do ?Not ?Schedule)/i.test(String(ev.summary || ""));
const isWorkingLoc = (ev) =>
  isAllDay(ev) &&
  /^(Home|Office|WFH|Work from home)$/i.test(String(ev.summary || "").trim());
const byStart = (a, b) =>
  String(a.start || "").localeCompare(String(b.start || ""));
const orderEvents = (list) => [
  ...list.filter((e) => !isAllDay(e)).sort(byStart),
  ...list.filter((e) => isAllDay(e)),
];
const lineFor = (e) =>
  `${timeOf(e).padEnd(8)} ${isDNS(e) ? "⛔ " : ""}${e.summary}`;

// pick first present, non-empty string value among candidate keys
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return "";
}

// Render a {label: [{date, summary}]} habit-actuals map (from buildBundle's
// habitActuals) as compact indented lines: one line per habit that fired,
// then a single "none:" roll-up for the streams with nothing. Uniform
// summaries collapse into a trailing "(…)"; mixed ones annotate each day.
const HABIT_LABEL = (k) => String(k).replace(/ Days$/, "");
function habitActualsLines(actuals, indent = "      ") {
  if (!actuals) return [`${indent}(none in cache)`];
  const shortDay = (d) => WEEKDAYS[weekdayOf(d)];
  const lines = [];
  const empty = [];
  for (const [label, evs] of Object.entries(actuals)) {
    const disp = HABIT_LABEL(label);
    if (!evs || !evs.length) {
      empty.push(disp);
      continue;
    }
    // Every 🌱 Weeks Plan - Personal column is a DAY count — collapse multiple same-day events
    // (a bar A → bar B night is one drinking day) and stamp the total.
    const byDay = new Map();
    for (const e of evs) {
      if (!byDay.has(e.date)) byDay.set(e.date, new Set());
      if (e.summary) byDay.get(e.date).add(e.summary);
    }
    const days = [...byDay.keys()].sort();
    const summaries = [...new Set(evs.map((e) => e.summary).filter(Boolean))];
    let val;
    if (summaries.length <= 1) {
      const s = summaries[0] ? `   (${summaries[0]})` : "";
      val = `${days.map(shortDay).join(" · ")}${s}`;
    } else {
      val = days
        .map((d) => `${shortDay(d)}(${[...byDay.get(d)].join(" + ")})`)
        .join(" · ");
    }
    lines.push(`${indent}${disp.padEnd(13)} ${val}  [${days.length}d]`);
  }
  if (!lines.length) lines.push(`${indent}(nothing logged yet)`);
  if (empty.length) lines.push(`${indent}none: ${empty.join(" · ")}`);
  return lines;
}

// Metric habits (sleep / weight / BP) — the actuals that live in Oura/Withings,
// not on a habit calendar. Rendered alongside the calendar streams so the
// current-week readout is complete. Sleep: per-night hrs/eff + a week average.
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const avg = (nums) =>
  nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
function metricLines(m, indent = "      ") {
  if (!m) return [`${indent}(metrics not in cache)`];
  const lines = [];
  const shortDay = (d) => WEEKDAYS[weekdayOf(d)];
  const pad = (s) => s.padEnd(13); // matches habitActualsLines' label width

  if (m.sleep && m.sleep.length) {
    const perNight = m.sleep
      .map((s) => `${shortDay(s.date)} ${round1(s.hours)}h/${s.efficiency}%`)
      .join(" · ");
    const avgH = avg(m.sleep.map((s) => s.hours).filter((x) => x != null));
    const avgE = avg(m.sleep.map((s) => s.efficiency).filter((x) => x != null));
    lines.push(`${indent}${pad("Sleep")} ${perNight}`);
    lines.push(
      `${indent}${pad("")} avg ${avgH}h · ${avgE}% eff  [${m.sleep.length} nights]`
    );
  } else {
    lines.push(`${indent}${pad("Sleep")} (none in cache)`);
  }

  if (m.weight && m.weight.length) {
    const perDay = m.weight
      .map((w) => `${shortDay(w.date)} ${round1(w.lbs)}`)
      .join(" · ");
    const avgW = avg(m.weight.map((w) => w.lbs).filter((x) => x != null));
    lines.push(`${indent}${pad("Weight")} ${perDay}  ·  avg ${avgW} lbs`);
  } else {
    lines.push(`${indent}${pad("Weight")} (none in cache)`);
  }

  if (m.bloodPressure && m.bloodPressure.length) {
    const perDay = m.bloodPressure
      .map((b) => `${shortDay(b.date)} ${b.systolic}/${b.diastolic}`)
      .join(" · ");
    lines.push(`${indent}${pad("BP")} ${perDay}`);
  } else {
    lines.push(`${indent}${pad("BP")} (none this week)`);
  }

  return lines;
}

function render(b) {
  const out = [];
  const P = (s = "") => out.push(s);
  const RULE = "═".repeat(62);
  const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

  P(RULE);
  P(`  ${b.week.title}  ·  ${pretty(b.week.start)} – ${pretty(b.week.end)}`);
  P(`  data pulled ${b.dataPulledAt || "?"}   ·   today ${today}`);
  P(RULE);

  // ---------- DAY BY DAY ----------
  P("");
  P("DAY BY DAY   (personal + work calendars · ⛔ = DNS/hold · [x] = working loc)");
  const pers = b.calendarBlocks.personal || [];
  const work = b.calendarBlocks.work || [];
  for (const day of eachDay(b.week.start, b.week.end)) {
    const onDay = (arr) => arr.filter((e) => ymd(e.start) === day);
    const wl = [
      ...new Set(onDay(work).filter(isWorkingLoc).map((e) => e.summary.trim())),
    ];
    const when = day < today ? " · past" : day === today ? " · TODAY" : "";
    const wlTag = wl.length ? `   [${wl.join("/")}]` : "";
    P("");
    P(`  ${pretty(day)}${when}${wlTag}`);
    const p = onDay(pers);
    const w = onDay(work).filter((e) => !isWorkingLoc(e));
    if (!p.length && !w.length) P(`      —`);
    if (p.length) {
      P(`    personal`);
      for (const e of orderEvents(p)) P(`      ${lineFor(e)}`);
    }
    if (w.length) {
      P(`    work`);
      for (const e of orderEvents(w)) P(`      ${lineFor(e)}`);
    }
  }

  // ---------- TASKS ----------
  const taskLine = (t) => {
    const due = ymd(t["Due Date"]);
    const cat = [t.Category, t["PERSONAL Category"], t["WORK Category"]]
      .filter(Boolean)
      .join(" / ");
    return `    ${t.Status || ""}  ${t.Task}${due ? `  · due ${due}` : ""}${cat ? `  · ${cat}` : ""}`;
  };
  P("");
  P(RULE);
  P("TASKS ON THE BOOKS");
  for (const [label, arr] of [
    ["personal", b.tasks.personal],
    ["work", b.tasks.work],
    ["other (no side category)", b.tasks.other],
  ]) {
    P(`  ${label} (${arr.length})`);
    for (const t of arr.slice().sort((a, b) => ymd(a["Due Date"]).localeCompare(ymd(b["Due Date"]))))
      P(taskLine(t));
  }

  // ---------- EVENTS + TRIPS ----------
  P("");
  P(RULE);
  P(`EVENTS (${b.events.length})`);
  for (const e of b.events) {
    const name = pick(e, ["Event Name", "Event", "title", "Name"]);
    const date = ymd(pick(e, ["Date"]));
    const tags = [e.Category, e.Subcategory, e.Status].filter(Boolean).join(" · ");
    P(`    ${name}${date ? `  — ${date}` : ""}${tags ? `  (${tags})` : ""}`);
  }
  P(`TRIPS (${b.trips.length})`);
  for (const t of b.trips) {
    const name = pick(t, ["Trip Name", "Trip", "title", "Name"]);
    const start = ymd(pick(t, ["Start", "Start Date", "Date"]));
    const tags = [t.Type, t.Status].filter(Boolean).join(" · ");
    P(`    ${name}${start ? `  — starts ${start}` : ""}${tags ? `  (${tags})` : ""}`);
  }

  // ---------- UPCOMING (lookahead past the target week) ----------
  const up = b.upcoming;
  if (up) {
    P("");
    P(RULE);
    P(
      `UPCOMING   (next ${Math.round(up.days / 7)} weeks · ${up.from} → ${up.to})`
    );
    P(`  Events (${up.events.length})`);
    for (const e of up.events) {
      const name = pick(e, ["Event Name", "Event", "title", "Name"]);
      const date = ymd(pick(e, ["Date"]));
      const tags = [e.Category, e.Subcategory, e.Status]
        .filter(Boolean)
        .join(" · ");
      P(`      ${date ? pretty(date) : ""}  ${name}${tags ? `  (${tags})` : ""}`);
    }
    P(`  Trips (${up.trips.length})`);
    for (const t of up.trips) {
      const name = pick(t, ["Trip Name", "Trip", "title", "Name"]);
      const start = ymd(pick(t, ["Date", "Start", "Start Date"]));
      const endd = ymd(pick(t, ["Date End", "End"]));
      const span = start
        ? `${pretty(start)}${endd && endd !== start ? `–${pretty(endd)}` : ""}`
        : "";
      const tags = []
        .concat(t.Subcategory || [], t.Status || [])
        .filter(Boolean)
        .join(" · ");
      P(`      ${span}  ${name}${tags ? `  (${tags})` : ""}`);
    }
  }

  // ---------- EXISTING OUTCOMES ----------
  const es = b.existingState;
  P("");
  P(RULE);
  P("EXISTING OUTCOMES   (plan tops up; never double-books)");
  P(`  Rocks: ${es.rocks.personal.length} personal · ${es.rocks.work.length} work`);
  for (const r of [...es.rocks.personal, ...es.rocks.work])
    P(`      ${r.Rock}  (${r.Category})`);
  P(`  Sober/Drinking events (${es.soberDrinking.length})`);
  for (const s of es.soberDrinking)
    P(`      ${pretty(ymd(s.start))}  ${s.summary}`);
  P(`  Planned: blocks (${es.plannedBlocks.length})`);
  for (const pb of orderEvents(es.plannedBlocks))
    P(`      ${pretty(ymd(pb.start))} ${timeOf(pb)}  ${pb.summary}`);
  P(
    `  🌱 Personal Week Plan row: ${
      es.habitsPlan
        ? `loaded (Status ${es.habitsPlan.Status || "?"})`
        : "NOT in bundle (habitsPlan=null — fetch the week's row via Notion MCP at write)"
    }`
  );
  P(
    `  💼 Work Week Plan row: ${
      es.workPlan
        ? `loaded (Status ${es.workPlan.Status || "?"})`
        : "not pulled (workPlan=null — fetch the week's row via Notion MCP at write)"
    }`
  );

  // ---------- HABITS SO FAR (this week's actuals) ----------
  P("");
  P(RULE);
  P("HABITS SO FAR   (this week's actuals · habit calendars + Oura/Withings)");
  for (const ln of habitActualsLines(es.habitActuals)) P(ln);
  for (const ln of metricLines(es.metrics)) P(ln);

  // ---------- PRIOR WEEK (habit-walk defaults) ----------
  const pw = b.inputs.priorWeek;
  P("");
  P(RULE);
  if (!pw) {
    P("PRIOR WEEK: none found");
  } else {
    P(`PRIOR WEEK ${pw.number} — habit-walk defaults`);
    P(`  Rocks:`);
    for (const r of pw.rocks || [])
      P(`      ${r.Rock}  (${r.Retro || r.Status || "?"})`);
    const roll =
      pw.retros && pw.retros.personal
        ? pw.retros.personal["Weekly Habits Roll Up"]
        : null;
    P(`  Habits actuals:${roll ? "" : " (none)"}`);
    if (roll)
      for (const ln of String(roll).split("\n"))
        if (ln.trim() && ln.trim() !== "*****") P(`      ${ln.trim()}`);
    P(
      `  🌱 prior personal plan: ${pw.habitsPlan ? "present" : "null (no plan-side defaults; use actuals below)"}`
    );
    P(`  Habit actuals (from calendars):`);
    for (const ln of habitActualsLines(pw.habitActuals)) P(ln);
  }

  P("");
  P(RULE);
  return out.join("\n") + "\n";
}

function main() {
  const wk = Number.parseInt(process.argv[2], 10);
  if (!Number.isInteger(wk) || wk < 1 || wk > 53) {
    process.stderr.write(
      `usage: yarn plan:view <wk>  (wk must be an integer 1..53, got ${JSON.stringify(process.argv[2])})\n`
    );
    process.exit(1);
  }
  try {
    const bundle = buildBundle(wk);
    // Human-readable render → stdout (Jon copies this into chat).
    process.stdout.write(render(bundle));
    // Full structured bundle → staged file for the skill's write phase.
    // A file Read, not a 100KB paste. local/ is gitignored.
    const stagePath = path.join(
      __dirname, "..", "local", "plan", `bundle-${wk}.json`
    );
    fs.writeFileSync(stagePath, JSON.stringify(bundle, null, 2) + "\n");
    process.stderr.write(
      `\n[structured bundle staged → local/plan/bundle-${wk}.json]\n`
    );
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { render };
