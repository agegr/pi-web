import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MermaidBlock } = await jiti.import("./MermaidBlock.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

// Simple sequenceDiagram for testing
const mermaidSrc = `sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi`;

function renderMermaid(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MermaidBlock, props),
    ),
  );
}

test("MermaidBlock renders source by default", () => {
  const html = renderMermaid({ code: mermaidSrc });

  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.doesNotMatch(html, /mermaid-block-loading/);
});

test("MermaidBlock can render preview by default", () => {
  const html = renderMermaid({ code: mermaidSrc, defaultPreview: true });

  assert.match(html, />Source</);
  assert.match(html, /mermaid-block-loading/);
  assert.doesNotMatch(html, /Alice/);
});

test("MermaidBlock with isStreaming falls back to source view", () => {
  const html = renderMermaid({ code: mermaidSrc, isStreaming: true, defaultPreview: true });

  assert.match(html, /disabled/);
  assert.match(html, />Preview</);
  assert.match(html, /Alice/);
  assert.match(html, /-&gt;&gt;/);
});

test("MermaidBlock renders empty graph without error", () => {
  const html = renderMermaid({ code: "graph TD", defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block-loading/);
});

test("MermaidBlock handles English characters in diagram", () => {
  const englishMermaid = `sequenceDiagram
    participant PC as PC Client
    PC->>SV: Request login`;

  const html = renderMermaid({ code: englishMermaid, defaultPreview: true });

  assert.doesNotMatch(html, /mermaid-block-error/);
  assert.match(html, /mermaid-block/);
});
