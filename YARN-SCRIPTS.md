# Brickomations Yarn Scripts

The shortcuts, what they touch, and whether they prompt. Details live in
each cli/*.js header — this file is the map, not the manual.

Every command line is paste-safe: triple-click the line, paste, enter —
the shell runs the command and ignores the # description.

ALL FLAGS ARE EQUALS-FORM ONLY: --date=YYYY-MM-DD, --from=YYYY-MM-DD
--to=YYYY-MM-DD, --source=oura. Space-separated (--from 2026-01-01)
silently no-ops.

## The two I paste

```
yarn morning                # external sources → Notion + their calendars.
#                             ±3 days. skips meds/supps/events/trips (the
#                             slow full-DB legs). no prompts

yarn linear:tasks           # assigned issues → Notion 2026 Tasks. skips
#                             projects sync, team cache, heartbeat — safe
#                             from the MacBook. no prompts
```

## Daily — small stuff (health, hobbies, calendars)

```
yarn collect --auto         # Oura, Strava, Withings, blood pressure,
#                             Steam, GitHub → Notion. ±3 days around
#                             today. no prompts

yarn update --auto          # Notion records (sleep, workouts, weight, BP,
#                             gaming, meds, supps, events, trips) → their
#                             Google Calendars. no prompts

yarn update --auto --external-only
#                             same, minus the Notion-native four (meds,
#                             supps, events, trips). half of yarn morning.
#                             no prompts

yarn collect --auto --source=oura --from=… --to=…
#                             one source, unattended. same shape on
#                             yarn update. bad --source errors with the
#                             valid list. no prompts

yarn collect                # interactive pickers (same on yarn update);
#                             --source= / date flags skip their prompt.
#                             PROMPTS

yarn journal:import         # 5MJ export in _journal-inbox/ →
#                             data/journal.json. empty inbox is a safe
#                             no-op. no prompts
```

--source ids: oura strava withings bloodPressure steam githubPersonal
githubWork (+ medications supplements events trips on update only).

No meditation collector exists — that calendar is hand-filled.

## Weekly — planning & work state

```
yarn pull --auto            # Notion → local data/*.json (tasks, rocks,
#                             plans, retros, goals, projects). MINI ONLY —
#                             racing iCloud from the MacBook corrupts
#                             data/. no prompts

yarn pull:linear            # Linear → Notion (assigned issues → 2026
#                             Tasks, assigned projects → 2026 Projects)
#                             AND → local data/linearTeam.json (design-team
#                             roster issues + my recent comments).
#                             --dry-run previews; --tasks-only is the
#                             issues-only leg behind yarn linear:tasks.
#                             no prompts

yarn push --auto            # local retro/plan edits → Notion. manual +
#                             skill-invoked only, never scheduled.
#                             no prompts

yarn vault-sync             # Notion → Obsidian vault mirrors (personal/).
#                             no prompts
```

## Bundles — session inputs for skills

```
yarn retro:bundle <N>       # week N retro bundle (use --silent; pair with
#                             node scripts/retro-readiness.js <N> <N>)

yarn plan:bundle <N>        # week N planning bundle

node scripts/retro-weeks.js personal
#                             which weeks still need retro work (arg:
#                             personal or work)

node scripts/reconcile-planned-events.js --pull <N>
#                             audit Planned: calendar events for week N
```

## Heavy — the full pipeline

```
yarn sync                   # tokens → collect → update → summarize →
#                             aggregate → pull → vault-sync. the Mac mini
#                             runs this on schedule — manual runs are for
#                             backfills (yarn sync --from=… --to=…)

yarn summarize              # week rollups alone (month: yarn aggregate).
#                             both PROMPT without --auto

yarn tokens:check           # OAuth token health (refresh:
#                             yarn tokens:refresh)
```

## Local data map (data/ = iCloud Brickography)

```
life.json                   # tasks / plans / projects
plan.json                   # weeks / rocks / events
retro.json                  # retros
summaries.json              # week + month rollups
calendar.json               # habit calendars
collected.json              # raw sources
journal.json                # 5MJ
linearTeam.json             # design-team Linear view (roster issues +
#                             my comments, week-numbered)
```
