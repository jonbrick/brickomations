#!/usr/bin/env node

/**
 * Pull Linear CLI
 *
 * The Linear → Notion collector: upserts assigned issues (scoped to the
 * LINEAR_PROJECT_TEAM_KEYS teams) and in-scope projects (any state) into
 * the shared 2026 Tasks and 2026 Projects DBs, so Notion is the one
 * holistic layer for phone-side retro/planning. Project scope: every
 * project whose only team is a whole-team key (PD), plus any other
 * configured-team project Jon leads (DE).
 *
 * Also writes ONE local JSON, data/linearTeam.json — the design-team
 * view Notion deliberately doesn't carry: issues assigned to the
 * LINEAR_DESIGN_TEAM_EMAILS roster (any team, delegation visible via
 * Creator), the viewer's recent issue comments, and the project-update
 * posts on the LINEAR_PROJECT_TEAM_KEYS teams' projects (every author,
 * full body — retro and founder-update context). Local-only, never
 * synced to Notion; retro/audit sessions query it directly. All other
 * local work state still derives from Notion via `yarn pull` (both DBs
 * land in data/life.json), same as every other source.
 *
 * Deliberately separate from `yarn pull` / `yarn sync`: a Linear failure
 * must not stale the Notion/Calendar caches. Own launchd job
 * (com.brickomations.pull-linear), own heartbeat ping.
 *
 * Fail loud, never partial: the Notion sync runs only after every fetch
 * has succeeded; any error pings the heartbeat as failed and exits 1.
 *
 * Also upserts every project-update post (any author) on those in-scope
 * projects into the 📣 2026 Project Updates DB (one row per post, related
 * to its 2026 Projects row) — last 14 days on a scheduled run; `yarn pull`
 * brings them down to data/life.json (`projectUpdates`).
 *
 * Usage: yarn pull:linear [--dry-run] [--tasks-only | --updates-only]
 *                         [--days=N | --from=YYYY-MM-DD --to=YYYY-MM-DD | --date=YYYY-MM-DD]
 *                         [--updates-since=YYYY-MM-DD]
 *
 * --dry-run reads Linear and Notion, prints the would-be Notion actions
 * (creates/updates/gone), and writes nothing — no Notion writes, no
 * heartbeat ping.
 *
 * --tasks-only runs just the assigned-issues → Notion 2026 Tasks leg: no
 * projects sync, no team-roster/comments/project-updates fetch, no
 * data/linearTeam.json write (iCloud-safe from the MacBook), and no
 * heartbeat ping — the
 * pull-linear heartbeat attests the full scheduled job, and a partial
 * manual run must not vouch for legs it skipped. Behind yarn linear:week
 * (--days=8) and yarn linear:range (append --from=/--to=).
 *
 * --updates-only runs just the project-updates → Notion leg (the in-scope
 * projects are read to scope and relate the posts, never written): no
 * tasks or projects sync, no team cache write, no heartbeat ping. The
 * backfill / test path: `yarn pull:linear --updates-only
 * --updates-since=2026-01-01`. A post on a project the 2026 Projects DB
 * doesn't have yet lands with an empty relation — the next full pull
 * fills it.
 *
 * --updates-since=YYYY-MM-DD widens the project-updates window from the
 * 14-day default to every post since that date (NY-local midnight).
 *
 * Settled window — which completed / canceled issues come along (open
 * issues always do, so the Notion gone-pass stays safe at any width):
 *   default        last 21 days (the scheduled job)
 *   --days=N       last N days
 *   --from/--to    settled inside that date range (equals-form, like
 *                  every other date-aware CLI); --date=X is --from=X --to=X
 * --days and --from/--to are mutually exclusive.
 *
 * Backlog-state issues never sync — noise in a committed-work DB. They are
 * dropped right after the fetch, so the Notion gone-pass retires any rows
 * they left behind.
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
const {
  syncLinearProjectUpdates,
} = require("../src/workflows/linear-to-notion-project-updates");
const { readFileSyncRetry } = require("../src/utils/fs-retry");
const { parseDateRangeFromArgv, createSpinner } = require("../src/utils/cli");

const REPO_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const HEARTBEAT_SCRIPT = path.join(REPO_ROOT, "scripts", "heartbeat-ping.sh");
const JOB_NAME = "pull-linear";
const DRY_RUN = process.argv.includes("--dry-run");
const TASKS_ONLY = process.argv.includes("--tasks-only");
const UPDATES_ONLY = process.argv.includes("--updates-only");

const COMPLETED_WINDOW_DAYS = 21;
// Rolling window for the viewer's own comments in the local team cache —
// wide enough that a weekly retro run any time the following week still
// sees the full prior week, with room for a lapsed week or two.
const COMMENT_WINDOW_DAYS = 35;
// Rolling window for project-update posts — wide enough for a monthly
// recap run well into the following month. Low volume (a few posts per
// project per month), so the width costs nothing.
const PROJECT_UPDATE_WINDOW_DAYS = 90;
// Rolling window for the project-updates → Notion leg. Rows outside it are
// never touched, so this only bounds how late an edit in Linear still
// reaches Notion; posts are never future-dated. --updates-since widens it.
const PROJECT_UPDATES_SYNC_DAYS = 14;
// Teams whose projects all come into 2026 Projects — but only projects
// owned by these teams alone; a cross-team project that merely lists PD is
// another team's work. Any other LINEAR_PROJECT_TEAM_KEYS team (DE) only
// contributes the projects Jon leads.
const WHOLE_TEAM_KEYS = ["PD"];
const TEAM_CACHE_FILE = path.join(DATA_DIR, "linearTeam.json");
// Bounded runtime: the per-job wakelock lasts as long as the process, so a
// hung API call must not hold the mini awake. A handful of GraphQL pages
// takes seconds; 3 minutes is the same per-step budget yarn sync uses.
const WALL_CLOCK_TIMEOUT_MS = 3 * 60 * 1000;

// --- Settled window ---

/**
 * Resolve the settled-issue window from argv: --days=N, --from/--to
 * (--date shorthand), or the 21-day default. Returns ISO bounds for the
 * Linear filter (`to` null = open-ended) plus a label for the log line.
 * Bad or mixed flags throw — fail loud, same as every other CLI here.
 */
