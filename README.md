# Brickomations

**Personal Data Management System**

Brickomations automatically collects data from external sources (GitHub, Oura, Strava, Steam, Withings), syncs it to Notion, creates calendar events, and generates AI-powered insights about your productivity, health, and habits.

## Documentation

### Quick Navigation

**📁 Root Level** (start here):

- **[QUICKSTART.md](QUICKSTART.md)** - 5-minute overview for first-time readers
- **[README.md](README.md)** (this file) - Installation and setup instructions

**📁 docs/** (detailed documentation):

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture and design principles
- **[docs/GUIDES.md](docs/GUIDES.md)** - Step-by-step guides for extending the system
- **[docs/REFERENCE.md](docs/REFERENCE.md)** - Quick reference for naming conventions and API mappings
- **[docs/INTERNALS.md](docs/INTERNALS.md)** - Deep dive into design patterns and code quality

### Documentation Structure

**Root Level** contains the two entry points:

- **QUICKSTART.md**: Read this first if you want a high-level overview (5 minutes)
- **README.md**: Read this first if you want to install and run the system

**docs/ Directory** contains all detailed documentation:

- Start with **ARCHITECTURE.md** to understand core concepts
- Use **GUIDES.md** when you need to add a feature or extend the system
- Use **REFERENCE.md** for quick lookups (naming conventions, API mappings, env vars)
- Read **INTERNALS.md** for deep understanding of design patterns and best practices

> **New to Brickomations?** Start with [QUICKSTART.md](QUICKSTART.md) for a high-level overview, then return here for installation instructions.

## Installation

### Prerequisites

#### Required

- **Node.js** 18 or higher
- **npm** or **yarn** package manager
- **Notion** account with API access
- **Google** account with Calendar access

#### Optional (for data sources)

- **GitHub** account (for code tracking)
- **Oura Ring** account (for sleep tracking)
- **Strava** account (for fitness tracking)
- **Steam** account (for gaming tracking)
- **Withings** account (for body measurements)

### Initial Setup

#### 1. Install Dependencies

```bash
# Clone the repository
cd brickomations

# Install dependencies
npm install
# or
yarn install
```

#### 2. Create Environment File

```bash
# Copy the example file
cp .env.example .env
```

#### 3. Run Token Setup

```bash
yarn tokens:setup
```

#### 4. Verify Configuration

```bash
yarn tokens
```

## Setup Guide

### Notion Configuration

#### 1. Get Your Notion API Token

1. Go to [Notion Integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Name it "Brickomations" (or any name you prefer)
4. Select your workspace
5. Copy the "Internal Integration Token"
6. Add to `.env`:
   ```bash
   NOTION_TOKEN=secret_xxxxxxxxxxxxx
   ```

#### 2. Create Notion Databases

You need to create the following databases in Notion:

##### GitHub PRs Database

Properties:

- **Repository** (Title)
- **Date** (Date)
- **Commits Count** (Number)
- **Commit Messages** (Text)
- **PR Titles** (Text)
- **PRs Count** (Number)
- **Files Changed** (Number)
- **Files List** (Text)
- **Lines Added** (Number)
- **Lines Deleted** (Number)
- **Total Changes** (Number)
- **Project Type** (Select: Personal, Work)
- **Calendar Created** (Checkbox)
- **Unique ID** (Text)

##### Workouts Database

Properties:

- **Activity Name** (Title)
- **Date** (Date)
- **Activity Type** (Select: Run, Ride, Walk, Hike, Swim, Workout, Yoga, WeightTraining, Other)
- **Start Time** (Text)
- **Duration** (Number)
- **Distance** (Number)
- **Calories** (Number)
- **Heart Rate Avg** (Number)
- **Elevation Gain** (Number)
- **Activity ID** (Text)
- **Calendar Created** (Checkbox)

##### Sleep Database

Properties:

- **Night of** (Title)
- **Night of Date** (Date)
- **Oura Date** (Date)
- **Bedtime** (Text)
- **Wake Time** (Text)
- **Sleep Duration** (Number)
- **Deep Sleep** (Number)
- **REM Sleep** (Number)
- **Light Sleep** (Number)
- **Awake Time** (Number)
- **Heart Rate Avg** (Number)
- **Heart Rate Low** (Number)
- **HRV** (Number)
- **Respiratory Rate** (Number)
- **Efficiency** (Number)
- **Google Calendar** (Select: Normal Wake Up, Sleep In, Naps)
- **Sleep ID** (Text)
- **Calendar Created** (Checkbox)
- **Type** (Text)

##### Body Weight Database

Properties:

- **Measurement** (Title)
- **Date** (Date)
- **Weight** (Number)
- **Weight Unit** (Select: lbs, kg)
- **Time** (Text)
- **Notes** (Text)
- **Calendar Created** (Checkbox)

##### Video Games Database

Properties:

- **Game Name** (Title)
- **Date** (Date)
- **Hours Played** (Number)
- **Minutes Played** (Number)
- **Session Count** (Number)
- **Session Details** (Text)
- **Start Time** (Text)
- **End Time** (Text)
- **Platform** (Select: Steam, PlayStation, Xbox, Nintendo Switch, PC, Other)
- **Activity ID** (Text)
- **Calendar Created** (Checkbox)

##### Tasks Database

Properties:

- **Task** (Title)
- **Due Date** (Date)
- **Type** (Select: Admin, Deep Work, Meeting, Review, Learning, Communication, Other)
- **Status** (Select: Not Started, In Progress, Completed, Blocked, Cancelled)
- **Priority** (Select: Low, Medium, High, Urgent)
- **Project** (Text)
- **Notes** (Text)
- **Completed** (Checkbox)

#### 3. Share Databases with Integration

For each database:

1. Open the database in Notion
2. Click "..." (three dots) in top right
3. Click "Add connections"
4. Select your Brickomations integration
5. Click "Confirm"

#### 4. Get Database IDs

For each database:

1. Open the database in Notion
2. Copy the URL
3. Extract the ID from the URL: `https://notion.so/{workspace}/{DATABASE_ID}?v=...`
4. Add to `.env`:
   ```bash
   NOTION_PERSONAL_PRS_DATABASE_ID=xxxxxxxxxxxxx
   NOTION_WORK_PRS_DATABASE_ID=xxxxxxxxxxxxx
   NOTION_WORKOUTS_DATABASE_ID=xxxxxxxxxxxxx
   NOTION_SLEEP_DATABASE_ID=xxxxxxxxxxxxx
   NOTION_BODY_WEIGHT_DATABASE_ID=xxxxxxxxxxxxx
   NOTION_VIDEO_GAMES_DATABASE_ID=xxxxxxxxxxxxx
   TASKS_DATABASE_ID=xxxxxxxxxxxxx
   ```

### Google Calendar Setup

#### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Name it "Brickomations" or similar

#### 2. Enable Google Calendar API

1. In your project, go to "APIs & Services" > "Library"
2. Search for "Google Calendar API"
3. Click "Enable"

#### 3. Create OAuth Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Select "Desktop app" as application type
4. Name it "Brickomations"
5. Click "Create"
6. Download the JSON file
7. Extract `client_id` and `client_secret`
8. Add to `.env`:
   ```bash
   PERSONAL_GOOGLE_CLIENT_ID=xxxxxxxxxxxxx.apps.googleusercontent.com
   PERSONAL_GOOGLE_CLIENT_SECRET=xxxxxxxxxxxxx
   GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
   ```

#### 4. Run OAuth Setup

```bash
yarn tokens:setup
```

Select "Google Calendar" and follow the prompts to authorize.

#### 5. Create Calendars

Create the following calendars in Google Calendar:

- Personal PRs
- Work PRs
- Fitness
- Sleep In
- Normal Wake Up
- Naps
- Body Weight
- Video Games

Get each calendar ID:

1. Open Google Calendar settings
2. Select the calendar
3. Scroll to "Integrate calendar"
4. Copy the "Calendar ID"
5. Add to `.env`:
   ```bash
   PERSONAL_PRS_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
   WORK_PRS_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
   WORKOUT_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
   SLEEP_IN_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
   NORMAL_WAKE_UP_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
   BODY_WEIGHT_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
   VIDEO_GAMES_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
   PERSONAL_MAIN_CALENDAR_ID=primary
   ```

### External API Setup

All external data sources are **optional**. Only configure the services you want to use.

#### GitHub

**What you'll get**: Daily commit counts, PR titles, code change statistics

**Setup**:

1. Go to [GitHub Settings > Personal Access Tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Select scopes: `repo`, `read:user`
4. Copy the token
5. Add to `.env`:
   ```bash
   GITHUB_TOKEN=ghp_xxxxxxxxxxxxx
   GITHUB_USERNAME=your-username
   ```

#### Oura Ring

**What you'll get**: Sleep duration, bedtime, heart rate metrics, HRV

**Setup**:

1. Go to [Oura Cloud Personal Access Tokens](https://cloud.ouraring.com/personal-access-tokens)
2. Create a new token
3. Copy the token
4. Add to `.env`:
   ```bash
   OURA_TOKEN=xxxxxxxxxxxxx
   ```

#### Strava

**What you'll get**: Activities, distance, duration, heart rate, calories

**Setup**:

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Create a new application
3. Set "Authorization Callback Domain" to `localhost`
4. Copy Client ID and Client Secret
5. Add to `.env`:
   ```bash
   STRAVA_CLIENT_ID=xxxxx
   STRAVA_CLIENT_SECRET=xxxxxxxxxxxxx
   ```
6. Run OAuth setup:
   ```bash
   yarn tokens:setup
   ```
   Select "Strava" and follow prompts

#### Steam

**What you'll get**: Gaming sessions with timestamps, hours played, session details

**Setup**:

Steam integration uses a Lambda endpoint. See [Steam documentation](../steam-tracker-docs.md) for deploying the Lambda function.

Once deployed, add to `.env`:

```bash
STEAM_URL=https://your-lambda-url.lambda-url.region.on.aws
```

#### Withings

**What you'll get**: Body weight measurements with timestamps

**Setup**:

1. Go to [Withings Developer Portal](https://developer.withings.com/)
2. Create a new application
3. Set redirect URI to `http://localhost:3000/callback`
4. Copy Client ID and Client Secret
5. Add to `.env`:
   ```bash
   WITHINGS_CLIENT_ID=xxxxxxxxxxxxx
   WITHINGS_CLIENT_SECRET=xxxxxxxxxxxxx
   ```
6. Run OAuth setup:
   ```bash
   yarn tokens:setup
   ```
   Select "Withings" and follow prompts

**Note**: Withings integration is currently display-only. Data fetching works, but automatic sync to Notion and Calendar workflows are not yet implemented. You can view measurements in the CLI but they won't be saved to Notion.

#### Claude AI

**What you'll get**: AI-powered task categorization, weekly retrospectives, insights

**Setup**:

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Get your API key
3. Add to `.env`:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
   CLAUDE_MODEL=claude-sonnet-4-20250514
   ```

**Pricing**: Very affordable for personal use (~$1-3/month for daily use)

### Environment Variables

Complete `.env` file structure:

```bash
# ============================================
# Core APIs
# ============================================
NOTION_TOKEN=secret_xxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx

# ============================================
# Notion Database IDs
# ============================================
NOTION_PERSONAL_PRS_DATABASE_ID=xxxxxxxxxxxxx
NOTION_WORK_PRS_DATABASE_ID=xxxxxxxxxxxxx
NOTION_WORKOUTS_DATABASE_ID=xxxxxxxxxxxxx
NOTION_SLEEP_DATABASE_ID=xxxxxxxxxxxxx
NOTION_BODY_WEIGHT_DATABASE_ID=xxxxxxxxxxxxx
NOTION_VIDEO_GAMES_DATABASE_ID=xxxxxxxxxxxxx
TASKS_DATABASE_ID=xxxxxxxxxxxxx

# Optional: Week/Month tracking
WEEKS_DATABASE_ID=xxxxxxxxxxxxx
MONTHS_DATABASE_ID=xxxxxxxxxxxxx
NOTION_YEARS_DATABASE_ID=xxxxxxxxxxxxx
PERSONAL_MONTHLY_RECAP_DATABASE_ID=xxxxxxxxxxxxx
WORK_MONTHLY_RECAP_DATABASE_ID=xxxxxxxxxxxxx
ROCKS_DATABASE_ID=xxxxxxxxxxxxx
EVENTS_DATABASE_ID=xxxxxxxxxxxxx

# ============================================
# Google Calendar
# ============================================
PERSONAL_GOOGLE_CLIENT_ID=xxxxxxxxxxxxx.apps.googleusercontent.com
PERSONAL_GOOGLE_CLIENT_SECRET=xxxxxxxxxxxxx
PERSONAL_GOOGLE_REFRESH_TOKEN=xxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob

# Calendar IDs
PERSONAL_PRS_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
WORK_PRS_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
WORKOUT_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
SLEEP_IN_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
NORMAL_WAKE_UP_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
BODY_WEIGHT_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
VIDEO_GAMES_CALENDAR_ID=xxxxxxxxxxxxx@group.calendar.google.com
PERSONAL_MAIN_CALENDAR_ID=primary

# ============================================
# External Data Sources
# ============================================

# GitHub
GITHUB_TOKEN=ghp_xxxxxxxxxxxxx
GITHUB_USERNAME=your-username

# Oura Ring
OURA_TOKEN=xxxxxxxxxxxxx

# Strava
STRAVA_CLIENT_ID=xxxxx
STRAVA_CLIENT_SECRET=xxxxxxxxxxxxx
STRAVA_ACCESS_TOKEN=xxxxxxxxxxxxx
STRAVA_REFRESH_TOKEN=xxxxxxxxxxxxx
STRAVA_TOKEN_EXPIRY=xxxxxxxxxxxxx

# Steam (Lambda endpoint)
STEAM_URL=https://your-lambda-url.lambda-url.region.on.aws

# Withings
WITHINGS_CLIENT_ID=xxxxxxxxxxxxx
WITHINGS_CLIENT_SECRET=xxxxxxxxxxxxx
WITHINGS_ACCESS_TOKEN=xxxxxxxxxxxxx
WITHINGS_REFRESH_TOKEN=xxxxxxxxxxxxx
WITHINGS_TOKEN_EXPIRY=xxxxxxxxxxxxx
WITHINGS_USER_ID=xxxxxxxxxxxxx

# ============================================
# Optional Settings
# ============================================
NODE_ENV=production
DEBUG_API_CALLS=false
TRACK_COSTS=false
CLAUDE_MODEL=claude-sonnet-4-20250514
CLAUDE_MAX_TOKENS=4096
CLAUDE_TEMPERATURE=1.0
APPLE_NOTES_FOLDER=Quick Capture
APPLE_NOTES_PROCESSED_TAG=✅ Processed
APPLE_NOTES_BATCH_SIZE=50
```

### Testing Your Setup

#### 1. Check Token Status

```bash
yarn tokens
```

This will check all token statuses and refresh expired OAuth tokens (except Google Calendar; for Google, run `yarn tokens:setup` manually).

#### 2. Test Data Collection

```bash
yarn collect
```

Select "Yesterday" and one data source to test.

#### 3. Test Calendar Sync

```bash
yarn update
```

Select "Yesterday" and one database to test.

#### 4. Test Weekly Summary

```bash
yarn summarize
```

Generate weekly summaries to test the summary pipeline.

## Usage

### Main Workflows

#### Data Pipeline (automated 9x/day)

```bash
yarn collect        # Fetch data from external APIs → Notion
yarn update         # Sync Notion records → Google Calendar events
yarn summarize      # Generate weekly summaries from calendar data
yarn aggregate      # Aggregate weekly summaries into monthly recaps
yarn push           # Push local JSON edits → Notion (delta-only)
yarn pull           # Pull Notion + Calendar → local JSON (data/*.json)
yarn vault-sync     # Sync data to Brickocampus vault (diff-only)
```

All support `--auto` for non-interactive use (used by launchd automation).

#### Local Data Sync

```bash
yarn push           # Push local JSON edits → Notion (delta-only, hash-based)
```

Edit `data/*.json` locally, then `yarn push` to sync changes back. Only changed records are sent.

#### Summaries & Reports

```bash
yarn summarize      # Generate weekly summaries from calendar data
yarn aggregate      # Aggregate weekly summaries into monthly recaps
yarn generate       # Generate yearly config
```

#### Imports

```bash
yarn journal:import # Import 5 Minute Journal export → data/journal.json
yarn nyc:import     # One-time CSV → Notion import for NYC databases
```

#### Viewers

```bash
yarn view           # Open plan HTML viewer (localhost:8787)
yarn nyc            # Open NYC guide viewer (localhost:8787/nyc/)
```

#### Other

```bash
yarn plan           # Parse yarn plan data
```

### Claude Code Skills

Reflection/planning skills (`/retro-week`, `/plan-*`, `/recap-month`) live in the Brickocampus vault at `~/projects/brickocampus/.claude/skills/`. Launch Claude Code from the vault to use them. They follow the same pull/push cycle: `yarn pull` → skill edits `data/*.json` → `yarn push`.

### Token Management

```bash
yarn tokens        # Check all tokens and refresh expired OAuth (except Google Calendar)
yarn tokens:setup  # Run OAuth setup wizard (use for Google Calendar or re-auth)
yarn tokens:check  # Verify API credentials
yarn tokens:refresh # Refresh expired tokens
```

### Local Data Files

`yarn pull` creates local JSON snapshots that Claude Code can read without API calls:

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

### Automation (launchd)

Brickomations runs automatically 9x daily — every 2 hours, 7 AM–11 PM (7, 9, 11 AM, 1, 3, 5, 7, 9, 11 PM) via launchd. The full automation surface (Cowork morning-brief, evening-processor, watchdog, app-launcher, pmset wakes) lives in `~/projects/brickocampus/_automation/_automation-readme.md`. This section covers `com.brickomations.daily` only:

```
tokens:refresh → collect → update → summarize → aggregate → pull → vault-sync
```

- **Resilience:** 3-min default per-step timeout (pull: 8-min). Bails on token refresh failure.
- **Logs:** `local/logs/daily-YYYY-MM-DD.log` (auto-cleaned after 30 days)
- **Notifications:** macOS banner notification on success/failure
- **View logs:** `yarn logs`

#### Setup

```bash
# Install (substitutes $HOME for the current machine; safe to re-run on either MacBook or Mac mini)
./scripts/install-launchd.sh

# Verify it's loaded
launchctl list | grep brickomations

# Unload if needed
launchctl unload ~/Library/LaunchAgents/com.brickomations.daily.plist
```

If Mac is asleep at scheduled time, launchd runs the missed job when it wakes up.

## Common Workflows

### Daily (Automated)

Automation handles the full pipeline 9x/day. No manual action needed.

### Weekly

```bash
# In Claude Code:
/retro-week                    # Weekly retro (personal, work, or both)
/plan-week                     # Plan next week (personal + work in one session)
```

### Monthly

```bash
yarn aggregate                 # Aggregate weekly summaries into monthly recaps
# In Claude Code:
/recap-month                   # Monthly recap (personal + work in one session)
/plan-month                    # Plan next month (personal + work in one session)
yarn push                      # Sync reflections and plans to Notion
```

## Testing & Validation

### Verify De-duplication

Test that re-running sync operations safely skips existing records:

```bash
# First run - creates records
yarn collect
# Select: Yesterday, Oura

# Second run - should skip all
yarn collect
# Select: Yesterday, Oura
# Expected: "Skipped: 1 (already in Notion)"
```

### Verify Rate Limiting

Test that batch operations respect API limits:

```bash
# Sync multiple days
yarn collect
# Select: Last 7 Days, any source
# Watch for 350ms delays between Notion API calls
# Should complete without rate limit errors
```

## Troubleshooting

### Token Errors

**Problem**: Tokens show as expired or invalid when running `yarn tokens`

**Solution**:

1. Run `yarn tokens` to check and refresh (non-Google OAuth tokens are refreshed automatically).
2. For Google Calendar tokens, run `yarn tokens:setup` manually.
3. If refresh fails for other services, re-authenticate: `yarn tokens:setup` and select the service(s) that failed.

**Common errors**:

- `invalid_grant` or `invalid refresh_token`: Your refresh token expired or was revoked. Run `yarn tokens:setup` to re-authenticate.
- `Token expired`: Usually fixable by running `yarn tokens` (auto-refresh for Strava/Withings).
- Services not showing: Check your `.env` file has the required credentials configured

**Quick reference**:

- Check and refresh tokens: `yarn tokens`
- Google Calendar or re-authenticate: `yarn tokens:setup`

### "Configuration validation failed"

- Check that all required environment variables are set
- Ensure at least one Notion database ID is configured
- Verify Google Calendar credentials are complete

### "Invalid token" errors

- Run `yarn tokens` to check status and refresh expired OAuth tokens
- Re-run `yarn tokens:setup` for Google Calendar or permanently invalid tokens

### "Database not found"

- Verify database IDs in `.env` match your Notion workspace
- Ensure databases are shared with your Notion integration
- Check for typos in environment variable names

### "Rate limit exceeded"

- Wait a few minutes and try again
- Consider reducing batch sizes in config

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Technical architecture, system flow, and design patterns

## Adding New Data Sources

The modular architecture makes adding new integrations straightforward:

1. **Create Database** (`src/databases/`) - Domain-specific data access (~60 lines)
2. **Create Domain Config** (`src/config/notion/`) - Database properties (~50 lines)
3. **Create Service** (`src/services/`) - API client wrapper (if external API)
4. **Create Collector** (`src/collectors/`) - Business logic for fetching data
5. **Create Transformer** (`src/transformers/`) - Data transformation functions
6. **Add Calendar Mapping** (`src/config/calendar/mappings.js`) - Just 5 lines!
7. **Create Workflow** (`src/workflows/`) - Can leverage BaseWorkflow for batch logic
8. **Update CLI Scripts** - Add new source to selection menus

See [docs/GUIDES.md](docs/GUIDES.md) for detailed extension guide and patterns.

## Next Steps

Once setup is complete:

1. Run a test collection: `yarn collect`
2. Sync to calendar: `yarn update`
3. Pull data locally: `yarn pull`
4. Generate weekly insights: `yarn summarize`
5. Set up launchd automation (see [Automation](#automation-launchd) above)

### Example: Adding a New Calendar

Adding a new calendar integration follows a simple 4-step process:

1. **Add environment variable to `.env`**:

   ```bash
   MEDITATION_CALENDAR_ID=xxxxx@group.calendar.google.com
   ```

2. **Add entry to CALENDARS in `src/config/unified-sources.js`**:

   ```javascript
   meditation: {
     id: "meditation",
     envVar: "MEDITATION_CALENDAR_ID",
     name: "Meditation",
     emoji: "🧘",
     dataFields: [
       {
         type: "count",
         label: "Meditation - Days",
         notionProperty: "meditationDays",
       },
       {
         type: "decimal",
         label: "Meditation Hours Total",
         notionProperty: "meditationHoursTotal",
       },
     ],
   },
   ```

3. **Add entry to SUMMARY_GROUPS in `src/config/unified-sources.js`**:

   ```javascript
   meditation: {
     id: "meditation",
     name: "Meditation",
     emoji: "🧘",
     calendars: ["meditation"],
     sourceType: "personal",
   },
   ```

4. **Add Notion columns** to your Personal Summary or Work Summary database (columns are automatically generated from `dataFields` definitions).

That's it! The unified config architecture automatically:

- Generates `DATA_SOURCES` entries
- Creates `PERSONAL_RECAP_SOURCES` / `WORK_RECAP_SOURCES` entries
- Generates Notion property definitions
- Makes the calendar available for reporting

All configuration now lives in `src/config/unified-sources.js` with three registries:

- **CALENDARS** - Atomic time-tracking units with dataFields
- **SUMMARY_GROUPS** - How calendars combine for reporting
- **INTEGRATIONS** - API → Notion routing

## Date Handling

Different data sources use different date formats and conventions:

- **Oura**: Returns wake-up dates, but we store "night of" dates (subtracts 1 day)
- **Strava**: Uses activity start date directly
- **GitHub**: Converts UTC commits to Eastern Time
- **Steam**: Converts UTC gaming sessions to Eastern Time (may adjust date if crossing midnight)
- **Withings**: Converts Unix timestamps to local time (avoids UTC timezone issues)

For details on date handling patterns, see [ARCHITECTURE.md](./ARCHITECTURE.md#date-handling-patterns).

---

**Made with ❤️ by Jon Brick**
