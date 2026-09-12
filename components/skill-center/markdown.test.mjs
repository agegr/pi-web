import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

test('F05: rendered SKILL frontmatter is metadata, not a Markdown heading', () => {
  const source = '---\r\nname: finance\r\ndescription: source metadata\r\n---\r\n# Financial research\r\n\r\nPreserve the source body.';
  const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm, remarkFrontmatter], skipHtml: true }, source));
  assert.match(html, /<h1>Financial research<\/h1>/);
  assert.match(html, /Preserve the source body/);
  assert.doesNotMatch(html, /source metadata|name: finance/);
  assert.match(source, /description: source metadata/);
});