function resolveSettledWindow(argv) {
  const daysArg = argv.find((a) => a.startsWith("--days="));
  const { range, error } = parseDateRangeFromArgv(argv);
  if (error) throw new Error(error);
  if (daysArg && range) {
    throw new Error("Cannot combine --days with --from/--to/--date. Use one or the other.");
  }

  if (range) {
    return {
      from: range.fromDate.toISOString(),
      to: range.toDate.toISOString(),
      label: `settled ${range.from} → ${range.to}`,
    };
  }

  let days = COMPLETED_WINDOW_DAYS;
  if (daysArg) {
    const raw = daysArg.slice("--days=".length);
    days = Number(raw);
    if (!Number.isInteger(days) || days < 1) {
      throw new Error(`Invalid --days value: "${raw}". Expected a positive integer.`);
    }
  }
  return {
    from: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    to: null,
    label: `settled kept ${days} days back`,
  };
}

/**
 * Cutoff (ISO datetime) for the project-updates leg: --updates-since=
 * YYYY-MM-DD (start of that NY-local day), or the 14-day default.
 */
function resolveUpdatesCutoff(argv) {
  const arg = argv.find((a) => a.startsWith("--updates-since="));
  if (!arg) {
    return {
      cutoff: new Date(
        Date.now() - PROJECT_UPDATES_SYNC_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
      label: `last ${PROJECT_UPDATES_SYNC_DAYS} days`,
    };
  }
  const day = arg.slice("--updates-since=".length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
    throw new Error(`Invalid --updates-since value: "${day}". Expected YYYY-MM-DD.`);
  }
  // Noon UTC on that day is always the same NY date; back off to NY midnight.
  const noonUtc = new Date(`${day}T12:00:00Z`);
  const nyHour = Number(
    noonUtc.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    })
  );
  const nyMidnight = new Date(noonUtc.getTime() - nyHour * 60 * 60 * 1000);
  return { cutoff: nyMidnight.toISOString(), label: `since ${day}` };
}

