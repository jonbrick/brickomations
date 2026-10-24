// Guards the personal-projects mirror (Notion 2026 Projects → brickography/projects/).
//
// What matters: every Notion Status lands in exactly one of three folders,
// work rows never get mirrored, titles that would break a path still produce
// a stable filename, and the rendered file carries the body verbatim with a
// sync_hash slot vault-sync can fill.

const { assert, assertEqual } = require("./helpers");
const {
  bucketFor,
  isPersonal,
  fileNameFor,
  renderProject,
  expectedRelPath,
  notionUrlFor,
} = require("../src/utils/personal-projects-mirror");

const BASE = {
  _notionId: "3c4b9535-d4fd-80a5-a265-e51e887362f5",
  _notionEditedTime: "2026-10-24T14:37:10.125Z",
  Project: "Simplify brickosystem",
  Category: "🌱 Personal",
  Status: "🔴 To Do",
  Priority: "Low",
  "Personal Category": "🌱 Admin",
  Lead: "Jon Brick",
  Date: null,
  "Achieved Date": null,
  Description: "Keep making brickosystem more usable.",
  _content: "# Brief\n\n## Situation\n\nThe steel thread project is done.",
};

module.exports = {
  "every Notion status maps to a bucket": () => {
    assertEqual(bucketFor("🧊 Icebox"), "todo");
    assertEqual(bucketFor("🔴 To Do"), "todo");
    assertEqual(bucketFor("🔵 Doing"), "doing");
    assertEqual(bucketFor("🟣 Ongoing"), "doing");
    assertEqual(bucketFor("⏸️  Paused"), "doing");
    assertEqual(bucketFor("🟢 Done"), "done");
    assertEqual(bucketFor("❌ Canceled"), "done");
    assertEqual(bucketFor("🫥 Gone"), "done");
  },
  "plain-text status (already stripped) still maps": () => {
    assertEqual(bucketFor("Doing"), "doing");
  },
  "unknown status has no bucket": () => {
    assertEqual(bucketFor("🌀 Someday"), null);
    assertEqual(bucketFor(""), null);
    assertEqual(bucketFor(undefined), null);
  },
  "only 🌱 Personal rows are mirrored": () => {
    assert(isPersonal(BASE), "personal row");
    assert(!isPersonal({ ...BASE, Category: "💼 Work" }), "work row");
    assert(!isPersonal({ ...BASE, Category: undefined }), "no category");
  },
  "filename is the title, made path-safe": () => {
    assertEqual(fileNameFor("Simplify brickosystem", BASE._notionId), "Simplify brickosystem.md");
    assertEqual(fileNameFor("Google Maps saved places → NYC databases", BASE._notionId), "Google Maps saved places → NYC databases.md");
    assertEqual(fileNameFor("Local LLM on Mac mini (WhatsApp)", BASE._notionId), "Local LLM on Mac mini (WhatsApp).md");
    assertEqual(fileNameFor("A/B: test?", BASE._notionId), "A-B- test-.md");
    assertEqual(fileNameFor("  spaced   out  ", BASE._notionId), "spaced out.md");
  },
  "blank title falls back to the notion id": () => {
    assertEqual(fileNameFor("", BASE._notionId), "untitled-3c4b9535.md");
  },
  "expected path is bucket/filename": () => {
    assertEqual(expectedRelPath(BASE), "todo/Simplify brickosystem.md");
    assertEqual(expectedRelPath({ ...BASE, Status: "🟢 Done" }), "done/Simplify brickosystem.md");
    assertEqual(expectedRelPath({ ...BASE, Status: "🌀 Someday" }), null);
  },
  "rendered file: frontmatter fields, lowercase priority, stripped emoji, body verbatim": () => {
    const md = renderProject(BASE, ["Build the Brickosystem"]);
    assert(md.startsWith("---\n"), "starts with frontmatter");
    assert(md.includes('title: "Simplify brickosystem"'), "title");
    assert(md.includes("type: personal-project"), "type");
    assert(md.includes('status: "To Do"'), "status stripped");
    assert(md.includes('priority: "low"'), "priority lowercased");
    assert(md.includes('personal_category: "Admin"'), "category stripped");
    assert(md.includes('goals: ["Build the Brickosystem"]'), "goals list");
    assert(md.includes('notion_url: "https://www.notion.so/3c4b9535d4fd80a5a265e51e887362f5"'), "url");
    assert(md.includes('sync_hash: ""'), "hash slot");
    assert(md.endsWith("The steel thread project is done.\n"), "body verbatim, single trailing newline");
  },
  "no body → frontmatter only, no dangling blank lines": () => {
    const md = renderProject({ ...BASE, _content: "" });
    assert(md.endsWith("---\n"), "ends right after frontmatter");
    assert(!md.includes("---\n\n\n"), "no blank-line tail");
  },
  "quotes and backslashes in values are escaped": () => {
    const md = renderProject({ ...BASE, Description: 'Say "hi" C:\\path' });
    assert(md.includes('description: "Say \\"hi\\" C:\\\\path"'), md);
  },
  "notion url strips dashes": () => {
    assertEqual(notionUrlFor("3c4b9535-d4fd-80a5-a265-e51e887362f5"), "https://www.notion.so/3c4b9535d4fd80a5a265e51e887362f5");
    assertEqual(notionUrlFor(""), "");
  },
};
