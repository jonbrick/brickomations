#!/usr/bin/env node

/**
 * Pull Linear CLI
 *
 * The Linear → Notion collector, and nothing else: upserts assigned
 * issues into the shared 2026 Tasks DB and assigned projects (lead or
 * member, any state, on the LINEAR_PROJECT_TEAM_KEYS teams) into the
 * shared 2026 Projects DB, so Notion is the one holistic layer for
 * phone-side retro/planning.
 *
 * Writes no local JSON — local work state derives from Notion via
 * `yarn pull` (both DBs land in data/life.json), same as every other
 * source. Sessions (plan:bundle, retros, fill-tasks skills) read that.
 *
 * Deliberately separate from `yarn pull` / `yarn sync`: a Linear failure
 * must not stale the Notion/Calendar caches. Own launchd job
 * (com.brickomations.pull-linear), own heartbeat ping.
 *
 * Fail loud, never partial: the Notion sync runs only after every fetch
 * has succeeded; any error pings the heartbeat as failed and exits 1.
 *
 * Usage: yarn pull:linear [--dry-run]
 *
 * --dry-run reads Linear and Notion, prints the would-be Notion actions
 * (creates/updates/gone), and writes nothing — no Notion writes, no
 * heartbeat ping.
 *
 * @layer 1 - Integration (CLI)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const LinearService = require("../src/services/LinearService");
const { syncLinearTasks } = require("../src/workflows/linear-to-notion-tasks");
const {
  syncLinearProjects,
} = require("../src/workflows/linear-to-notion-projects");
const { readFileSyncRetry } = require("../src/utils/fs-retry");

const REPO_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const HEARTBEAT_SCRIPT = path.join(REPO_ROOT, "scripts", "heartbeat-ping.sh");
const JOB_NAME = "pull-linear";
const DRY_RUN = process.argv.includes("--dry-run");

const COMPLETED_WINDOW_DAYS = 21;
// Bounded runtime: the per-job wakelock lasts as long as the process, so a
// hung API call must not hold the mini awake. A handful of GraphQL pages
// takes seconds; 3 minutes is the same per-step budget yarn sync uses.
const WALL_CLOCK_TIMEOUT_MS = 3 * 60 * 1000;

// --- Heartbeat ---

function pingHeartbeat(status, message) {
  if (DRY_RUN) return; // a rehearsal is not a run — don't touch the heartbeat
  try {
    const args = [JOB_NAME, status];
    if (message) args.push(message);
    execFileSync(HEARTBEAT_SCRIPT, args, { stdio: "inherit" });
  } catch (err) {
    console.error(`[pull-linear] heartbeat ping failed: ${err.message}`);
  }
}

// --- Week Number derivation ---

/**
 * Load the 2026 Weeks cache from plan.json. Weeks run Sunday–Saturday;
 * canonical source is the Notion Weeks DB (refreshed by yarn pull).
 */
function loadWeeks() {
  const p = path.join(DATA_DIR, "plan.json");
  if (!fs.existsSync(p)) {
    throw new Error(
      `Required data file missing: ${p}. Run \`yarn pull\` first — Week Number derivation needs the Weeks cache.`
    );
  }
  const plan = JSON.parse(readFileSyncRetry(p, "utf8"));
  return (plan.weeks || [])
    .map((w) => ({
      number: parseInt(String(w.Week || "").replace(/^Week\s*/, ""), 10),
      start: w["Date Range (SET)"],
      end: w["Date Range (SET) End"],
    }))
    .filter((w) => Number.isInteger(w.number) && w.start && w.end);
}

/** "Week 28" (non-padded, matching Notion task values) or "" when undated / out of range. */
function weekNumberFor(dueDate, weeks) {
  if (!dueDate) return "";
  const week = weeks.find((w) => dueDate >= w.start && dueDate <= w.end);
  return week ? `Week ${week.number}` : "";
}

// --- Record shaping ---

/**
 * Slim record for the Notion 2026 Projects upsert — only the fields the
 * sync writes. Linear ID is the project UUID — projects have no
 * DSGN-123-style identifier.
 */
function toAssignedProjectRecord(node) {
  return {
    Id: node.id,
    Name: node.name,
    URL: node.url,
    // Linear project state type: backlog/planned/started/paused/completed/canceled
    State: node.state,
    Priority: node.priorityLabel === "No priority" ? "" : node.priorityLabel,
    "Start Date": node.startDate || "",
    "Target Date": node.targetDate || "",
    // A Linear project belongs to a teams *list* — kept whole so the sync
    // can seed Work Category from the first mapped key.
    Teams: (node.teams?.nodes || []).map((t) => t.key),
  };
}

