// Guards the Linear issue body → Notion task body conversion.
//
// The asymmetry that matters: an unstable round-trip means every run reads
// back a body that differs from the desired markdown and rewrites it — the
// sync never converges and pays two API calls per task per run forever.
// Every case below is written from that standpoint.

const { assert, assertEqual } = require("./helpers");
const {
  imagesToPlaceholders,
} = require("../src/workflows/linear-to-notion-tasks");
const {
  normalizedBody,
  canonicalizeLinksForCompare,
} = require("../src/utils/notion-content");

const ISSUE_URL = "https://linear.app/cortexio/issue/DSGN-594/slo-picker-ux";

/** True when a body is stable: round-tripping it again changes nothing. */
function roundTripStable(markdown) {
  const once = normalizedBody(markdown);
  const twice = normalizedBody(once);
  return (
    canonicalizeLinksForCompare(once) === canonicalizeLinksForCompare(twice)
  );
}

module.exports = {
  // --- image placeholders ---
  "a standalone image becomes a placeholder link to the issue"() {
    assertEqual(
      imagesToPlaceholders(
        "![screenshot](https://uploads.linear.app/abc/def.png)",
        ISSUE_URL
      ),
      `[🖼️ image — view in Linear](${ISSUE_URL})`
    );
  },
  "an inline image mid-sentence is replaced in place"() {
    assertEqual(
      imagesToPlaceholders(
        "Before ![x](https://uploads.linear.app/a.png) after",
        ISSUE_URL
      ),
      `Before [🖼️ image — view in Linear](${ISSUE_URL}) after`
    );
  },
  "multiple images all become placeholders"() {
    const out = imagesToPlaceholders(
      "![a](https://u.linear.app/1.png)\ntext\n![b](https://u.linear.app/2.png)",
      ISSUE_URL
    );
    assertEqual((out.match(/🖼️ image — view in Linear/g) || []).length, 2);
    assert(!out.includes("!["), "no image markdown should survive");
  },
  "an empty-alt image is still replaced"() {
    assert(
      !imagesToPlaceholders("![](https://u.linear.app/1.png)", ISSUE_URL).includes(
        "!["
      )
    );
  },
  "text without images passes through untouched"() {
    const text = "How does a user select and configure SLOs in OpEx?";
    assertEqual(imagesToPlaceholders(text, ISSUE_URL), text);
  },
  "a plain link is not mistaken for an image"() {
    const text = "See [the doc](https://example.com/spec)";
    assertEqual(imagesToPlaceholders(text, ISSUE_URL), text);
  },
  "empty and missing content stay empty"() {
    assertEqual(imagesToPlaceholders("", ISSUE_URL), "");
    assertEqual(imagesToPlaceholders(undefined, ISSUE_URL), "");
  },

  // --- round-trip stability (change detection must converge) ---
  "plain paragraph body is round-trip stable"() {
    assert(roundTripStable("How does a user select and configure SLOs in OpEx?"));
  },
  "placeholder-converted body is round-trip stable"() {
    assert(
      roundTripStable(
        imagesToPlaceholders(
          "Question here\n\n![shot](https://uploads.linear.app/a.png)",
          ISSUE_URL
        )
      )
    );
  },
  "typical issue markdown is round-trip stable"() {
    assert(
      roundTripStable(
        [
          "## Context",
          "",
          "- bullet one",
          "- bullet two",
          "",
          "1. step",
          "2. step",
          "",
          "> a quote",
          "",
          "```ts",
          "const x = 1;",
          "```",
          "",
          "[a link](https://example.com/page)",
          "---",
        ].join("\n")
      )
    );
  },
  "empty body normalizes to empty"() {
    assertEqual(normalizedBody(""), "");
    assertEqual(normalizedBody(undefined), "");
  },
};
