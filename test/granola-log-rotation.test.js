// Guards Granola Sync log rotation (cli/rotate-granola-logs.js).
//
// What matters: the newest log — the one the watchdog reads — is never
// touched, everything older lands in the trash folder (recoverable), a name
// collision in the trash doesn't clobber, and a missing logs folder is a no-op.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { assert, assertEqual } = require("./helpers");
const { rotate } = require("../cli/rotate-granola-logs");

function setup(names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "granola-logs-"));
  const logsDir = path.join(root, "logs");
  const trashDir = path.join(root, "Trash");
  fs.mkdirSync(logsDir);
  const base = Date.now() / 1000 - 86400;
  names.forEach((name, i) => {
    const file = path.join(logsDir, name);
    fs.writeFileSync(file, `log ${i}\n`);
    fs.utimesSync(file, base + i * 60, base + i * 60); // later in the list = newer
  });
  return { root, logsDir, trashDir };
}

module.exports = {
  "keeps the newest log, trashes the rest": () => {
    const { logsDir, trashDir } = setup(["a.log", "b.log", "c.log"]);
    const { kept, trashed } = rotate(logsDir, trashDir);
    assertEqual(path.basename(kept), "c.log");
    assertEqual(trashed.length, 2);
    assertEqual(fs.readdirSync(logsDir).join(","), "c.log");
    assertEqual(fs.readdirSync(trashDir).sort().join(","), "a.log,b.log");
  },
  "newest is by mtime, not by name": () => {
    const { logsDir, trashDir } = setup(["z.log", "a.log"]);
    const { kept } = rotate(logsDir, trashDir);
    assertEqual(path.basename(kept), "a.log");
    assertEqual(fs.readdirSync(trashDir).join(","), "z.log");
  },
  "a single log is left alone and no trash folder is made": () => {
    const { logsDir, trashDir } = setup(["only.log"]);
    const { trashed } = rotate(logsDir, trashDir);
    assertEqual(trashed.length, 0);
    assert(!fs.existsSync(trashDir), "trash folder should not exist");
  },
  "non-.log files are ignored": () => {
    const { logsDir, trashDir } = setup(["a.log", "b.log"]);
    fs.writeFileSync(path.join(logsDir, "notes.txt"), "x");
    rotate(logsDir, trashDir);
    assertEqual(fs.readdirSync(logsDir).sort().join(","), "b.log,notes.txt");
  },
  "a name already in the trash gets a suffix, not overwritten": () => {
    const { logsDir, trashDir } = setup(["a.log", "b.log"]);
    fs.mkdirSync(trashDir);
    fs.writeFileSync(path.join(trashDir, "a.log"), "earlier");
    rotate(logsDir, trashDir);
    const names = fs.readdirSync(trashDir);
    assertEqual(names.length, 2);
    assertEqual(fs.readFileSync(path.join(trashDir, "a.log"), "utf8"), "earlier");
  },
  "missing logs folder is a no-op": () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "granola-logs-"));
    const { kept, trashed } = rotate(path.join(root, "nope"), path.join(root, "Trash"));
    assertEqual(kept, null);
    assertEqual(trashed.length, 0);
  },
};