// --- Heartbeat ---

function pingHeartbeat(status, message) {
  // A rehearsal is not a run, and a tasks-only run skips legs the heartbeat
  // attests — neither may touch it.
  if (DRY_RUN || TASKS_ONLY || UPDATES_ONLY) return;
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
function toProjectRecord(node) {
  return {
    Id: node.id,
    Name: node.name,
    URL: node.url,
    // Linear project state type: backlog/planned/started/paused/completed/canceled
    State: node.state,
    Priority: node.priorityLabel === "No priority" ? "" : node.priorityLabel,
    "Start Date": node.startDate || "",
    "Target Date": node.targetDate || "",
    // Short summary metadata + the overview doc (markdown). Both sync-owned
    // on the Notion side — Linear is the source of truth for work projects.
    Description: node.description || "",
    Content: node.content || "",
    // Linear display name of the project lead ("" when unassigned) — tells
    // Jon's projects from teammates' in every Notion/local view.
    Lead: node.lead ? node.lead.name : "",
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
    // Issue description (markdown) — becomes the Notion page body.
    Content: node.description || "",
    Project: node.project ? node.project.name : "",
    Team: node.team ? node.team.key : "",
    "Completed At": node.completedAt || "",
    "Canceled At": node.canceledAt || "",
  };
}

/**
 * NY-local YYYY-MM-DD for an ISO datetime — comment timestamps are UTC and
 * would otherwise week-bucket late-evening comments onto the next day.
 */
function nyDate(isoDatetime) {
  if (!isoDatetime) return "";
  return new Date(isoDatetime).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

/**
 * Team-cache issue record: toTaskRecord minus the bulky description, plus
 * the fields delegation queries need (Creator, Assignee Email, created /
 * updated stamps). Week Number derives from the due date, matching tasks.
 */
function toTeamIssueRecord(node, weeks) {
  return {
    Identifier: node.identifier,
    Task: node.title,
    Status: node.state.name,
    "State Type": node.state.type,
    Assignee: node.assignee ? node.assignee.name : "",
    "Assignee Email": node.assignee ? node.assignee.email : "",
    Creator: node.creator ? node.creator.name : "",
    "Due Date": node.dueDate || "",
    "Week Number": weekNumberFor(node.dueDate, weeks),
    Priority: node.priorityLabel === "No priority" ? "" : node.priorityLabel,
    Project: node.project ? node.project.name : "",
    Team: node.team ? node.team.key : "",
    URL: node.url,
    "Created At": node.createdAt || "",
    "Updated At": node.updatedAt || "",
    "Completed At": node.completedAt || "",
    "Canceled At": node.canceledAt || "",
  };
}

/**
 * Team-cache comment record. Week Number derives from the NY-local date
 * the comment was written — that's the "what did I touch this week" axis.
 * Body is capped: the cache tracks touches, it isn't a comment archive.
 */
function toCommentRecord(node, weeks) {
  const day = nyDate(node.createdAt);
  return {
    Identifier: node.issue.identifier,
    Issue: node.issue.title,
    Assignee: node.issue.assignee ? node.issue.assignee.name : "",
    Team: node.issue.team ? node.issue.team.key : "",
    Date: day,
    "Week Number": weekNumberFor(day, weeks),
    Body: (node.body || "").slice(0, 500),
    URL: node.url || node.issue.url,
  };
}

/**
 * Team-cache project-update record: one Linear "Project update" post.
 * Full body kept — unlike comments, the post IS the context (what shipped,
 * what slipped, the health call) and volume is low. Week Number derives
 * from the NY-local post date, the same axis as comments. Mine marks the
 * viewer's own posts so consumers can filter without knowing the email.
 */
function toProjectUpdateRecord(node, weeks, viewerEmail) {
  const day = nyDate(node.createdAt);
  const authorEmail = node.user ? node.user.email : "";
  return {
    Project: node.project.name,
    "Project URL": node.project.url,
    Teams: (node.project.teams?.nodes || []).map((t) => t.key),
    Author: node.user ? node.user.name : "",
    "Author Email": authorEmail,
    Mine: Boolean(viewerEmail) && authorEmail === viewerEmail,
    // Linear health call on the post: onTrack / atRisk / offTrack
    Health: node.health || "",
    Date: day,
    "Week Number": weekNumberFor(day, weeks),
    Body: node.body || "",
    URL: node.url,
    "Created At": node.createdAt || "",
    "Edited At": node.editedAt || "",
  };
}

/**
 * One project-update post, for the 📣 2026 Project Updates upsert. Date
 * is the NY-local post date (a late-evening post belongs to the day it was
 * written); Changes is Linear's diff list on the post.
 */
function toProjectUpdateSyncRecord(node) {
  return {
    Id: node.id,
    Project: node.project.name,
    "Project Id": node.project.id,
    Author: node.user ? node.user.name : "",
    Date: nyDate(node.createdAt),
    Health: node.health || "",
    Changes: node.diffMarkdown || "",
    Body: node.body || "",
    URL: node.url,
    "Created At": node.createdAt || "",
  };
}

/** The 2026 Projects scope rule — see WHOLE_TEAM_KEYS. */
function inProjectScope(node, viewerId, teamKeys) {
  const keys = (node.teams?.nodes || []).map((t) => t.key);
  if (keys.length > 0 && keys.every((k) => WHOLE_TEAM_KEYS.includes(k))) {
    return true;
  }
  return node.lead?.id === viewerId && keys.some((k) => teamKeys.includes(k));
}

/** In-scope projects (all states) on the configured teams. */
async function fetchScopedProjects(linear, viewer, teamKeys) {
  const nodes = await step("Fetching Linear projects...", () =>
    linear.getProjectsOnTeams(teamKeys)
  );
  const scoped = nodes.filter((node) => inProjectScope(node, viewer.id, teamKeys));
  console.log(
    `  ✓ ${scoped.length} in-scope projects (all ${WHOLE_TEAM_KEYS.join("/")}-only ` +
      `projects + the rest I lead, all states; ${nodes.length} on ${teamKeys.join("/")} overall)`
  );
  return scoped.map(toProjectRecord).sort((a, b) => a.Name.localeCompare(b.Name));
}

/**
 * Every project-update post inside the window on the projects the pull
 * syncs, any author. Oldest first so a backfill creates rows in posting
 * order.
 */
async function fetchProjectUpdates(linear, projects) {
  const { cutoff, label } = resolveUpdatesCutoff(process.argv);
  const nodes = (
    await step("Fetching project updates on in-scope projects...", () =>
      linear.getProjectUpdatesOnProjects(projects.map((p) => p.Id), cutoff)
    )
  ).filter((node) => node.project);
  const records = nodes
    .map(toProjectUpdateSyncRecord)
    .sort((a, b) => a["Created At"].localeCompare(b["Created At"]));
  console.log(`  ✓ ${records.length} project updates on in-scope projects (${label})`);
  return records;
}

function logUpdatesPlan(sync) {
  console.log(
    `\n[dry-run] project updates plan: ${sync.created} create, ` +
      `${sync.updated} update, ${sync.unchanged} unchanged` +
      (sync.unlinked ? `, ${sync.unlinked} without a 2026 Projects row` : "")
  );
  for (const action of sync.actions) console.log(`  ${action}`);
}

function updatesSummary(sync) {
  return (
    `${sync.created} created, ${sync.updated} updated, ${sync.unchanged} unchanged` +
    (sync.unlinked ? `, ${sync.unlinked} without a 2026 Projects row` : "")
  );
}

/** --updates-only: the project-updates leg alone (backfill / test path). */
async function runUpdatesOnly(linear, viewer, teamKeys) {
  const projects = await fetchScopedProjects(linear, viewer, teamKeys);
  const updates = await fetchProjectUpdates(linear, projects);
  if (DRY_RUN) {
    logUpdatesPlan(
      await step("Planning Notion 2026 Project Updates sync...", () =>
        syncLinearProjectUpdates(updates, { dryRun: true })
      )
    );
    console.log("\n[dry-run] nothing written");
    return;
  }
  const sync = await step("Syncing Notion 2026 Project Updates...", () =>
    syncLinearProjectUpdates(updates)
  );
  console.log(`✅ Notion 2026 Project Updates synced (${updatesSummary(sync)})`);
  console.log("[updates-only] skipped: tasks, projects sync, team cache, heartbeat");
}

// Spins while a step waits on Linear or Notion (TTY only, so launchd logs
// stay clean); the step's own ✓ line prints after the spinner clears.
const spinner = createSpinner("Working...");
async function step(label, fn) {
  spinner.start(label);
  try {
    return await fn();
  } finally {
    spinner.stop();
  }
}

// --- Main ---

async function main() {
  if (TASKS_ONLY && UPDATES_ONLY) {
    throw new Error("--tasks-only and --updates-only are mutually exclusive.");
  }
  console.log(
    TASKS_ONLY
      ? "[pull-linear] pulling assigned issues (tasks-only)"
      : UPDATES_ONLY
        ? "[pull-linear] pulling project updates (updates-only)"
        : "[pull-linear] pulling Linear projects + assigned issues + project updates"
  );

  const teamKeys = (process.env.LINEAR_PROJECT_TEAM_KEYS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (teamKeys.length === 0) {
    throw new Error(
      "LINEAR_PROJECT_TEAM_KEYS is required (comma-separated Linear team keys scoping the tasks and projects pulls)"
    );
  }

  const rosterEmails = (process.env.LINEAR_DESIGN_TEAM_EMAILS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!TASKS_ONLY && !UPDATES_ONLY && rosterEmails.length === 0) {
    throw new Error(
      "LINEAR_DESIGN_TEAM_EMAILS is required (comma-separated Linear member emails for the local team cache)"
    );
  }

  // Checked before any write: a missing ID must not leave tasks and
  // projects synced and the updates leg silently absent.
  if (!TASKS_ONLY && !process.env.NOTION_PROJECT_UPDATES_DATABASE_ID) {
    throw new Error(
      "NOTION_PROJECT_UPDATES_DATABASE_ID is required (Notion database ID of 📣 2026 Project Updates)"
    );
  }

  const weeks = loadWeeks();
  const linear = new LinearService();

  const viewer = await step("Authenticating with Linear...", () =>
    linear.getViewer()
  );
  console.log(`  ✓ authenticated as ${viewer.name}`);

  if (UPDATES_ONLY) return runUpdatesOnly(linear, viewer, teamKeys);

  const settledWindow = resolveSettledWindow(process.argv);
  // Backlog-state issues never reach Notion: the Tasks DB holds committed,
  // dated work, and backlog is noise there (Jon, Thu 2026-10-22). Dropping
  // them here lets the sync's gone pass retire any rows they left behind;
  // an issue promoted out of backlog re-enters on the next run.
  //
  // Issues off the configured teams never reach Notion either: anything
  // Jon owns on another team gets a twin ticket on a PD/DE board, and the
  // twin is the tracked row (Jon, Thu 2026-10-29). Same gone-pass retire
  // for rows the off-team originals left behind; settled rows stay put.
  const pulled = await step("Fetching assigned issues...", () =>
    linear.getAssignedIssues(settledWindow)
  );
  const nonBacklog = pulled.filter((node) => node.state.type !== "backlog");
  const issues = nonBacklog.filter((node) => teamKeys.includes(node.team?.key));
  console.log(
    `  ✓ ${issues.length} assigned ${teamKeys.join("/")} issues (${settledWindow.label}; ` +
      `${pulled.length - nonBacklog.length} backlog skipped, ` +
      `${nonBacklog.length - issues.length} off-team skipped)`
  );

  // The projects leg pulls by scope (whole PD team, DE projects Jon
  // leads), all states — see WHOLE_TEAM_KEYS. Skipped under --tasks-only.
  let projects = [];
  let projectUpdatesToSync = [];
  if (!TASKS_ONLY) {
    projects = await fetchScopedProjects(linear, viewer, teamKeys);
    projectUpdatesToSync = await fetchProjectUpdates(linear, projects);
  }

  // Local team cache: roster-assigned issues, the viewer's recent issue
  // comments, and project-update posts on the configured teams' projects.
  // Fetched before any Notion write so a cache failure fails the whole run
  // loudly rather than leaving a fresh Notion / stale cache split.
  // Skipped under --tasks-only.
  let teamIssues = [];
  let myComments = [];
  let projectUpdates = [];
  let teamCache = null;
  if (!TASKS_ONLY) {
    const rosterNodes = await step("Fetching team-roster issues...", () =>
      linear.getIssuesAssignedToEmails(rosterEmails, settledWindow)
    );
    console.log(
      `  ✓ ${rosterNodes.length} team-roster issues (${rosterEmails.length} members, ` +
        `${settledWindow.label})`
    );

    const commentCutoff = new Date(
      Date.now() - COMMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const commentNodes = (
      await step("Fetching my issue comments...", () =>
        linear.getMyRecentComments(commentCutoff)
      )
    ).filter((node) => node.issue);
    console.log(
      `  ✓ ${commentNodes.length} of my issue comments (last ${COMMENT_WINDOW_DAYS} days)`
    );

    // Project updates are team-scoped, not assignment-scoped: a roster
    // member's project the viewer isn't on still matters for the team
    // read, and other leads' posts on shared projects are the context a
    // founder update must not duplicate.
    const updateCutoff = new Date(
      Date.now() - PROJECT_UPDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const updateNodes = (
      await step("Fetching project updates on team projects...", () =>
        linear.getProjectUpdates(teamKeys, updateCutoff)
      )
    ).filter((node) => node.project);
    projectUpdates = updateNodes
      .map((node) => toProjectUpdateRecord(node, weeks, viewer.email))
      .sort((a, b) => b["Created At"].localeCompare(a["Created At"]));
    const mineCount = projectUpdates.filter((u) => u.Mine).length;
    console.log(
      `  ✓ ${projectUpdates.length} project updates on ${teamKeys.join("/")} ` +
        `projects (${mineCount} mine, last ${PROJECT_UPDATE_WINDOW_DAYS} days)`
    );

    teamIssues = rosterNodes
      .map((node) => toTeamIssueRecord(node, weeks))
      .sort(
        (a, b) =>
          a.Assignee.localeCompare(b.Assignee) ||
          a.Identifier.localeCompare(b.Identifier)
      );
    myComments = commentNodes
      .map((node) => toCommentRecord(node, weeks))
      .sort((a, b) => b.Date.localeCompare(a.Date));
    teamCache = {
      _meta: {
        pulledAt: new Date().toISOString(),
        roster: rosterEmails,
        settledWindow: { from: settledWindow.from, to: settledWindow.to },
        commentWindowDays: COMMENT_WINDOW_DAYS,
        projectUpdateWindowDays: PROJECT_UPDATE_WINDOW_DAYS,
        projectTeamKeys: teamKeys,
      },
      teamIssues,
      myComments,
      projectUpdates,
    };
  }

  const tasks = issues.map((node) => toTaskRecord(node, weeks));
  // Dated first (soonest due at top), then undated; Identifier breaks ties.
  tasks.sort((a, b) => {
    const ad = a["Due Date"] || "9999-99-99";
    const bd = b["Due Date"] || "9999-99-99";
    return ad.localeCompare(bd) || a.Identifier.localeCompare(b.Identifier);
  });

  if (DRY_RUN) {
    const sync = await step("Planning Notion 2026 Tasks sync...", () =>
      syncLinearTasks(tasks, { dryRun: true })
    );
    console.log(
      `\n[dry-run] tasks plan: ${sync.created} create, ${sync.updated} update, ` +
        `${sync.gone} gone, ${sync.unchanged} unchanged`
    );
    for (const action of sync.actions) console.log(`  ${action}`);
    if (!TASKS_ONLY) {
      const projectSync = await step("Planning Notion 2026 Projects sync...", () =>
        syncLinearProjects(projects, { dryRun: true })
      );
      console.log(
        `\n[dry-run] projects plan: ${projectSync.created} create, ` +
          `${projectSync.updated} update, ${projectSync.gone} gone, ` +
          `${projectSync.unchanged} unchanged`
      );
      for (const action of projectSync.actions) console.log(`  ${action}`);
      logUpdatesPlan(
        await step("Planning Notion 2026 Project Updates sync...", () =>
          syncLinearProjectUpdates(projectUpdatesToSync, { dryRun: true })
        )
      );
      console.log(
        `\n[dry-run] team cache plan: ${teamIssues.length} issues, ` +
          `${myComments.length} comments, ${projectUpdates.length} project ` +
          `updates → ${TEAM_CACHE_FILE}`
      );
    }
    console.log("\n[dry-run] nothing written (no Notion, no local JSON, no heartbeat)");
    return;
  }

  if (!TASKS_ONLY) {
    fs.writeFileSync(TEAM_CACHE_FILE, JSON.stringify(teamCache, null, 2));
    console.log(
      `✅ data/linearTeam.json written (${teamIssues.length} team issues, ` +
        `${myComments.length} of my comments, ${projectUpdates.length} project updates)`
    );
  }

  // Linear → Notion: upsert issues into the shared 2026 Tasks DB so Notion
  // is the one holistic layer for phone-side retro/planning. Upsert on
  // Linear ID; absent issues marked 🫥 Gone (settled rows left alone).
  const sync = await step("Syncing Notion 2026 Tasks...", () =>
    syncLinearTasks(tasks)
  );
  console.log(
    `✅ Notion 2026 Tasks synced (${sync.created} created, ${sync.updated} updated, ` +
      `${sync.gone} marked gone, ${sync.unchanged} unchanged)`
  );

  if (TASKS_ONLY) {
    console.log("[tasks-only] skipped: projects sync, team cache, heartbeat");
    return;
  }

  const projectSync = await step("Syncing Notion 2026 Projects...", () =>
    syncLinearProjects(projects)
  );
  console.log(
    `✅ Notion 2026 Projects synced (${projectSync.created} created, ` +
      `${projectSync.updated} updated, ${projectSync.gone} marked gone, ` +
      `${projectSync.unchanged} unchanged)`
  );

  // After the projects leg, so a post on a newly synced project finds its
  // 2026 Projects row for the relation.
  const updateSync = await step("Syncing Notion 2026 Project Updates...", () =>
    syncLinearProjectUpdates(projectUpdatesToSync)
  );
  console.log(`✅ Notion 2026 Project Updates synced (${updatesSummary(updateSync)})`);

  pingHeartbeat(
    "ok",
    `notion tasks +${sync.created}/~${sync.updated}/gone ${sync.gone}, ` +
      `notion projects +${projectSync.created}/~${projectSync.updated}/gone ` +
      `${projectSync.gone}, notion project updates +${updateSync.created}/` +
      `~${updateSync.updated}, team cache ${teamIssues.length} issues/` +
      `${myComments.length} comments/${projectUpdates.length} project updates`
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