function toTaskRecord(node, weeks) {
  return {
    Task: node.title,
    Status: node.state.name,
    // Linear state *type* (backlog/unstarted/started/completed/canceled) —
    // the Notion sync maps by type, never by team-specific state names.
    "State Type": node.state.type,
    "Due Date": node.dueDate || "",
    // Linear's "No priority" is Notion's blank — absence, not a value.
    Priority: node.priorityLabel === "No priority" ? "" : node.priorityLabel,
    "Week Number": weekNumberFor(node.dueDate, weeks),
    Assignee: node.assignee ? node.assignee.name : "",
    Identifier: node.identifier,
    URL: node.url,
    Project: node.project ? node.project.name : "",
    Team: node.team ? node.team.key : "",
    "Completed At": node.completedAt || "",
    "Canceled At": node.canceledAt || "",
  };
}

// --- Main ---

async function main() {
  console.log("[pull-linear] pulling Linear projects + assigned issues");

  const teamKeys = (process.env.LINEAR_PROJECT_TEAM_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (teamKeys.length === 0) {
    throw new Error(
      "LINEAR_PROJECT_TEAM_KEYS is required (comma-separated Linear team keys for the projects pull)"
    );
  }

  const weeks = loadWeeks();
  const linear = new LinearService();

  const viewer = await linear.getViewer();
  console.log(`  ✓ authenticated as ${viewer.name}`);

  const completedCutoff = new Date(
    Date.now() - COMPLETED_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const issues = await linear.getAssignedIssues(completedCutoff);
  console.log(
    `  ✓ ${issues.length} assigned issues (completed kept ${COMPLETED_WINDOW_DAYS} days back)`
  );

  // The projects leg pulls by assignment (lead or member), all states,
  // scoped to the configured teams — cross-team projects Jon is merely
  // attached to (e.g. as a stakeholder) stay out.
  const assignedNodes = await linear.getAssignedProjects(viewer.id);
  const teamScopedNodes = assignedNodes.filter((node) =>
    (node.teams?.nodes || []).some((t) => teamKeys.includes(t.key))
  );
  console.log(
    `  ✓ ${teamScopedNodes.length} assigned ${teamKeys.join("/")} projects ` +
      `(lead or member, all states; ${assignedNodes.length} assigned overall)`
  );
  const assignedProjects = teamScopedNodes
    .map(toAssignedProjectRecord)
    .sort((a, b) => a.Name.localeCompare(b.Name));

  const tasks = issues.map((node) => toTaskRecord(node, weeks));
  // Dated first (soonest due at top), then undated; Identifier breaks ties.
  tasks.sort((a, b) => {
    const ad = a["Due Date"] || "9999-99-99";
    const bd = b["Due Date"] || "9999-99-99";
    return ad.localeCompare(bd) || a.Identifier.localeCompare(b.Identifier);
  });

  if (DRY_RUN) {
    const sync = await syncLinearTasks(tasks, { dryRun: true });
    console.log(
      `\n[dry-run] tasks plan: ${sync.created} create, ${sync.updated} update, ` +
        `${sync.gone} gone, ${sync.unchanged} unchanged`
    );
    for (const action of sync.actions) console.log(`  ${action}`);
    const projectSync = await syncLinearProjects(assignedProjects, {
      dryRun: true,
    });
    console.log(
      `\n[dry-run] projects plan: ${projectSync.created} create, ` +
        `${projectSync.updated} update, ${projectSync.gone} gone, ` +
        `${projectSync.unchanged} unchanged`
    );
    for (const action of projectSync.actions) console.log(`  ${action}`);
    console.log("\n[dry-run] nothing written (no Notion, no heartbeat)");
    return;
  }

  // Linear → Notion: upsert issues into the shared 2026 Tasks DB so Notion
  // is the one holistic layer for phone-side retro/planning. Upsert on
  // Linear ID; absent issues marked 🫥 Gone (settled rows left alone).
  const sync = await syncLinearTasks(tasks);
  console.log(
    `✅ Notion 2026 Tasks synced (${sync.created} created, ${sync.updated} updated, ` +
      `${sync.gone} marked gone, ${sync.unchanged} unchanged)`
  );

  const projectSync = await syncLinearProjects(assignedProjects);
  console.log(
    `✅ Notion 2026 Projects synced (${projectSync.created} created, ` +
      `${projectSync.updated} updated, ${projectSync.gone} marked gone, ` +
      `${projectSync.unchanged} unchanged)`
  );

  pingHeartbeat(
    "ok",
    `notion tasks +${sync.created}/~${sync.updated}/gone ${sync.gone}, ` +
      `notion projects +${projectSync.created}/~${projectSync.updated}/gone ` +
      `${projectSync.gone}`
  );
}

// unref'd so a clean finish exits immediately; still fires if a hung
// request keeps the event loop alive past the cap.
const killTimer = setTimeout(() => {
  console.error(
    `[pull-linear] ❌ wall-clock timeout (${WALL_CLOCK_TIMEOUT_MS / 60000} min) exceeded`
  );
  pingHeartbeat("failed", "wall-clock timeout");
  process.exit(1);
}, WALL_CLOCK_TIMEOUT_MS);
killTimer.unref();

main().catch((error) => {
  console.error(`[pull-linear] ❌ ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  pingHeartbeat("failed", error.message);
  process.exit(1);
});
