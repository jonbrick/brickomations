# Steam Tracker Documentation

How gaming data gets from Steam → AWS → brickomations → Notion → Google Calendar.

## Architecture Overview

```
Steam API (cumulative playtime only — no session history)
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  AWS                                                     │
│                                                          │
│  EventBridge (every 30 min)                              │
│      └─► Checker Lambda                                  │
│              └─► DynamoDB (raw session deltas + LATEST_) │
│                                                          │
│  EventBridge (5:45 AM ET daily)                          │
│      └─► Summarizer Lambda                               │
│              └─► DynamoDB (DAILY_ period records)        │
│                                                          │
│  API Handler Lambda (Function URL)                       │
│      └─► Reads DAILY_ records, returns JSON              │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Brickomations                                                │
│                                                          │
│  yarn collect  →  SteamService  →  collect-steam.js      │
│                       └─► Notion (Steam Data DB)         │
│                                                          │
│  yarn update   →  buildTransformer  →  Google Calendar   │
└─────────────────────────────────────────────────────────┘
```

## Why 3 Lambda Functions?

Steam's API only provides **cumulative lifetime playtime per game**. There's no session history endpoint. So:

1. **Checker** — Polls every 30 min to detect when playtime increases (the delta = a play session)
2. **Summarizer** — Aggregates raw deltas into daily periods with snapped 30-min block boundaries
3. **API Handler** — Serves the period records to brickomations via HTTP

## Lambda Functions

### 1. Checker (`steam-playtime-30min`)

**Trigger:** EventBridge rate schedule — every 30 minutes

**What it does:**

1. Calls Steam's `GetOwnedGames` API to get current lifetime playtime for all games
2. For each game with playtime > 0, reads the `LATEST_{gameId}` record from DynamoDB
3. If playtime increased since last check, computes the delta (`session_minutes`) and writes a raw session record
4. Always updates the `LATEST_` pointer with current playtime

**Timezone handling:**

The Checker writes both Eastern and UTC dates on every raw session record:

- `date`: Eastern date derived from the check timestamp using `getEasternDate()` — this is the human-readable "what day was I playing" date
- `date_utc`: UTC date extracted from the check timestamp — used by the Summarizer to find records

This dual-date approach ensures the Summarizer can find records by UTC date (matching its invocation pattern) while the Eastern date is available for debugging.

**DynamoDB writes:**

Raw session record:

```json
{
  "record_id": "{ISO_timestamp}_{gameId}",
  "game_id": "1142710",
  "game_name": "Total War: WARHAMMER III",
  "timestamp": "2026-02-17T02:54:48.000Z",
  "date": "2026-02-16",
  "date_utc": "2026-02-17",
  "total_minutes": 5494,
  "session_minutes": 30
}
```

Note: For evening Eastern sessions, `date` and `date_utc` will differ. Playing at 9 PM ET on Feb 16 produces a check at ~2:54 AM UTC on Feb 17, so `date` = `2026-02-16` (Eastern) and `date_utc` = `2026-02-17` (UTC). Due to Lambda execution delay, checks land at roughly `:24` and `:54` past each half hour, not exactly on `:00`/`:30`.

Latest pointer (always updated):

```json
{
  "record_id": "LATEST_{gameId}",
  "game_id": "1142710",
  "game_name": "Total War: WARHAMMER III",
  "timestamp": "2026-02-17T02:54:48.000Z",
  "total_minutes": 5494
}
```

**Source:** `infra/lambda/functions/steam-playtime-tracker/index.mjs`

### 2. Summarizer (`steam-daily-summary-midnight`)

**Trigger:** EventBridge cron `45 10 * * ? *` — 5:45 AM Eastern daily (10:45 AM UTC)

**What it does:**

1. When no explicit date is provided, processes **two** UTC dates: yesterday and today
   - Yesterday UTC catches early-to-mid evening ET sessions
   - Today UTC catches late-night ET sessions that cross the UTC date boundary (e.g., playing at 9:30 PM ET = next day UTC)
