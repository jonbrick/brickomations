#!/usr/bin/env bash
# heartbeat-watchdog.sh — read heartbeat pings, alert via iMessage on miss/fail.
# Run by launchd every 5 min. Silent on success.
#
# Detects two failure modes:
#   1. Missing/stale ping — job never wrote a ping past its expected time
#      (with grace window). Alert key = missed-<expected-epoch>.
#   2. status=failed — job ran but reported failure. Alert key = failed-<ping-ts>.
#
# Throttling: each alert key fires once. Re-alert only if the key changes
# (next missed cycle, or new failure timestamp).
#
# Schedule (keep in sync with _automation/_automation-readme.md Schedule table):
#   brickomations-daily-brief        — 5:50 AM
#   pull-linear                 — 6:30 AM
#   yarn-sync                   — every 2 hr, 7 AM–11 PM (7, 9, 11 AM, 1, 3, 5, 7, 9, 11 PM)
#   cowork-morning-brief        — 6 AM
#   cowork-evening-processor    — 9:20 PM (after the 9:15 PM evening render)
#   granola-sync                — every 30 min while Obsidian is open (pull-based;
#                                 reads the plugin's own state — see check_granola_sync)
#
# WATCHDOG_DRY_RUN=1 prints would-be alerts to stdout instead of iMessaging,
# ignores and doesn't write throttle markers. For testing a check by hand.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HEARTBEAT_DIR="$REPO_ROOT/local/heartbeat"
TODAY=$(date +%Y-%m-%d)
NOW_EPOCH=$(date +%s)

# Pull just ALERT_IMESSAGE_TARGET from .env (gitignored). Avoid sourcing the
# whole file — brickomations's .env contains lines that don't parse as bash.
if [ -f "$REPO_ROOT/.env" ]; then
  ALERT_IMESSAGE_TARGET=$(grep -E "^ALERT_IMESSAGE_TARGET=" "$REPO_ROOT/.env" \
    | head -1 | cut -d= -f2-)
fi

if [ -z "${ALERT_IMESSAGE_TARGET:-}" ] && [ "${WATCHDOG_DRY_RUN:-}" != "1" ]; then
  echo "ALERT_IMESSAGE_TARGET not set in .env; watchdog exiting silently." >&2
  exit 0
fi

mkdir -p "$HEARTBEAT_DIR"

# Bootstrap marker — record the moment the watchdog first ran. We don't alert
# for expected times that occurred before this moment (we couldn't have known
# whether those scheduled jobs ran or not). Lets us deploy cleanly without
# a flurry of false "no ping" alerts for today's earlier expected times.
INSTALL_MARKER="$HEARTBEAT_DIR/.watchdog-installed-at"
if [ ! -f "$INSTALL_MARKER" ]; then
  date +%s > "$INSTALL_MARKER"
fi
INSTALL_EPOCH=$(cat "$INSTALL_MARKER")

send_imessage() {
  local msg="$1"
  if [ "${WATCHDOG_DRY_RUN:-}" = "1" ]; then
    echo "DRY RUN — would send: $msg"
    return
  fi
  local escaped="${msg//\"/\\\"}"
  local script
  script=$(mktemp -t brickomations-watchdog)
  cat > "$script" <<APPLESCRIPT
tell application "Messages"
    set theService to 1st service whose service type = iMessage
    set theBuddy to buddy "$ALERT_IMESSAGE_TARGET" of theService
    send "$escaped" to theBuddy
end tell
APPLESCRIPT
  if ! osascript "$script" >/dev/null 2>&1; then
    echo "Failed to send iMessage: $msg" >&2
  fi
  rm -f "$script"
}

# Throttled alert. Re-fires only if the alert key changes.
alert() {
  local job="$1"
  local detail="$2"
  local key="$3"
  local marker="$HEARTBEAT_DIR/.${job}.last-alert"

  if [ "${WATCHDOG_DRY_RUN:-}" = "1" ]; then
    send_imessage "[brickomations $(date +%Y-%m-%d)] ${job}: ${detail}  (key=${key})"
    return
  fi

  if [ -f "$marker" ] && [ "$(cat "$marker")" = "$key" ]; then
    return
  fi

  send_imessage "[brickomations $(date +%Y-%m-%d)] ${job}: ${detail}"
  echo "$key" > "$marker"
}

