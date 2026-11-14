#!/usr/bin/env node

// wow-tracker.js — one poll of the World of Warcraft session tracker.
//
// Run every 5 minutes by launchd (com.brickomations.wow-tracker). Checks
// whether the WoW game process is running, advances local/wow/state.json, and
// appends each finished session to local/wow/sessions.jsonl. collect-wow.js
// reads that log into the shared 🎮 video games Notion DB.
//
// Battle.net has no playtime API — this is the only signal. Like Steam, it
// can't tell active play from the game sitting open and idle.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { tickSession } = require("../src/utils/wow-sessions");

const REPO_ROOT = path.join(__dirname, "..");
const WOW_DIR = process.env.WOW_DIR || path.join(REPO_ROOT, "local", "wow");
const STATE_PATH = path.join(WOW_DIR, "state.json");
const SESSIONS_PATH = path.join(WOW_DIR, "sessions.jsonl");

// The game binary, not the launcher ("World of Warcraft Launcher.app").
const PROCESS_PATTERN = "World of Warcraft.app/Contents/MacOS/World of Warcraft";

function isWowRunning() {
  try {
    execFileSync("/usr/bin/pgrep", ["-f", PROCESS_PATTERN], { stdio: "ignore" });
    return true;
  } catch (error) {
    if (error.status === 1) return false; // pgrep: no match
    throw error;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { open: null };
  }
}

function writeState(state) {
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_PATH);
}

function main() {
  fs.mkdirSync(WOW_DIR, { recursive: true });

  const now = new Date().toISOString();
  const running = isWowRunning();
  const before = readState();
  const { state, closed } = tickSession(before, running, now);

  if (closed) {
    fs.appendFileSync(SESSIONS_PATH, JSON.stringify(closed) + "\n");
    console.log(`[${now}] closed session ${closed.start} → ${closed.end}`);
  }
  if (state.open && state.open.start === now) {
    console.log(`[${now}] opened session`);
  }

  writeState(state);
}

main();