2. For each date: scans DynamoDB for all raw session records matching that UTC date (filters by `date_utc` field)
3. Groups sessions by game
4. Sorts each game's sessions by timestamp
5. Snaps each check timestamp to a 30-min block boundary
6. Detects play periods: consecutive blocks within 90 minutes = same period, gap > 90 min = new period
7. Writes one `DAILY_` record per period (uses PutCommand, so re-runs are idempotent)

When invoked with an explicit `{"date": "YYYY-MM-DD"}` event, processes only that single date (useful for backfills).

**Why two dates:** Late-night ET sessions (e.g., 9:30 PM - 2:34 AM ET) produce Checker records with today's UTC date, not yesterday's. Processing only yesterday UTC would miss these sessions until the following night's run — a 24-36 hour delay. By processing both dates, overnight sessions are picked up the same morning.

**Why 5:45 AM ET:** The schedule runs after all overnight Checker records exist (last possible check ~5:24 AM UTC for a session ending before 1 AM ET) and 1h20m before the first morning `yarn sync` at 7:05 AM ET. The previous 12:01 AM ET schedule was too early to catch late-night sessions on today's UTC date.

**Why it scans on `date_utc`:** The Checker writes `date_utc` as the UTC date of when the check ran. The Summarizer finds all records from a given UTC day regardless of which Eastern day they fall on. The per-period Eastern date derivation then correctly assigns the human-readable date.

**30-min block snapping:**

The Checker detects playtime but doesn't know exactly when you started. A check at 9:54 PM means "you were playing sometime in the preceding ~30 min window." The Summarizer snaps each check to a clean 30-min block:

```
Check ran at 9:54 PM  → rounds up to 10:00 PM → block: 9:30 - 10:00 PM
Check ran at 10:24 PM → rounds up to 10:30 PM → block: 10:00 - 10:30 PM
Check ran at 10:54 PM → rounds up to 11:00 PM → block: 10:30 - 11:00 PM
```

Rule: Round check timestamp **up** to the nearest `:00` or `:30` = block end. Block start = block end - 30 min.

**Period detection:**

Consecutive blocks (gap ≤ 90 min between block end and next block start) merge into one period. Gap > 90 min starts a new period.

```
9:30-10:00 PM   ─┐
10:00-10:30 PM   ├─ Period 1 (consecutive)
10:30-11:00 PM  ─┘

                  ← 90+ min gap

12:30-1:00 AM   ─── Period 2
```

Period start = first block's start. Period end = last block's end. Duration = block count × 30 min.

**Timezone handling:**

The Summarizer stores both UTC and Eastern for every timestamp:

