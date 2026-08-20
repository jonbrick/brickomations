# CLAUDE.md

Brickomations is a personal data pipeline: external APIs (GitHub, Oura, Strava, Steam, Withings) → Notion → Google Calendar → weekly/monthly summaries. Plain Node.js (CommonJS), no TypeScript, no automated tests.

## Two repos

Brickomations is one half of the Brickosystem; the other is the Brickocampus vault at `~/projects/brickocampus/` (Obsidian, in Obsidian's iCloud container). They're separate because brickomations has node_modules and a git history that iCloud would corrupt. `data/` is a symlink to `~/Documents/brickography/data/` (iCloud Drive, outside the vault — the local copy of Brickography) — the Mac mini writes (`yarn pull`), the work MacBook reads. Don't run `yarn pull` from the MacBook — it races iCloud sync.

Reflection/planning skills (`/retro-week`, `/plan-*`, `/recap-month`) live in the vault's `.claude/skills/`, not here. Launch Claude Code from the vault to use them.

## Gotchas

- **`NOTION_*_DATABASE_ID` env vars hold database UUIDs, not data source UUIDs.** Use the 32-char ID from the `notion.so/<id>` URL — never the `collection://<id>` data source ID some tooling surfaces.
- **Brickomations improvements / bugs aren't tracked here.** They live as personal projects in Notion (`2026 Projects` DB) with vault stubs at `~/projects/brickocampus/personal/projects/`. Don't add project or bug lists to this file — they churn the repo.
- **Personal Google Calendars aren't on Claude's GCal MCP.** Claude's MCP runs as `jon.brick@cortex.io` (work) — it can read/write work calendars but returns `PrincipalImpl has no access to LazyEmailPrincipal` on any personal calendar (Sleep In, Normal Wake Up, Naps, Sober, Drinking, Workout, Reading, Meditation, Cooking, Art, Coding, Music, Video Games, Body Weight, Blood Pressure, Personal PRs, personalCalendar). **Escape hatch:** brickomations's `.env` has `PERSONAL_GOOGLE_REFRESH_TOKEN` on both machines; a local node script using `src/services/GoogleCalendarService.js` with `accountType = "personal"` can list/create/delete on any personal cal. Patterns:
  - **Ad-hoc event batches (JSON-driven, reusable):** write events to `local/calendar/personal-events.json` (array of `{summary, start, end, calendar, description?, location?}`), then `node scripts/push-personal-cal-events.js [--dry-run]`. Idempotent (60-sec match window). Default route when Claude needs to drop time-blocked events on a personal cal.
  - **One-off cleanups (hardcoded data):** `scripts/cleanup-stale-oura-naps-on-gcal.js` is the template — copy and edit when the data is a fixed historical migration.

  Don't waste MCP calls trying to reach personal cals — go straight to a brickomations-local script.

## Development principles

- **Config-driven first.** If a feature can be added via `src/config/unified-sources.js`, it should be.
- **Three-layer naming is strict.** Layer 1 = integration names (`oura`, `strava`), Layer 2 = domain names (`sleep`, `workouts`), Layer 3 = summary-group names (`personalRecap`). Never mix.
- **Output at the edges.** Only files in `cli/` print to console. Workflows, databases, transformers, services return structured data.
- **Collectors never touch sync state fields.** Separation of concerns is strict.
- **Batch operations must be idempotent** and safe for multi-week runs.
- **Pre-stage data for LLMs.** Agents reading flat JSON/markdown don't burn API tokens; the script pays for itself the first time it runs.
- **Fail loud, never partial success.** When a sync stage errors, the whole pipeline bails. Don't propose "exit 0 if at least one succeeded" or "log + skip the broken source" — stale data is harder to notice than a missing run.
- **Bounded runtime.** Every scheduled job has a hard wall-clock timeout. On timeout: SIGTERM → grace → SIGKILL.

## Conventions

- **`@layer` JSDoc annotation** on every source file: `@layer 1 - Integration (API-Specific)`, `@layer 2`, or `@layer 3`.
- **Property/column lookups go through `pick()`** from `src/utils/property-lookup.js` (case-insensitive). Used by `NotionDatabase.extractProperty` and the CSV reader in `cli/plan-parse.js` so capitalization changes in Notion property names or CSV column headers don't break the pipeline.
- **PRs only, never direct to main.** Branch off main, push, open with `gh pr create`, wait for merge. The vault is the only exception (not a git repo).
