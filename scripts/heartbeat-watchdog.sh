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
#   brickbot-daily-brief        — 5:50 AM
#   pull-linear                 — 6:30 AM
#   yarn-sync                   — every 2 hr, 7 AM–11 PM (7, 9, 11 AM, 1, 3, 5, 7, 9, 11 PM)
#   cowork-morning-brief        — 6 AM
#   cowork-evening-processor    — 9 PM
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HEARTBEAT_DIR="$REPO_ROOT/local/heartbeat"
TODAY=$(date +%Y-%m-%d)
NOW_EPOCH=$(date +%s)

# Pull just ALERT_IMESSAGE_TARGET from .env (gitignored). Avoid sourcing the
# whole file — brickbot's .env contains lines that don't parse as bash.
if [ -f "$REPO_ROOT/.env" ]; then
  ALERT_IMESSAGE_TARGET=$(grep -E "^ALERT_IMESSAGE_TARGET=" "$REPO_ROOT/.env" \
    | head -1 | cut -d= -f2-)
fi

if [ -z "${ALERT_IMESSAGE_TARGET:-}" ]; then
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
  local escaped="${msg//\"/\\\"}"
  local script
  script=$(mktemp -t brickbot-watchdog)
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

  if [ -f "$marker" ] && [ "$(cat "$marker")" = "$key" ]; then
    return
  fi

  send_imessage "[brickbot $(date +%Y-%m-%d)] ${job}: ${detail}"
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

check_job "brickbot-daily-brief" "05:50" 600

check_job "pull-linear" "06:30" 900

check_job "yarn-sync" \
  "07:00 09:00 11:00 13:00 15:00 17:00 19:00 21:00 23:00" \
  900

check_job "cowork-morning-brief" "06:00" 1800

check_job "cowork-evening-processor" "21:00" 1800

exit 0
