import assert from "node:assert/strict";
import test from "node:test";
import { getSourceRenderMode } from "../lib/file-source-render-mode.ts";

test("large and truncated source files use the lightweight renderer until highlighting is enabled", () => {
  const base = {
    truncated: false,
    sourceLineCount: 1_001,
    highlightLargeSource: false,
    effectiveDisplayMode: "source",
    hasGitDiff: false,
    hasPreview: false,
  };

  assert.equal(getSourceRenderMode(base), "lightweight");
  assert.equal(getSourceRenderMode({ ...base, highlightLargeSource: true }), "highlighted");
  assert.equal(getSourceRenderMode({ ...base, sourceLineCount: 1_000, truncated: true }), "lightweight");
  assert.equal(getSourceRenderMode({ ...base, sourceLineCount: 1_000 }), "highlighted");
});

test("diff and preview modes keep their rendered source path", () => {
  const base = {
    truncated: true,
    sourceLineCount: 1_001,
    highlightLargeSource: false,
    effectiveDisplayMode: "source",
    hasGitDiff: false,
    hasPreview: false,
  };

  assert.equal(getSourceRenderMode({ ...base, effectiveDisplayMode: "diff", hasGitDiff: true }), "highlighted");
  assert.equal(getSourceRenderMode({ ...base, effectiveDisplayMode: "diff", hasGitDiff: false }), "lightweight");
  assert.equal(getSourceRenderMode({ ...base, effectiveDisplayMode: "preview", hasPreview: true }), "highlighted");
  assert.equal(getSourceRenderMode({ ...base, effectiveDisplayMode: "preview", hasPreview: false }), "lightweight");
});
