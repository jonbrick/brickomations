# Brickomations Quickstart

**5-minute overview for first-time readers**

## What is Brickomations?

Personal data pipeline that automatically collects data from external sources (GitHub, Oura, Strava, Steam, Withings), stores it in Notion, creates Google Calendar events, and generates AI-powered insights about your productivity, health, and habits.

**In simple terms:** API data → Notion → Calendar → Weekly insights → Local JSON

## How It Works

### User-Facing Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                   AUTOMATED (9x/day via launchd)                 │
│            7, 9, 11am · 1, 3, 5, 7, 9, 11pm (every 2hr)         │
│                                                                 │
│   tokens:refresh → collect → update → summarize →               │
│   aggregate → push → pull → vault-sync                          │
│                                                                 │
│   Full pipeline: refresh tokens, fetch API data → Notion,       │
│   sync to Calendar, summarize, push/pull local JSON,            │
│   sync to Brickocampus vault                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL DATA (data/*.json)                      │
│                                                                 │
│   plan.json · collected.json · summaries.json · calendar.json   │
│   nyc.json · retro.json · life.json · journal.json              │
│                                                                 │
│   Claude Code reads these directly — no API calls needed        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    MANUAL (run as needed)                        │
│                                                                 │
│   Reflection/planning skills live in the Brickocampus vault —   │
│   launch Claude Code from there to use /retro-week, /plan-*.    │
└─────────────────────────────────────────────────────────────────┘
```

### Weekly Cadence

1. **Sunday/Monday AM** — Write rocks for the week (`/plan-week`)
2. **During the week** — Work tasks, events, live life
3. **Automation runs 9x/day** — full pipeline (tokens:refresh → collect → update → summarize → aggregate → push → pull → vault-sync)
4. **End of week** — Run retro (`/retro-week`)
5. **Monthly** — `/recap-month`

### The Pull/Push Cycle

All Notion data is pulled to local `data/*.json` files so Claude Code can read and analyze without API calls:

```bash
yarn pull              # Pull Notion + Calendar → local JSON (runs in automation)
# ... read/edit data/*.json locally (or use Claude Code skills) ...
yarn push              # Push local edits → Notion (delta-only, hash-based)
```

## Commands

### Data Pipeline (automated 9x/day)

```bash
yarn collect           # Fetch data from external APIs → Notion
yarn update            # Sync Notion records → Google Calendar events
yarn summarize         # Generate weekly summaries from calendar data
yarn aggregate         # Aggregate weekly summaries into monthly recaps
yarn push              # Push local JSON edits → Notion (delta-only)
yarn pull              # Pull Notion + Calendar → local JSON
yarn vault-sync        # Sync data to Brickocampus vault (diff-only)
```

### Summaries & Reports

```bash
yarn summarize         # Generate weekly summaries from calendar data
yarn aggregate         # Aggregate weekly summaries into monthly recaps
yarn generate          # Generate yearly config
```

### Local Data Sync

```bash
yarn push              # Push local JSON edits → Notion (delta-only)
```

### Viewers

```bash
yarn view              # Open plan HTML viewer (localhost:8787)
yarn nyc               # Open NYC guide viewer (localhost:8787/nyc/)
```

### Imports

```bash
yarn journal:import    # Import 5 Minute Journal export → data/journal.json
yarn nyc:import        # One-time CSV → Notion import for NYC databases
```

### Claude Code Skills

Reflection/planning skills (`/retro-week`, `/plan-*`, `/recap-month`) live in the Brickocampus vault at `~/projects/brickocampus/.claude/skills/`. Launch Claude Code from the vault to use them. They follow the same pull/push cycle: `yarn pull` → skill edits `data/*.json` → `yarn push`.

### Utilities

```bash
yarn plan              # Parse yarn plan data
yarn logs              # View today's automation log
yarn tokens            # Check all token status, refresh expired OAuth
yarn tokens:setup      # Run OAuth setup wizard
yarn tokens:check      # Verify API credentials
yarn tokens:refresh    # Refresh expired tokens
yarn verify:config     # Verify config derivation consistency
```

## Architecture Overview

### Three-Layer Data Flow

| Layer | Flow | Naming | Example |
|-------|------|--------|---------|
| **Layer 1** | API → Notion | Integration names (`oura`, `strava`) | Oura API → Notion Sleep DB |
| **Layer 2** | Notion → Calendar | Domain names (`sleep`, `workouts`) | Notion → Google Calendar |
| **Layer 3** | Calendar → Summary | Summary groups (`personalRecap`) | Calendar → Weekly Summary |

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Layer                              │
│  (User interaction, prompts, display results)               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Workflow Layer                            │
│  (Orchestration, batch processing, error handling)          │
└─────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────────────────┐                 ┌────────────────────┐
│  Collector Layer  │                 │ Database Layer     │
│  (Fetch from APIs)│                 │ (Notion access)    │
└───────────────────┘                 └────────────────────┘
        │                                       │
        └───────────────────┬───────────────────┘
                            ↓
                   ┌────────────────────┐
                   │ Transformer Layer  │
                   │ (Format conversion)│
                   └────────────────────┘
                            ↓
                   ┌────────────────────┐
                   │  Service Layer     │
                   │  (API clients)     │
                   └────────────────────┘
                            ↓
                   ┌────────────────────┐
                   │  External APIs     │
                   │  (Oura, Strava,    │
                   │   GitHub, etc.)    │
                   └────────────────────┘
```

### Config-Driven Everything

Three registries in `src/config/unified-sources.js` drive the entire system:

1. **CALENDARS**: Atomic time-tracking units (each = one Google Calendar)
2. **SUMMARY_GROUPS**: How calendars combine for reporting
3. **INTEGRATIONS**: API → Notion routing and metadata

Most features can be added by editing this config file alone.

### Local Data Files

`yarn pull` creates local JSON snapshots:

| File | Contents | Scope |
|------|----------|-------|
| `data/plan.json` | Weeks, Months, Rocks, Events, Trips | All |
| `data/collected.json` | Oura, Strava, GitHub, Steam, Withings | All (30-day rolling refresh) |
| `data/summaries.json` | Weekly summaries, Monthly recaps | All |
| `data/calendar.json` | All Google Calendar events | All (30-day rolling refresh) |
| `data/nyc.json` | Museums, Restaurants, Tattoos, Venues | All |
| `data/retro.json` | Personal & Work Week Retros | All |
| `data/life.json` | Goals, Themes, Relationships, Tasks, Habits, Monthly Plans, Personal Projects | All |
| `data/journal.json` | 5 Minute Journal entries | 2026 |

## Documentation Structure

**You are here:** QUICKSTART.md (5-minute overview)

**Where to go next:**

- **Need to install?** → [README.md](README.md) - Full setup guide
- **Want to understand the architecture?** → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Core concepts and design
- **Need to add a feature?** → [docs/GUIDES.md](docs/GUIDES.md) - Step-by-step how-to guides
- **Looking up conventions?** → [docs/REFERENCE.md](docs/REFERENCE.md) - Naming, APIs, env vars
- **Understanding patterns?** → [docs/INTERNALS.md](docs/INTERNALS.md) - Design patterns and best practices

## Quick Examples

### Understanding a Data Flow

- **Oura sleep**: API → collect-oura.js → oura-to-notion-oura.js → IntegrationDatabase("oura") → Notion → notion-oura-to-calendar-sleep.js → Google Calendar → calendar-to-notion-summaries.js → Personal Summary

### Adding a New Calendar

Just 4 steps in `unified-sources.js`:

1. Add to CALENDARS registry (~15 lines)
2. Add to SUMMARY_GROUPS registry (~5 lines)
3. Add Notion columns (auto-generated from config)
4. Done! Automatically available everywhere.

---

**Ready to dive deeper?** Start with [README.md](README.md) for setup, or [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design.
