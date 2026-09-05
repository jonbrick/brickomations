# Brickomations Yarn Scripts

The shortcuts, what they touch, and whether they prompt. Details live in each `cli/*.js` header — this table is the map, not the manual.

**All flags are equals-form only:** `--date=YYYY-MM-DD`, `--from=YYYY-MM-DD --to=YYYY-MM-DD`, `--source=oura`. Space-separated (`--from 2026-01-01`) silently no-ops.

## Daily — small stuff (health, hobbies, calendars)

| Command | What it does | Prompts? |
|---|---|---|
| `yarn collect --auto` | Oura, Strava, Withings, blood pressure, Steam, GitHub → Notion. ±3 days around today | No |
| `yarn update --auto` | Notion records (sleep, workouts, weight, BP, gaming, meds, supps, events, trips) → their Google Calendars | No |
| `yarn collect --auto --source=oura --from=… --to=…` | One source, unattended. Same shape on `yarn update`. Bad `--source` errors with the valid list | No |
| `yarn collect` / `yarn update` | Interactive pickers; `--source=` / date flags skip their prompt | Yes — remaining pickers |
| `yarn journal:import` | 5MJ export in `_journal-inbox/` → `data/journal.json`. Empty inbox is a safe no-op | No |

`--source` ids: `oura` `strava` `withings` `bloodPressure` `steam` `githubPersonal` `githubWork` (+ `medications` `supplements` `events` `trips` on `update` only).

No meditation collector exists — that calendar is hand-filled.

## Weekly — planning & work state

| Command | What it does | Prompts? |
|---|---|---|
| `yarn pull --auto` | Notion → local `data/*.json` (tasks, rocks, plans, retros, goals, projects). **Mini only** — racing iCloud from the MacBook corrupts `data/` | No |
| `yarn pull:linear` | Linear → Notion (assigned issues → 2026 Tasks, assigned projects → 2026 Projects) **and** → local `data/linearTeam.json` (design-team roster issues + my recent comments). `--dry-run` previews | No |
| `yarn push --auto` | Local retro/plan edits → Notion. Manual + skill-invoked only, never scheduled | No |
| `yarn vault-sync` | Notion → Obsidian vault mirrors (`personal/`) | No |

## Bundles — session inputs for skills

| Command | What it does |
|---|---|
| `yarn retro:bundle <N>` | Week N retro bundle (use `--silent`; pair with `node scripts/retro-readiness.js <N> <N>`) |
| `yarn plan:bundle <N>` | Week N planning bundle |
| `node scripts/retro-weeks.js personal\|work` | Which weeks still need retro work |
| `node scripts/reconcile-planned-events.js --pull <N>` | Audit `Planned:` calendar events for week N |

## Heavy — the full pipeline

| Command | What it does |
|---|---|
| `yarn sync` | tokens → collect → update → summarize → aggregate → pull → vault-sync. The Mac mini runs this on schedule — manual runs are for backfills (`yarn sync --from=… --to=…`) |
| `yarn summarize` / `yarn aggregate` | Week / month rollups alone. Both prompt without `--auto` |
| `yarn tokens:check` / `tokens:refresh` | OAuth token health |

## Local data map (`data/` = iCloud Brickography)

`life.json` tasks/plans/projects · `plan.json` weeks/rocks/events · `retro.json` retros · `summaries.json` week+month rollups · `calendar.json` habit calendars · `collected.json` raw sources · `journal.json` 5MJ · `linearTeam.json` design-team Linear view (roster issues + my comments, week-numbered)