- `date`: Eastern date derived per-period from the period's start time (what brickomations queries on)
- `date_utc`: The UTC date the Summarizer was invoked with (the Checker's `date_utc`)
- `start_time` / `end_time`: Eastern ISO with offset (e.g., `2026-01-21T21:30:00-05:00`)
- `start_time_utc` / `end_time_utc`: Raw UTC ISO (e.g., `2026-01-22T02:30:00.000Z`)

The Eastern date is derived **per-period**, not globally. This handles the case where a single UTC date run produces periods spanning different Eastern dates (e.g., Saturday night session + Sunday daytime session both have Checker records with UTC date Jan 25, but get Eastern dates Jan 24 and Jan 25 respectively).

**DynamoDB writes:**

```json
{
  "record_id": "DAILY_2026-01-22_1142710_PERIOD_1",
  "date": "2026-01-21",
  "date_utc": "2026-01-22",
  "game_id": "1142710",
  "game_name": "Total War: WARHAMMER III",
  "start_time": "2026-01-21T21:30:00-05:00",
  "start_time_utc": "2026-01-22T02:30:00.000Z",
  "end_time": "2026-01-22T00:00:00-05:00",
  "end_time_utc": "2026-01-22T05:00:00.000Z",
  "duration_minutes": 90
}
```

Note: `record_id` uses the **UTC date** (the Summarizer's input date). The `date` field uses the **Eastern date** (derived from the period's start time). These may differ for late-night sessions.

**dryRun support:** Pass `{ "dryRun": true }` in the Lambda event to log what would be written without touching DynamoDB.

**Source:** `infra/lambda/functions/steam-daily-summary/index.mjs`

### 3. API Handler (`steam-data-api`)

**Trigger:** Lambda Function URL (HTTP GET)

**Endpoint:** Set via `STEAM_URL` in brickomations's `.env`

**Query parameters:**

- `?date=YYYY-MM-DD` — Single day (Eastern date)
- `?start=YYYY-MM-DD&end=YYYY-MM-DD` — Date range (Eastern dates)
- `?period=week|month` — Relative range

**How it queries:**

- `getDailyData(date)`: Filters on `date` field (Eastern) AND `begins_with(record_id, "DAILY_")`. This finds all period records for a given Eastern date regardless of which UTC Summarizer run produced them.
- `getDateRangeData(start, end)`: Filters on `date BETWEEN start AND end` AND `begins_with(record_id, "DAILY_")`.

**Response shape (single day):**

```json
{
  "date": "2026-01-21",
  "total_hours": 1.5,
  "total_minutes": 90,
  "period_count": 1,
  "periods": [
    {
      "name": "Total War: WARHAMMER III",
      "game_id": "1142710",
      "date": "2026-01-21",
      "date_utc": "2026-01-22",
      "start_time": "2026-01-21T21:30:00-05:00",
      "start_time_utc": "2026-01-22T02:30:00.000Z",
      "end_time": "2026-01-22T00:00:00-05:00",
      "end_time_utc": "2026-01-22T05:00:00.000Z",
      "duration_minutes": 90
    }
  ]
}
```

**Source:** `infra/lambda/functions/steam-data-api/index.mjs`

## DynamoDB Schema

**Table:** `steam-playtime`

**Partition key:** `record_id` (String)

| Record type    | Key pattern                           | `date` field         | `date_utc` field | Purpose                            |
| -------------- | ------------------------------------- | -------------------- | ---------------- | ---------------------------------- |
| Latest pointer | `LATEST_{gameId}`                     | —                    | —                | Current lifetime playtime per game |
| Raw session    | `{ISO_timestamp}_{gameId}`            | Eastern date         | UTC date         | Individual 30-min check deltas     |
| Period summary | `DAILY_{utcDate}_{gameId}_PERIOD_{n}` | Eastern (per-period) | UTC date         | One record per play period         |

**Key convention:** Both Checker and Summarizer records use `date` for Eastern and `date_utc` for UTC. The `date` field is what brickomations and the API Handler query on. The `date_utc` field is what the Summarizer uses to find Checker records.

## Brickomations Integration

### `yarn collect` (collect-steam.js)

1. `SteamService` calls the API Handler day-by-day for the requested date range
2. For each period, the collector:
   - Uses Eastern timestamps directly from the API (no conversion or offset needed)
   - Generates `activityId` as `{gameName}-{date}-P{n}` (sanitized, with period index)
   - Parses display times from the Eastern ISO string (e.g., `2026-01-21T21:30:00-05:00` → `9:30 PM`)
   - Uses `parseDate(period.date)` for the Notion date (already Eastern)
3. Syncs activities to Notion's Steam Data DB

### `yarn update` (calendar sync)

- `buildTransformer` for Steam reads `Start Time` and `End Time` from Notion (Eastern ISO strings)
- `buildDateTime()` sees the `T` in the ISO string and passes it through directly to Google Calendar
- No additional time manipulation at this layer
- Calendar mapping: all Steam records → `VIDEO_GAMES_CALENDAR_ID`
- Event type: `dateTime` (not all-day)

## Notion Database

**DB:** 🎮 Steam Data (`NOTION_VIDEO_GAMES_DATABASE_ID`)

| Property             | Type     | Source                                                      |
| -------------------- | -------- | ----------------------------------------------------------- |
| Game Name            | title    | `period.name`                                               |
| Date                 | date     | Eastern date from API (`period.date`)                       |
| Start Time           | text     | Eastern ISO with offset (e.g., `2026-01-21T21:30:00-05:00`) |
| End Time             | text     | Eastern ISO with offset                                     |
| Start Time (Display) | text     | Human-readable (e.g., `9:30 PM`)                            |
| End Time (Display)   | text     | Human-readable (e.g., `12:00 AM`)                           |
| Start Time UTC       | text     | Raw UTC ISO (e.g., `2026-01-22T02:30:00.000Z`)              |
| End Time UTC         | text     | Raw UTC ISO                                                 |
| Minutes Played       | number   | `period.duration_minutes` (block count × 30)                |
| Activity ID          | text     | `{gameName}-{date}-P{n}` sanitized                          |
| Calendar Created     | checkbox | Set by `yarn update`                                        |

## Timezone Philosophy

UTC is the source of truth throughout the AWS pipeline. Eastern conversion happens in both the Checker (using `getEasternDate()`) and the Summarizer (using `toEasternISO()` and `getEasternDate()`), which handle EST/EDT automatically.

Both UTC and Eastern values are stored at every layer (DynamoDB, API response, Notion) so that:

- **Eastern values** are human-readable for debugging in DynamoDB and Notion
- **UTC values** provide the raw source of truth with `_utc` suffix

The `date` field always means **Eastern date** across all record types (Checker, Summarizer, API). The `date_utc` field always means **UTC date**. This convention is consistent across the entire pipeline.

`collect-steam.js` uses the Eastern timestamps directly from the API — no timezone conversion or offset adjustment needed. The `formatDisplay()` function parses hours/minutes from the ISO string itself (not `getHours()`) to avoid local timezone dependency.

## Known Limitations

### Playtime is attributed to detection-time, not play-time

**Symptom:** An isolated gaming session can appear at a time you weren't playing —
e.g. a single midday session on a day you were away from the machine — while every
real session clusters in your usual window (evenings). First observed 2026-07-17: a
lone 90-min midday Darktide period inside an otherwise evening-only week.

**Root cause:** Steam's API (`GetOwnedGames`) exposes only _cumulative_ lifetime
playtime (`playtime_forever`) — there is no session history. The Checker
(`steam-playtime-tracker/index.mjs`) polls every 30 min and treats _any_ increase in
that counter as "actively playing in the preceding 30-min window," stamping the record
at poll-time (`new Date()`), not at actual play-time. The Summarizer's 30-min block
snapping is downstream and cosmetic — it cannot create or move a period, only round
its edges. So a phantom period always traces back to real Checker records, not to
snapping.

**The counter can rise without real-time active play:**

- Game left running / idle — Steam counts idle-with-the-game-open as playtime.
- Deferred flush / backfill — Steam commits playtime to the profile late (on client
  sync or game close), so old play surfaces at a later poll.
- Play on another device sharing the account.

**Reading the signature:** N consecutive 30-min blocks means the counter rose ~30 min
at each of N consecutive polls → the process was running across that window (active or
idle). A single one-off block is more consistent with a one-time deferred flush.

**Why it isn't cheaply fixed:** No session data exists to fix it with. A presence check
via `ISteamUser/GetPlayerSummaries` (`gameid` / `gameextrainfo` = currently in-game)
would catch the deferred-flush and other-device cases, but _not_ left-running/idle —
Steam reports an idle open game as in-game, indistinguishable from real play. It would
also require a Lambda change + redeploy.

**Remediating a confirmed phantom:** Delete the Notion record (🎮 Steam Data DB) and
the Video Games calendar event. The source of truth is the `DAILY_` period record in
the DynamoDB `steam-playtime` table — a manual backfill over that date recreates the
Notion/calendar entries from it unless that record is deleted too (AWS console).
