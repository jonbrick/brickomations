#!/usr/bin/env bash
# heartbeat-ping.sh — write a heartbeat ping for a scheduled job.
# Called by cli/sync.js on completion (success or failure) and by Cowork
# prompts at the end of each Cowork task.
#
# Usage: heartbeat-ping.sh <job-name> <ok|failed> [message]
# Writes: ~/projects/brickomations/local/heartbeat/<job-name>.json
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <job-name> <ok|failed> [message]" >&2
  exit 64
fi

job="$1"
status="$2"
message="${3:-}"

if [ "$status" != "ok" ] && [ "$status" != "failed" ]; then
  echo "Error: status must be 'ok' or 'failed' (got '$status')" >&2
  exit 64
fi

# Restrict job name to safe filename characters — prevent path traversal etc.
if [[ ! "$job" =~ ^[a-z0-9-]+$ ]]; then
  echo "Error: job name must match [a-z0-9-]+ (got '$job')" >&2
  exit 64
fi

heartbeat_dir="$HOME/projects/brickomations/local/heartbeat"
mkdir -p "$heartbeat_dir"

target="$heartbeat_dir/${job}.json"
tmp="${target}.tmp"

timestamp=$(date "+%Y-%m-%dT%H:%M:%S%z")

# Escape double-quotes in message so JSON parses cleanly.
escaped_message=${message//\"/\\\"}

if [ -n "$message" ]; then
  printf '{"timestamp":"%s","status":"%s","message":"%s"}\n' \
    "$timestamp" "$status" "$escaped_message" > "$tmp"
else
  printf '{"timestamp":"%s","status":"%s"}\n' "$timestamp" "$status" > "$tmp"
fi

# Atomic replace.
mv "$tmp" "$target"
