import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { CodeBlock } = await jiti.import("../components/MermaidBlock.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { loadPrismLanguages } = await jiti.import("../lib/prism-languages.ts");

export async function checkCodeColumns(page) {
  await loadPrismLanguages();
  // The filename starts in the same terminal column on each line.
  const code = "// │   file\n//     file\n// └── file";
  for (const isStreaming of [true, false]) {
    const markup = renderToStaticMarkup(React.createElement(I18nProvider, null,
      React.createElement(CodeBlock, { code, lang: "js", isStreaming })));
    const xs = await page.evaluate(async (markup) => {
      const fixture = document.createElement("div");
      fixture.style.cssText = "position:fixed;left:0;top:0;width:350px;visibility:hidden";
      fixture.innerHTML = markup;
      document.body.append(fixture);
      try {
        fixture.getBoundingClientRect(); // Request the fonts used by these glyphs.
        await document.fonts.ready;
        const nodes = document.createTreeWalker(fixture.querySelector("code"), NodeFilter.SHOW_TEXT);
        const xs = [];
        while (nodes.nextNode()) {
          for (const match of nodes.currentNode.textContent.matchAll(/file/g)) {
            const range = document.createRange();
            range.setStart(nodes.currentNode, match.index);
            range.setEnd(nodes.currentNode, match.index + 1);
            xs.push(range.getBoundingClientRect().x);
          }
        }
        return xs;
      } finally {
        fixture.remove();
      }
    }, markup);
    assert.equal(xs.length, 3);
    assert.ok(Math.max(...xs) - Math.min(...xs) < 1, `${isStreaming ? "streaming" : "highlighted"} tree columns: ${xs}`);
  }
}
