#!/usr/bin/env bash
set -euo pipefail

# install-launchd.sh — install/refresh brickbot's launchd jobs on this machine.
# Substitutes $HOME into each plist template and (re)loads via launchctl.
# Safe to re-run; unloads any existing plists before reloading.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHAGENTS_DIR="$HOME/Library/LaunchAgents"

mkdir -p "$LAUNCHAGENTS_DIR"
# Ensure log dir exists — launchd's StandardOut/ErrorPath crashes if missing.
mkdir -p "$REPO_ROOT/local/logs"

install_one() {
  local label="$1"
  local template="$REPO_ROOT/infra/launchd/${label}.plist.template"
  local dest="$LAUNCHAGENTS_DIR/${label}.plist"

  if [ ! -f "$template" ]; then
    echo "Error: template not found at $template" >&2
    exit 1
  fi

  if [ -f "$dest" ]; then
    echo "Unloading existing $dest"
    launchctl unload "$dest" 2>/dev/null || true
  fi

  sed "s|__HOME__|$HOME|g" "$template" > "$dest"
  chmod 644 "$dest"

  launchctl load "$dest"
  echo "Installed and loaded $label"
  echo "  plist: $dest"
}

install_one "com.brickbot.daily"
install_one "com.brickbot.daily-brief" # pre-stages briefs/<date>.json at 06:00
install_one "com.brickbot.pull-linear" # caches Linear projects + assigned issues at 06:30
install_one "com.brickbot.app-launcher"
install_one "com.brickbot.watchdog"   # push-based heartbeat; reads ping files
install_one "com.brickbot.caffeinate" # holds idle sleep off 06:00–23:30 daily
install_one "com.brickbot.daily-text-morning" # texts today's note digest at 07:20
install_one "com.brickbot.daily-text-evening"  # texts the day's recaps at 21:20

echo ""
echo "Done."
echo "  user: $(whoami)"
echo "  host: $(hostname -s)"
