#!/usr/bin/env bash
# hold-awake-until-bedtime.sh — hold idle sleep off until 23:30 today.
#
# Called daily at 05:45 by com.brickbot.caffeinate. RunAtLoad also fires this
# at launchd load (boot, manual reload) so a mid-day reboot resumes the awake
# window without waiting for the next 05:45 fire. Exits cleanly if invoked
# outside the 05:45–23:30 window — re-firing is always safe.
#
# Net effect: mini is discoverable for AirDrop / SSH / general use from
# 05:45–23:30, then idle-sleeps after 30 min of inactivity (per `pmset -c
# sleep 30`). The 23:30 cutoff clears the 23:00 yarn sync's 15-min hard
# timeout (typical 2–3 min, worst observed 6 min).
set -euo pipefail

START_HHMM="05:45"
END_HHMM="23:30"

LOG_FILE="$HOME/projects/brickomations/local/logs/caffeinate.log"
mkdir -p "$(dirname "$LOG_FILE")"
ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }
log() { echo "$(ts) $*" >> "$LOG_FILE"; }

now_epoch=$(date +%s)
start_epoch=$(date -j -f "%H:%M" "$START_HHMM" +%s)
end_epoch=$(date -j -f "%H:%M" "$END_HHMM" +%s)

if [ "$now_epoch" -lt "$start_epoch" ]; then
  log "before $START_HHMM — exiting (next fire $START_HHMM today)"
  exit 0
fi
if [ "$now_epoch" -ge "$end_epoch" ]; then
  log "past $END_HHMM — exiting (next fire $START_HHMM tomorrow)"
  exit 0
fi

duration=$((end_epoch - now_epoch))
log "holding awake for ${duration}s (until $END_HHMM)"
exec caffeinate -i -t "$duration"