# Most recent expected time today that's already past (now - grace).
# Output: epoch seconds, or empty if none.
most_recent_expected_passed() {
  local schedule_times="$1"
  local grace_sec="$2"
  local cutoff=$((NOW_EPOCH - grace_sec))
  local most_recent=0
  for time in $schedule_times; do
    local ts
    ts=$(date -j -f "%Y-%m-%d %H:%M:%S" "$TODAY $time:00" +%s 2>/dev/null || echo 0)
    if [ "$ts" -gt 0 ] && [ "$ts" -le "$cutoff" ]; then
      if [ "$ts" -gt "$most_recent" ]; then
        most_recent=$ts
      fi
    fi
  done
  if [ "$most_recent" -gt 0 ]; then
    echo "$most_recent"
  fi
}

check_job() {
  local job="$1"
  local schedule="$2"
  local grace_sec="$3"

  local most_recent
  most_recent=$(most_recent_expected_passed "$schedule" "$grace_sec")
  if [ -z "$most_recent" ]; then
    return  # nothing expected today (with grace) yet — too early to check
  fi

  # Skip expected times that occurred before watchdog was installed.
  if [ "$most_recent" -lt "$INSTALL_EPOCH" ]; then
    return
  fi

  local ping_file="$HEARTBEAT_DIR/${job}.json"

  if [ ! -f "$ping_file" ]; then
    local key="missed-${most_recent}"
    alert "$job" "no ping (expected by $(date -r "$most_recent" +%H:%M:%S))" "$key"
    return
  fi

  # Parse timestamp. Pings are flat single-line JSON written by heartbeat-ping.sh.
  local ping_ts_iso
  ping_ts_iso=$(sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p' "$ping_file")
  if [ -z "$ping_ts_iso" ]; then
    local key="malformed-$(stat -f '%m' "$ping_file")"
    alert "$job" "ping malformed (no timestamp)" "$key"
    return
  fi

  # BSD date's %z accepts only ±HHMM. ISO 8601 also allows Z (UTC) and ±HH:MM
  # (with colon). Normalize before parse so any legal form succeeds — otherwise
  # parse fails, ping_epoch=0, and we false-alert "stale ping (last 19:00:00)"
  # (epoch 0 in EDT). Canonical producer format is ±HHMM (heartbeat-ping.sh).
  local ping_ts_normalized
  ping_ts_normalized=$(printf '%s' "$ping_ts_iso" \
    | sed -E 's/Z$/+0000/; s/([+-][0-9]{2}):([0-9]{2})$/\1\2/')

  local ping_epoch
  ping_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S%z" "$ping_ts_normalized" +%s 2>/dev/null || echo 0)
  if [ "$ping_epoch" -lt "$most_recent" ]; then
    local key="missed-${most_recent}"
    alert "$job" \
      "stale ping (last $(date -r "$ping_epoch" +%H:%M:%S), expected after $(date -r "$most_recent" +%H:%M:%S))" \
      "$key"
    return
  fi

  # Check status
  local status
  status=$(sed -n 's/.*"status":"\([^"]*\)".*/\1/p' "$ping_file")
  if [ "$status" = "failed" ]; then
    local message
    message=$(sed -n 's/.*"message":"\([^"]*\)".*/\1/p' "$ping_file")
    local key="failed-${ping_ts_iso}"
    if [ -n "$message" ]; then
      alert "$job" "status=failed: $message" "$key"
    else
      alert "$job" "status=failed" "$key"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Granola Sync (Obsidian plugin) — the one pull-based check.
#
# The plugin can't write a ping file, so the watchdog reads the plugin's own
# state inside the vault. Three signals, coarse → fine:
#
#   1. Liveness — with the plugin's "Enable debug logging" on, every sync
#      cycle (30 min) appends a "Sync started" line to
#      <plugin>/logs/<session>.log whether or not anything synced. Newest log
#      untouched for GRANOLA_LIVENESS_SEC inside the awake window means the
#      timer is dead: Obsidian closed, plugin disabled, or logging off.
#   2. Health — the last "Sync started" block must contain a "Listed N note"
#      line (API key accepted, listing succeeded). Missing = the cycle failed
#      (no API key, 401, network). Skipped while the block is <3 min old.
#   3. Progress — data.json latestSyncTime only advances when a note is
#      written, so it's a backstop: older than GRANOLA_PROGRESS_SEC means
#      nothing has landed for days even though cycles run.
#
# Alert keys include today's date → one text per condition per day while
# the condition holds. Lesson learned 2026-10-16: the plugin stalled silently
# for 36 days (Granola encrypted its local credentials on 2026-09-10; the old
# plugin only surfaced an in-app Notice nobody saw on a headless mini).
# ---------------------------------------------------------------------------
VAULT_DIR="${BRICKOCAMPUS_DIR:-$HOME/projects/brickocampus}"
GRANOLA_PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/granola-sync"
GRANOLA_WINDOW_START="07:00"   # local time — the mini wakes 05:45; first cycle lands by ~06:30
GRANOLA_WINDOW_END="23:00"     # caffeinate releases 23:30
GRANOLA_LIVENESS_SEC=7200      # 4 missed 30-min cycles
GRANOLA_PROGRESS_SEC=$((4 * 86400))

check_granola_sync() {
  local job="granola-sync"
  local now_hm
  now_hm=$(date +%H:%M)
  if [[ "$now_hm" < "$GRANOLA_WINDOW_START" || "$now_hm" > "$GRANOLA_WINDOW_END" ]]; then
    return
  fi

  local data_json="$GRANOLA_PLUGIN_DIR/data.json"
  if [ ! -f "$data_json" ]; then
    alert "$job" "plugin data.json missing ($data_json)" "missing-${TODAY}"
    return
  fi

  local obsidian_state="Obsidian running"
  pgrep -xq Obsidian || obsidian_state="Obsidian NOT running"

  # 1. Liveness.
  local log_file
  log_file=$(ls -t "$GRANOLA_PLUGIN_DIR"/logs/*.log 2>/dev/null | head -1)
  if [ -z "$log_file" ]; then
    alert "$job" "no debug log under .obsidian/plugins/granola-sync/logs — plugin not loaded or debug logging off; $obsidian_state" "nolog-${TODAY}"
    return
  fi
  local log_epoch
  log_epoch=$(stat -f '%m' "$log_file")
  if [ $((NOW_EPOCH - log_epoch)) -gt "$GRANOLA_LIVENESS_SEC" ]; then
    alert "$job" "no sync cycle since $(date -r "$log_epoch" '+%a %H:%M'); $obsidian_state" "dead-${TODAY}"
    return
  fi

  # 2. Health — last cycle must have listed notes.
  local last_block
  last_block=$(awk '/Sync started/ { buf = "" } { buf = buf $0 "\n" } END { printf "%s", buf }' "$log_file")
  if [ -n "$last_block" ] && ! printf '%s' "$last_block" | grep -q "Listed "; then
    # Log lines start with an ISO-8601 UTC stamp: 2026-10-16T11:30:00.123Z
    local started_iso started_epoch
    started_iso=$(printf '%s' "$last_block" | head -1 | cut -d. -f1)
    started_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$started_iso" +%s 2>/dev/null || echo 0)
    if [ "$started_epoch" -gt 0 ] && [ $((NOW_EPOCH - started_epoch)) -gt 180 ]; then
      local err
      err=$(printf '%s' "$last_block" | grep '\[ERROR\]' | tail -1 | cut -c1-160)
      alert "$job" "last cycle $(date -r "$started_epoch" '+%H:%M') did not list notes — API key missing/rejected or network${err:+; $err}" "fail-${TODAY}"
      return
    fi
  fi

  # 3. Progress backstop.
  local last_ms
  last_ms=$(sed -n 's/^[[:space:]]*"latestSyncTime":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$data_json" | head -1)
  if [ -n "$last_ms" ] && [ "$last_ms" -gt 0 ]; then
    local last_s=$((last_ms / 1000))
    if [ $((NOW_EPOCH - last_s)) -gt "$GRANOLA_PROGRESS_SEC" ]; then
      alert "$job" "cycles run but no note written since $(date -r "$last_s" '+%Y-%m-%d %H:%M') — check API key scope / Granola" "stale-${last_ms}-${TODAY}"
    fi
  fi
}

check_job "brickomations-daily-brief" "05:50" 600

check_job "pull-linear" "06:30" 900

check_job "yarn-sync" \
  "07:00 09:00 11:00 13:00 15:00 17:00 19:00 21:00 23:00" \
  900

check_job "cowork-morning-brief" "06:00" 1800

check_job "cowork-evening-processor" "21:20" 1800

check_granola_sync

exit 0
