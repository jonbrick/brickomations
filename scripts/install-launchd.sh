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

# Labels this repo used to install. Unloaded and removed if a previous install
# left them behind, so the mini matches the templates after a pull.
retire_one() {
  local label="$1"
  local dest="$LAUNCHAGENTS_DIR/${label}.plist"
  if [ -f "$dest" ]; then
    echo "Retiring $label"
    launchctl unload "$dest" 2>/dev/null || true
    rm -f "$dest"
    echo "  removed: $dest"
  fi
}

install_one "com.brickomations.sync-morning" # heavy yarn sync at 05:20 (full resync, full Linear pull)
install_one "com.brickomations.sync-hourly"  # light yarn sync every 2 h, 07:00–23:00 except 21:00
install_one "com.brickomations.sync-evening" # heavy yarn sync at 21:00 (before the 21:15 evening render)
install_one "com.brickomations.daily-brief" # pre-stages briefs/<date>.json at 05:50
install_one "com.brickomations.watchdog"   # push-based heartbeat; reads ping files
install_one "com.brickomations.caffeinate" # holds idle sleep off 05:15–23:30 daily
install_one "com.brickomations.daily-text-morning" # texts ### MORNING SUMMARY at 06:20 (polls to 06:35)
install_one "com.brickomations.evening-render"      # fills Tasks/Completed Events/Calendar at 21:15 (before the 21:20 processor)
install_one "com.brickomations.daily-text-evening"  # texts ### Evening Summary at 21:45 (polls to 22:00)

retire_one "com.brickomations.app-launcher" # folded into the watchdog: it relaunches Claude/Obsidian on any 5-min tick that finds one closed
retire_one "com.brickomations.daily"        # split into sync-morning / sync-hourly / sync-evening
retire_one "com.brickomations.pull-linear"  # the full Linear pull now runs inside sync-morning / sync-evening

echo ""
echo "Done."
echo "  user: $(whoami)"
echo "  host: $(hostname -s)"
