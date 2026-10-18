import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";

import {
  markdownAppUrlTransform,
  markdownPreviewRehypePlugins,
  markdownPreviewRemarkPlugins,
  markdownRehypePlugins,
  markdownRemarkPlugins,
} from "./markdown.ts";

// Both pipelines that render Markdown in the app: the chat one and the file
// preview one. The sanitizer that prefixes `id`s sits in both, so the matching
// fragment-link rule must hold in both.
const pipelines = [
  ["chat", markdownRemarkPlugins, markdownRehypePlugins],
  ["file preview", markdownPreviewRemarkPlugins, markdownPreviewRehypePlugins],
];

function render(markdown, remarkPlugins, rehypePlugins) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins,
    rehypePlugins,
    urlTransform: markdownAppUrlTransform,
  }, markdown));
}

describe("fragment links follow the sanitizer's id prefix", () => {
  it("keeps a hand-written anchor pair consistent in chat and file previews", () => {
    for (const [name, remarkPlugins, rehypePlugins] of pipelines) {
      const html = render('<a id="s2"></a>\n\n[S2](#s2)', remarkPlugins, rehypePlugins);
      assert.ok(html.includes('id="user-content-s2"'), `${name}: ${html}`);
      assert.ok(html.includes('href="#user-content-s2"'), `${name}: ${html}`);
    }
  });

  it("rewrites the fragment of a raw-HTML anchor as well", () => {
    for (const [name, remarkPlugins, rehypePlugins] of pipelines) {
      const html = render('<a href="#s2">raw</a>', remarkPlugins, rehypePlugins);
      assert.ok(html.includes('href="#user-content-s2"'), `${name}: ${html}`);
    }
  });

  it("keeps footnote links reaching their elements", () => {
    // mdast-util-to-hast generates footnote ids and hrefs already carrying the
    // prefix, and sanitizing prefixes the id once more — an href left as
    // generated would strand every footnote link behind the doubled prefix.
    for (const [name, remarkPlugins, rehypePlugins] of pipelines) {
      const html = render("text[^1]\n\n[^1]: the note", remarkPlugins, rehypePlugins);
      const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
      const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
      assert.ok(hrefs.length >= 2, `${name}: expected footnote links, got ${html}`);
      for (const href of hrefs) {
        assert.ok(ids.has(href), `${name}: #${href} has no element in ${html}`);
      }
    }
  });

  it("does not touch external fragments or a bare hash", () => {
    for (const [name, remarkPlugins, rehypePlugins] of pipelines) {
      const html = render("[ext](https://example.com/docs#section) and [top](#)", remarkPlugins, rehypePlugins);
      assert.ok(html.includes('href="https://example.com/docs#section"'), `${name}: ${html}`);
      assert.ok(html.includes('href="#"'), `${name}: ${html}`);
    }
  });
});
