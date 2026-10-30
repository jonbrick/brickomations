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
#   app-launcher                — 5:55 AM, 8:40 PM (ensure-apps-running.sh; failed ping
#                                 when an app didn't open or Obsidian never loaded)
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
  # The message travels as an argv item, never interpolated into the script:
  # no quoting rules to get wrong (a JSON `\"` in a failed ping broke the send
  # on 2026-10-20 and the pull-linear failure never reached the phone), and
  # nothing in a log-derived message can expand as shell or AppleScript.
  local script
  script=$(mktemp -t brickomations-watchdog)
  cat > "$script" <<'APPLESCRIPT'
on run argv
    tell application "Messages"
        set theService to 1st service whose service type = iMessage
        set theBuddy to buddy (item 1 of argv) of theService
        send (item 2 of argv) to theBuddy
    end tell
end run
APPLESCRIPT
  local err
  if ! err=$(osascript "$script" "$ALERT_IMESSAGE_TARGET" "$msg" 2>&1 >/dev/null); then
    echo "Failed to send iMessage (${err:-no error text}): $msg" >&2
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
  local bootstrap="${4:-}"

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
    # A job added after the watchdog went live has no ping until its first
    # scheduled run under the new code; "no ping" there is a false alarm.
    if [ "$bootstrap" = "bootstrap" ]; then
      return
    fi
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
    # JSON string with escapes: heartbeat-ping.sh writes `\"` for quotes. The
    # old pattern stopped at the first escaped quote and lost the rest.
    message=$(sed -nE 's/.*"message":"(([^"\\]|\\.)*)".*/\1/p' "$ping_file")
    message=${message//\\\"/\"}
    message=${message//\\\\/\\}
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
# The vault reads live in scripts/granola-state.js, not here. The vault is
# Obsidian's iCloud container and macOS TCC guards it: a shell script run by
# launchd is a platform binary tccd never prompts for and never checks Files &
# Folders grants for, so every `ls` under <vault>/.obsidian/ is denied at the
# kernel ("Sandbox) System Policy: bash deny file-read-data"). That read as
# "no debug log" every morning from Mon 2026-10-19 (check deployed) to Tue
# 2026-10-20. Node is not a platform binary and already holds the grant on
# the mini — it's what every other vault-touching job runs as — so the helper
# does the reads and prints key=value lines; this function keeps the
# thresholds and alert logic. Verified 2026-10-20 with a throwaway launchd
# agent: bash `ls` DENIED, node from inside the same script ALLOWED.
# Rule: launchd shell scripts can't read the vault; vault reads go through node.
#
# Alert keys include today's date → one text per condition per day while
# the condition holds. Lesson learned 2026-10-16: the plugin stalled silently
# for 36 days (Granola encrypted its local credentials on 2026-09-10; the old
# plugin only surfaced an in-app Notice nobody saw on a headless mini).
# ---------------------------------------------------------------------------
VAULT_DIR="${BRICKOCAMPUS_DIR:-$HOME/projects/brickocampus}"
GRANOLA_PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/granola-sync"
GRANOLA_STATE_JS="$REPO_ROOT/scripts/granola-state.js"
GRANOLA_WINDOW_START="07:00"   # local time — the mini wakes 05:45; first cycle lands by ~06:30
GRANOLA_WINDOW_END="23:00"     # caffeinate releases 23:30
GRANOLA_LIVENESS_SEC=7200      # 4 missed 30-min cycles
GRANOLA_PROGRESS_SEC=$((4 * 86400))
# launchd's PATH is minimal; the plists call node by this absolute path too.
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN=$(command -v node 2>/dev/null || true)
fi

# granola_field <key> <state> — value of one key=value line from the helper.
granola_field() {
  printf '%s\n' "$2" | sed -n "s/^$1=//p"
}

# Three states, not two. `pgrep -x Obsidian` alone lied on Thu 2026-10-29:
# the launcher's `open -a` spawned the main process at 20:55, Gatekeeper put
# a first-open prompt for the (quarantined, Chrome-downloaded) bundle on the
# headless mini's screen, and the process sat there 18 h without ever loading
# the app or its plugins — "Obsidian running" rode along on both alerts. An
# Electron app has an "<App> Helper (Renderer)" process only once it has
# actually initialized, so that's the liveness signal; a bare main process
# means a blocked launch.
obsidian_status() {
  if pgrep -fq 'Obsidian Helper \(Renderer\)'; then
    echo "Obsidian running"
  elif pgrep -xq Obsidian; then
    local pid since
    pid=$(pgrep -xo Obsidian)
    since=$(ps -o lstart= -p "$pid" 2>/dev/null | sed 's/ *$//')
    since=$(date -j -f '%a %b %d %T %Y' "$since" '+%a %H:%M' 2>/dev/null || echo "?")
    echo "Obsidian process up since $since but the app never loaded — likely a dialog on the mini's screen"
  else
    echo "Obsidian NOT running"
  fi
}

check_granola_sync() {
  local job="granola-sync"
  local now_hm
  now_hm=$(date +%H:%M)
  if [[ "$now_hm" < "$GRANOLA_WINDOW_START" || "$now_hm" > "$GRANOLA_WINDOW_END" ]]; then
    return
  fi

  if [ -z "$NODE_BIN" ]; then
    alert "$job" "node not found (/opt/homebrew/bin/node missing, NODE_BIN unset) — can't read plugin state" "helper-${TODAY}"
    return
  fi

  local state
  if ! state=$("$NODE_BIN" "$GRANOLA_STATE_JS" "$GRANOLA_PLUGIN_DIR" 2>&1); then
    # A refused read (TCC / permissions) or a crashed helper. Its own alert,
    # so it can never masquerade as "no log" — the confusion of 2026-10-20.
    alert "$job" "state helper failed: $(printf '%s' "$state" | tail -1 | cut -c1-160)" "helper-${TODAY}"
    return
  fi

  if [ "$(granola_field data_json "$state")" != "1" ]; then
    alert "$job" "plugin data.json missing ($GRANOLA_PLUGIN_DIR/data.json)" "missing-${TODAY}"
    return
  fi

  local obsidian_state
  obsidian_state=$(obsidian_status)

  # 1. Liveness.
  local log_file log_epoch
  log_file=$(granola_field log_file "$state")
  if [ -z "$log_file" ]; then
    alert "$job" "no debug log under .obsidian/plugins/granola-sync/logs — plugin not loaded or debug logging off; $obsidian_state" "nolog-${TODAY}"
    return
  fi
  log_epoch=$(granola_field log_mtime_epoch "$state")
  log_epoch=${log_epoch:-0}
  if [ $((NOW_EPOCH - log_epoch)) -gt "$GRANOLA_LIVENESS_SEC" ]; then
    alert "$job" "no sync cycle since $(date -r "$log_epoch" '+%a %H:%M'); $obsidian_state" "dead-${TODAY}"
    return
  fi

  # 2. Health — last cycle must have listed notes. Skipped while the block is
  #    under 3 min old (cycle still running) or its first line didn't parse.
  #    (The old bash version piped the ~350 KB block through `grep -q` under
  #    pipefail; grep's early exit SIGPIPE'd printf → status 141 → a false
  #    "did not list notes". The helper answers with a flag instead.)
  local started_epoch
  started_epoch=$(granola_field block_started_epoch "$state")
  started_epoch=${started_epoch:-0}
  if [ "$(granola_field block_listed "$state")" != "1" ] \
     && [ "$started_epoch" -gt 0 ] \
     && [ $((NOW_EPOCH - started_epoch)) -gt 180 ]; then
    local err
    err=$(granola_field block_error "$state")
    alert "$job" "last cycle $(date -r "$started_epoch" '+%H:%M') did not list notes — API key missing/rejected or network${err:+; $err}" "fail-${TODAY}"
    return
  fi

  # 3. Progress backstop.
  local last_ms
  last_ms=$(granola_field latest_sync_ms "$state")
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

# ensure-apps-running.sh: ok once both apps opened and Obsidian has a renderer,
# failed otherwise (it waits ≤90 s). "bootstrap": no ping file until its first
# run under this code, so a missing file isn't a miss.
check_job "app-launcher" "05:55 20:40" 300 bootstrap

check_granola_sync

exit 0
