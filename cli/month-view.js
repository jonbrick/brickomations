#!/usr/bin/env node
/**
 * @layer 1 - Integration (CLI)
 *
 * Month view: a deterministic, human-readable render of a month's plan
 * bundle. Consumes buildMonthBundle() from month-bundle.js — SAME joins,
 * SAME dates — so /plan-month can relay this output verbatim instead of
 * assembling the month by hand from the JSON.
 *
 * Read-only. Usage: yarn --silent month:view <mm>
 */

const fs = require("fs");
const path = require("path");
const { buildMonthBundle, parseMonthArg, pad2 } = require("./month-bundle");
const {
  portfolioLines,
  laneText,
  pretty,
  ymd,
  PERSONAL_LANES,
  WORK_LANES,
  PERSONAL_OVERALL,
  WORK_OVERALL,
} = require("./render-portfolio");
const { sideTypeLines } = require("./render-events-trips");

// pick first present, non-empty string value among candidate keys
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return "";
}

// First non-empty line of a recap — the month-shape opener /recap-month writes.
function recapOpener(recap) {
  if (!recap) return "";
  const text = laneText(recap, "Recap");
  const first = text.split("\n").find((ln) => ln.trim());
  return first ? first.trim() : "";
}

function render(b) {
  const out = [];
  const P = (s = "") => out.push(s);
  const RULE = "═".repeat(62);
  const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

  P(RULE);
  P(`  ${b.month.title}  ·  ${pretty(b.month.start)} – ${pretty(b.month.end)}`);
  P(`  data pulled ${b.dataPulledAt || "?"}   ·   today ${today}`);
  P(RULE);

  // ---------- TARGET ROWS ----------
  P("");
  P("TARGET ROWS   (the month-plan records /plan-month writes)");
  const rowLine = (label, row) =>
    `  ${label}: ${row ? `${pick(row, ["Month Plan", "Name"])}  (${row.Status || "?"})` : "NOT in bundle — look the row up via Notion MCP at write"}`;
  P(rowLine("🌱 personal", b.plans.personal));
  P(rowLine("💼 work", b.plans.work));

  // ---------- PRIOR MONTH ----------
  P("");
  P(RULE);
  const pm = b.priorMonth;
  if (!pm) {
    P("PRIOR MONTH: none (January)");
  } else {
    P(`PRIOR MONTH ${pm.title}   (plan vs recap — the gap is Beat 1's first line)`);
    for (const [label, planRow, recapRow, overall, lanes] of [
      ["🌱 personal", pm.plans.personal, pm.recaps.personal, PERSONAL_OVERALL, PERSONAL_LANES],
      ["💼 work", pm.plans.work, pm.recaps.work, WORK_OVERALL, WORK_LANES],
    ]) {
      P("");
      const planned = planRow ? laneText(planRow, overall) : "";
      const recapped = recapOpener(recapRow);
      P(`  ${label}   plan ${planRow ? planRow.Status || "?" : "no row"} · recap ${recapRow ? recapRow.Status || "?" : "no row"}`);
      P(`    planned: ${planned || (planRow ? "(no Overall written)" : "(no plan row)")}`);
      P(`    recap:   ${recapped || (recapRow ? `(empty · ${recapRow.Status || "?"})` : "(no recap row)")}`);
      // Lanes (My-else-AI) beneath — what last month was meant to be about.
      for (const lane of lanes) {
        const text = laneText(planRow, lane);
        if (!text) continue;
        P(`    ${lane}`);
        for (const ln of text.split("\n")) if (ln.trim()) P(`      ${ln.trim()}`);
      }
    }
  }

  // ---------- PORTFOLIO ----------
  P("");
  P(RULE);
  for (const ln of portfolioLines(b.inputs, {
    subtitle: "(goals · projects · backlog · work state — the lanes draw from here)",
  }))
    P(ln);

  // ---------- WEEKS ----------
  P("");
  P(RULE);
  P("WEEKS   (plan state per week — the cascade skips rows already past 🔴 To Do)");
  for (const w of b.weeks) {
    const span = `${pretty(w.start)} – ${pretty(w.end)}`;
    const when = w.end < today ? " · past" : w.start <= today && today <= w.end ? " · THIS WEEK" : "";
    P(
      `  ${w.title}  ·  ${span}${when}  ·  🌱 ${w.personalPlanStatus || "?"}  ·  💼 ${w.workPlanStatus || "?"}  ·  rocks: ${w.rocks.length}`
    );
    for (const r of w.rocks) P(`      ${r.Rock}  (${r.Category}${r.Retro ? ` · ${r.Retro}` : ""})`);
  }

  // ---------- EVENTS + TRIPS ----------
  // Grouped by side, then type (Events: PERSONAL / WORK Category; Trips:
  // Subcategory — restructured 2026-10-16); the item tag carries what the
  // headings don't: Status.
  const itemTag = (r) => r.Status || "";
  P("");
  P(RULE);
  P(`EVENTS & TRIPS   (in month · by side → type · date-only by schema)`);
  const tripLine = (t) => {
    const name = pick(t, ["Trip Name", "Trip", "title", "Name"]);
    const s = ymd(pick(t, ["Date", "Start", "Start Date"]));
    const e = ymd(pick(t, ["Date End", "End", "End Date"])) || s;
    const tags = itemTag(t);
    return `✈️  ${pretty(s)}${e !== s ? ` → ${pretty(e)}` : ""}  ${name}${tags ? `  (${tags})` : ""}`;
  };
  for (const ln of sideTypeLines(`  Trips (${b.trips.length})`, b.trips, tripLine, "    ")) P(ln);
  const eventLine = (e) => {
    const name = pick(e, ["Event Name", "Event", "title", "Name"]);
    const tags = itemTag(e);
    return `🎟️  ${pretty(ymd(e.Date))}  ${name}${tags ? `  (${tags})` : ""}`;
  };
  const eventsByDate = [...b.events].sort((a, b) => ymd(a.Date).localeCompare(ymd(b.Date)));
  for (const ln of sideTypeLines(`  Events (${b.events.length})`, eventsByDate, eventLine, "    ")) P(ln);

  // ---------- UPCOMING ----------
  const up = b.upcoming;
  if (up) {
    P("");
    P(RULE);
    P(`UPCOMING   (next ${Math.round(up.days / 7)} weeks · ${up.from} → ${up.to})`);
    const upTripLine = (t) => {
      const name = pick(t, ["Trip Name", "Trip", "title", "Name"]);
      const s = ymd(pick(t, ["Date", "Start", "Start Date"]));
      const e = ymd(pick(t, ["Date End", "End", "End Date"]));
      const tags = itemTag(t);
      return `${pretty(s)}${e && e !== s ? `–${pretty(e)}` : ""}  ${name}${tags ? `  (${tags})` : ""}`;
    };
    for (const ln of sideTypeLines(`  Trips (${up.trips.length})`, up.trips, upTripLine, "    ")) P(ln);
    const upEventLine = (e) => {
      const name = pick(e, ["Event Name", "Event", "title", "Name"]);
      const tags = itemTag(e);
      return `${pretty(ymd(e.Date))}  ${name}${tags ? `  (${tags})` : ""}`;
    };
    for (const ln of sideTypeLines(`  Events (${up.events.length})`, up.events, upEventLine, "    ")) P(ln);
  }

  P("");
  P(RULE);
  return out.join("\n") + "\n";
}

function main() {
  const mm = parseMonthArg(process.argv[2]);
  if (!mm) {
    process.stderr.write(
      `usage: yarn --silent month:view <mm>  (mm must be an integer 1..12, got ${JSON.stringify(process.argv[2])})\n`
    );
    process.exit(1);
  }
  try {
    const bundle = buildMonthBundle(mm);
    // Human-readable render → stdout (Jon copies this into chat).
    process.stdout.write(render(bundle));
    // Full structured bundle → staged file for the skill's write phase.
    const stageDir = path.join(__dirname, "..", "local", "plan");
    fs.mkdirSync(stageDir, { recursive: true });
    const stagePath = path.join(stageDir, `month-bundle-${pad2(mm)}.json`);
    fs.writeFileSync(stagePath, JSON.stringify(bundle, null, 2) + "\n");
    process.stderr.write(
      `\n[structured bundle staged → local/plan/month-bundle-${pad2(mm)}.json]\n`
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
