#!/usr/bin/env bash
set -euo pipefail

# install-launchd.sh — install/refresh brickomations launchd jobs on this machine.
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

install_one "com.brickomations.daily"
install_one "com.brickomations.daily-brief" # pre-stages briefs/<date>.json at 05:50
install_one "com.brickomations.pull-linear" # caches Linear projects + assigned issues at 06:30
install_one "com.brickomations.app-launcher"
install_one "com.brickomations.watchdog"   # push-based heartbeat; reads ping files
install_one "com.brickomations.caffeinate" # holds idle sleep off 05:45–23:30 daily
install_one "com.brickomations.daily-text-morning" # texts today's note digest at 06:20
install_one "com.brickomations.evening-render"      # fills Completed Tasks/Events at 21:15 (before the evening text)
install_one "com.brickomations.daily-text-evening"  # texts the day's recaps at 21:20

echo ""
echo "Done."
echo "  user: $(whoami)"
echo "  host: $(hostname -s)"
