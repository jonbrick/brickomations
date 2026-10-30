#!/usr/bin/env bash
# Ensure Claude Desktop and Obsidian are running. `open -a` is idempotent —
# it foregrounds an already-running app or launches one that isn't.
# Called by com.brickomations.app-launcher.plist before each Cowork event so the
# Cowork tasks (running inside Claude Desktop) and Granola Sync (inside Obsidian)
# can fire reliably.
#
# Logs each invocation to local/logs/app-launcher.log with a timestamp + per-app
# result. The stdout/stderr captured by launchd is silent on success (`open -a`
# returns 0 with no output), which made the May 4 2026 morning-brief miss
# unprovable from logs — was Claude Desktop ever attempted? Now we'll know.
#
# `open -a` returning 0 only proves a process was spawned. On Thu 2026-10-29
# 20:55 it spawned Obsidian's main process, which then sat 18 h behind a
# Gatekeeper first-open prompt (quarantined bundle, nobody at the headless
# mini) and never loaded the app or its plugins — Granola Sync stalled until
# someone clicked Open on Fri 2026-10-30 15:15. An Electron app has an
# "<App> Helper (Renderer)" process only once it has actually initialized, so
# after opening Obsidian this waits up to RENDERER_WAIT_SEC for one and writes
# a heartbeat ping either way: ok → silent; failed → the watchdog texts on its
# next 5-min cycle instead of the next morning's granola-sync check.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$HOME/projects/brickomations/local/logs/app-launcher.log"
PING="$REPO_ROOT/scripts/heartbeat-ping.sh"
RENDERER_WAIT_SEC=90
mkdir -p "$(dirname "$LOG_FILE")"

ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }
log() { echo "$(ts) $*" >> "$LOG_FILE"; }

failures=""
fail() {
    failures="${failures:+$failures; }$1"
    log "FAILED: $1"
    echo "Warning: $1" >&2
}

launch_app() {
    local app="$1"
    if open -a "$app" 2>/dev/null; then
        log "launched $app — ok"
    else
        fail "$app did not open (open -a non-zero)"
        return 1
    fi
}

# Polls every 5 s for "<app> Helper (Renderer)", up to RENDERER_WAIT_SEC.
wait_for_renderer() {
    local app="$1" waited=0
    while [ "$waited" -lt "$RENDERER_WAIT_SEC" ]; do
        if pgrep -fq "$app Helper \(Renderer\)"; then
            log "$app renderer up after ${waited}s"
            return 0
        fi
        sleep 5
        waited=$((waited + 5))
    done
    return 1
}

# Start time of the oldest main process of <app>, as "Thu 20:55", or "?".
process_since() {
    local pid since
    pid=$(pgrep -xo "$1" 2>/dev/null) || { echo "?"; return; }
    since=$(ps -o lstart= -p "$pid" 2>/dev/null | sed 's/ *$//')
    date -j -f '%a %b %d %T %Y' "$since" '+%a %H:%M' 2>/dev/null || echo "?"
}

launch_app "Claude" || true
if launch_app "Obsidian"; then
    wait_for_renderer "Obsidian" \
        || fail "Obsidian process up since $(process_since Obsidian) but no renderer after ${RENDERER_WAIT_SEC}s — app never loaded; likely a dialog on the mini's screen"
fi

if [ -z "$failures" ]; then
    "$PING" app-launcher ok
else
    "$PING" app-launcher failed "$failures"
fi
