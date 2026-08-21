#!/usr/bin/env node

/**
 * Pull Linear CLI
 *
 * Caches Linear work state as local JSON so sessions (plan:bundle, retros,
 * fill-tasks skills) never need a live Linear call:
 *
 *   data/workProjects.json — every project in the configured teams
 *     (LINEAR_PROJECT_TEAM_KEYS) in started/planned states. No relevance
 *     filter — the `role` field (lead/member/null) moves that judgment to
 *     session-time, and `updatedAt` lets sessions flag stale projects.
 *
 *   data/workTasks.json — issues assigned to the authenticated user, any
 *     team, every state. Completed and canceled issues kept 21 days back.
 *     Columns mirror Notion 2026 Tasks where a true equivalent exists
 *     (Task, Status, Due Date, Priority, Week Number); Status speaks
 *     Linear's native vocabulary, verbatim-from-source, with State Type
 *     alongside for type-based mapping.
 *
 * Also the Linear → Notion collector: upserts assigned issues into the
 * shared 2026 Tasks DB and assigned projects (lead or member, any state,
 * any team) into the shared 2026 Projects DB, so Notion is the one
 * holistic layer for phone-side retro/planning.
 *
 * Deliberately separate from `yarn pull` / `yarn sync`: a Linear failure
 * must not stale the Notion/Calendar caches. Own launchd job
 * (com.brickomations.pull-linear), own heartbeat ping.
 *
 * Fail loud, never partial: both files are written only after every fetch
 * has succeeded; any error leaves the existing caches untouched, pings
 * the heartbeat as failed, and exits 1.
 *
 * Usage: yarn pull:linear [--dry-run]
 *
 * --dry-run reads Linear and Notion, prints the would-be Notion actions
 * (creates/updates/gone), and writes nothing — no JSON caches, no Notion
 * writes, no heartbeat ping.
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
const { readFileSyncRetry, writeFileSyncRetry } = require("../src/utils/fs-retry");

const REPO_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const HEARTBEAT_SCRIPT = path.join(REPO_ROOT, "scripts", "heartbeat-ping.sh");
const JOB_NAME = "pull-linear";
const DRY_RUN = process.argv.includes("--dry-run");

const PROJECT_STATES = ["started", "planned"];
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

function toProjectRecord(node, teamKey, viewerId) {
  const memberIds = (node.members?.nodes || []).map((m) => m.id);
  let role = null;
  if (node.lead && node.lead.id === viewerId) role = "lead";
  else if (memberIds.includes(viewerId)) role = "member";

  return {
    id: node.id,
    name: node.name,
    url: node.url,
    lead: node.lead ? node.lead.name : null,
    role,
    status: node.status ? node.status.name : null,
    state: node.state,
    priority: node.priorityLabel === "No priority" ? "" : node.priorityLabel,
    labels: (node.labels?.nodes || []).map((l) => l.name),
    team: teamKey,
    startDate: node.startDate || null,
    targetDate: node.targetDate || null,
    startedAt: node.startedAt || null,
    updatedAt: node.updatedAt || null,
    summary: node.description || "",
  };
}

/**
 * Slim record for the Notion 2026 Projects upsert — distinct from
 * toProjectRecord (the workProjects.json cache shape): different fetch
 * (assigned-to-me, all states vs. team + started/planned) and only the
 * fields the sync writes. Linear ID is the project UUID — projects have
 * no DSGN-123-style identifier.
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

  const teams = await linear.getTeamsByKey(teamKeys);
  const teamsByKey = new Map(teams.map((t) => [t.key, t]));
  const missing = teamKeys.filter((k) => !teamsByKey.has(k));
  if (missing.length > 0) {
    throw new Error(`Linear team key(s) not found: ${missing.join(", ")}`);
  }

  // Iterate in configured-key order; a project on multiple pulled teams is
  // recorded once, under the first team it appears for.
  const projects = [];
  const seenProjectIds = new Set();
  for (const key of teamKeys) {
    const team = teamsByKey.get(key);
    const nodes = await linear.getTeamProjects(team.id, PROJECT_STATES);
    for (const node of nodes) {
      if (seenProjectIds.has(node.id)) continue;
      seenProjectIds.add(node.id);
      projects.push(toProjectRecord(node, team.key, viewer.id));
    }
    console.log(`  ✓ ${nodes.length} ${key} projects (${PROJECT_STATES.join(" + ")})`);
  }
  projects.sort(
    (a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name)
  );

  const completedCutoff = new Date(
    Date.now() - COMPLETED_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const issues = await linear.getAssignedIssues(completedCutoff);
  console.log(
    `  ✓ ${issues.length} assigned issues (completed kept ${COMPLETED_WINDOW_DAYS} days back)`
  );

  // The Notion projects leg pulls by assignment (lead or member), all
  // states — independent of the team-scoped workProjects.json fetch above,
  // which stays unchanged until the retire-Linear-direct-caches ticket.
  const assignedNodes = await linear.getAssignedProjects(viewer.id);
  console.log(
    `  ✓ ${assignedNodes.length} assigned projects (lead or member, all states)`
  );
  const assignedProjects = assignedNodes
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
    console.log("\n[dry-run] nothing written (no caches, no Notion, no heartbeat)");
    return;
  }

  // Every fetch succeeded — only now touch the caches (never partial).
  const now = new Date().toISOString();

  writeFileSyncRetry(
    path.join(DATA_DIR, "workProjects.json"),
    JSON.stringify(
      {
        _meta: {
          source: "pull-linear",
          pulledAt: now,
          member: viewer.name,
          teams: teamKeys,
          states: PROJECT_STATES,
        },
        projects,
      },
      null,
      2
    )
  );
  console.log(`✅ data/workProjects.json written (${projects.length} projects)`);

  writeFileSyncRetry(
    path.join(DATA_DIR, "workTasks.json"),
    JSON.stringify(
      {
        _meta: {
          source: "pull-linear",
          pulledAt: now,
          assignee: viewer.name,
          completedWindowDays: COMPLETED_WINDOW_DAYS,
        },
        tasks,
      },
      null,
      2
    )
  );
  console.log(`✅ data/workTasks.json written (${tasks.length} issues)`);

  // Linear → Notion: upsert issues into the shared 2026 Tasks DB so Notion
  // is the one holistic layer for phone-side retro/planning. Upsert on
  // Linear ID; absent issues marked 🫥 Gone (settled rows left alone).
  // TODO(retire-local-linear-pull): once the ingestion is proven, the JSON
  // caches above should derive from Notion (via vault-sync) instead of
  // Linear directly — local must become a pure read of Notion.
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
    `${projects.length} projects, ${tasks.length} issues, notion tasks ` +
      `+${sync.created}/~${sync.updated}/gone ${sync.gone}, notion projects ` +
      `+${projectSync.created}/~${projectSync.updated}/gone ${projectSync.gone}`
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
