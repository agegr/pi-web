import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { HtmlPreviewBlock, extractHtmlTitle } = await jiti.import("./HtmlPreviewBlock.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderBlock(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(HtmlPreviewBlock, props),
    ),
  );
}

test("extractHtmlTitle extracts the document <title>", () => {
  assert.equal(
    extractHtmlTitle("<!doctype html><html><head><title>My Page</title></head><body></body></html>"),
    "My Page",
  );
  assert.equal(extractHtmlTitle("<html><head><title>  Hello &amp; World  </title></head></html>"), "Hello & World");
  assert.equal(extractHtmlTitle("<html><head><TITLE>Upper</TITLE></head></html>"), "Upper");
  assert.equal(extractHtmlTitle("<p>no title here</p>"), "");
  assert.equal(extractHtmlTitle("<html><head><title></title></head></html>"), "");
});

test("HtmlPreviewBlock renders an html code block with a preview button", () => {
  const html = renderBlock({ code: "<h1>hi</h1>", previewKey: "session:entry:0" });

  assert.match(html, />Preview HTML</);
  assert.match(html, />html</); // language label
  assert.match(html, />hi</); // code content (syntax-highlighted tokens)
});

test("HtmlPreviewBlock disables the preview button while streaming", () => {
  const html = renderBlock({ code: "<h1>hi</h1>", previewKey: "session:entry:0", isStreaming: true });

  assert.match(html, /disabled/);
});

test("HtmlPreviewBlock disables the preview button without a previewKey", () => {
  const html = renderBlock({ code: "<h1>hi</h1>" });

  assert.match(html, /disabled/);
});

test("HtmlPreviewBlock shows no expand toggle during SSR (collapse is client-side only)", () => {
  const html = renderBlock({ code: "<h1>hi</h1>", previewKey: "session:entry:0" });

  assert.doesNotMatch(html, /Expand/);
});
