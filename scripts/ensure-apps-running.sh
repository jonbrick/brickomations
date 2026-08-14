#!/usr/bin/env bash
# Ensure Claude Desktop and Obsidian are running. `open -a` is idempotent —
# it foregrounds an already-running app or launches one that isn't.
# Called by com.brickbot.app-launcher.plist before each Cowork event so the
# Cowork tasks (running inside Claude Desktop) and Granola Sync (inside Obsidian)
# can fire reliably.
#
# Logs each invocation to local/logs/app-launcher.log with a timestamp + per-app
# result. The stdout/stderr captured by launchd is silent on success (`open -a`
# returns 0 with no output), which made the May 4 2026 morning-brief miss
# unprovable from logs — was Claude Desktop ever attempted? Now we'll know.
set -euo pipefail

LOG_FILE="$HOME/projects/brickomations/local/logs/app-launcher.log"
mkdir -p "$(dirname "$LOG_FILE")"

ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }

launch_app() {
    local app="$1"
    if open -a "$app" 2>/dev/null; then
        echo "$(ts) launched $app — ok" >> "$LOG_FILE"
    else
        echo "$(ts) launched $app — FAILED" >> "$LOG_FILE"
        echo "Warning: failed to open $app" >&2
    fi
}

launch_app "Claude"
launch_app "Obsidian"
