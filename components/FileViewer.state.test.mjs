import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import reactSyntaxHighlighter from "react-syntax-highlighter";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const { Prism: SyntaxHighlighter } = reactSyntaxHighlighter;

function functionBlock(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start) : source.length;
  assert.notEqual(start, -1, `${name} not found`);
  assert.notEqual(end, -1, `${nextName} not found after ${name}`);
  return source.slice(start, end);
}

test("media viewers share one versioned watcher-first handshake", () => {
  const hook = functionBlock("useWatchedFileVersion", "ImageViewer");
  const directFallback = hook.indexOf("if (!watchEnabled)");
  const eventSource = hook.indexOf("new EventSource", directFallback);
  assert.ok(directFallback >= 0, "watchEnabled fallback missing");
  assert.ok(eventSource > directFallback, "EventSource created before fallback branch");
  assert.match(hook, /applyVersion\(nextVersion\)/);
  assert.match(hook, /changeTimer = setTimeout\(\(\) => applyVersion\(nextVersion\), 80\)/);
  assert.match(hook, /controller\.abort\(\)/);
  assert.equal(hook.match(/addEventListener\("error", markDisconnected\)/g)?.length, 1);
  assert.doesNotMatch(hook, /es\.onerror|consecutiveWatchFailures/);

  for (const [name, nextName] of [
    ["ImageViewer", "formatDuration"],
    ["AudioViewer", "VideoViewer"],
    ["VideoViewer", "DocumentViewer"],
    ["DocumentViewer", "FileViewer"],
  ]) {
    const block = functionBlock(name, nextName);
    assert.match(block, /useWatchedFileVersion\(/, `${name} does not use shared watcher`);
    assert.match(block, /version\.etag/, `${name} URL is not versioned`);
    assert.doesNotMatch(block, /new EventSource/, `${name} owns a duplicate watcher`);
  }
});

test("FileViewer forwards watcher state to every viewer implementation", () => {
  const block = functionBlock("FileViewer", "TextFileViewer");
  assert.equal(block.match(/watchEnabled=\{watchEnabled\}/g)?.length, 5);
});

test("TextFileViewer uses one watcher-owned initial content snapshot", () => {
  const block = functionBlock("TextFileViewer", null);
  assert.equal(block.match(/fetchContent\(filePath\)/g)?.length, 1);
  assert.equal(block.match(/new EventSource\(/g)?.length, 1);
  assert.match(block, /dataRef\.current\?\.version\.etag === nextVersion\.etag/);
  assert.match(block, /changeTimer = setTimeout\(\(\) => loadSnapshot\(nextVersion, true\), 80\)/);
  assert.match(block, /contentAbortRef\.current\?\.abort\(\)/);
  assert.match(block, /const loadKind = wantsPatch \? "patch" : "probe"/);
  assert.match(block, /fetchGitDiff\(filePath, !wantsPatch\)/);
  assert.match(block, /params\.set\("probe", "1"\)/);
  assert.match(block, /if \(!probeOnly\) setGitDiffLoading\(true\)/);
  assert.match(block, /startTransition\(\(\) => \{[\s\S]*setGitDiffAvailable\(available\)/);
  assert.match(block, /requestId === gitDiffRequestRef\.current && !probeOnly/);
  assert.match(block, /\.\.\.\(canShowGitDiff \? \["diff" as const\] : \[\]\)/);
  assert.match(block, /deferredSourceContent = useDeferredValue\(data\?\.content \?\? ""\)/);
  assert.match(block, /if \(!watchEnabled\) \{[\s\S]*loadSnapshot\(\)/);
  assert.equal(block.match(/addEventListener\("error", markDisconnected\)/g)?.length, 1);
  assert.doesNotMatch(block, /es\.onerror|consecutiveWatchFailures/);
  assert.match(block, /dataRef\.current = getCachedTextFile\(cacheKey\) \?\? null;[\s\S]*setData\(null\)/);
  assert.match(block, /setCachedTextFile\(cacheKey, next\)/);
  assert.match(block, /response\.status === 304 && current[\s\S]*setData\(current\)/);

  const connected = block.slice(
    block.indexOf('es.addEventListener("connected"'),
    block.indexOf('es.addEventListener("change"'),
  );
  assert.match(connected, /loadSnapshot\(eventVersion\(event\)\)/);
  assert.doesNotMatch(connected, /fetchGitDiff/);
});

test("TextFileViewer snapshots and restores lightweight tab state", () => {
  const block = functionBlock("TextFileViewer", null);
  assert.match(block, /onStateChangeRef\.current\?\.\(\{ \.\.\.viewerStateRef\.current \}\)/);
  assert.match(block, /displayMode: requestedInitialDisplayMode/);
  assert.match(block, /viewerStateRef\.current\.displayMode = nextDisplayMode/);
  assert.match(block, /viewerStateRef\.current\.wrapLines = next/);
  assert.match(block, /viewerStateRef\.current\.scrollTop = event\.currentTarget\.scrollTop/);
  assert.match(block, /viewerStateRef\.current\.scrollLeft = event\.currentTarget\.scrollLeft/);
  assert.match(block, /content\.scrollTop = viewerStateRef\.current\.scrollTop/);
  assert.match(block, /content\.scrollLeft = viewerStateRef\.current\.scrollLeft/);
});

test("TextFileViewer selects Markdown and HTML preview before content rendering", () => {
  const block = functionBlock("TextFileViewer", null);
  assert.match(block, /\["md", "mdx", "html", "htm"\]\.includes\(fileExtension\)/);
  assert.match(block, /\? "preview"/);
  assert.match(block, /defaultPreviewEligibleRef = useRef\(false\)/);
});

test("Git probes cannot rerender expensive text viewer content", () => {
  assert.match(source, /const SourceFileContent = memo\(/);
  assert.match(source, /const MarkdownFilePreview = memo\(/);
  const block = functionBlock("TextFileViewer", null);
  assert.match(block, /<MarkdownFilePreview/);
  assert.match(block, /<SourceFileContent/);
});

test("source and diff rows retain full DOM content with off-screen rendering containment", () => {
  assert.match(cssSource, /\.file-source-line,\s*\.file-diff-line\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 20\.8px;/);
});

test("markdown table tokens stay inline despite Tailwind's table utility", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      SyntaxHighlighter,
      { language: "markdown" },
      "| Name | Desc |\n| --- | --- |\n| A | first |",
    ),
  );

  assert.match(html, /class="token table[ "]/);
  assert.match(cssSource, /span\.token\.table\s*\{[^}]*display:\s*inline;/);
});
