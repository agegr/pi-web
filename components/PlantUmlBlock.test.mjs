import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { PlantUmlBlock } = await jiti.import("./PlantUmlBlock.tsx");
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const source = "@startuml\nAlice -> Bob: Hello!\n@enduml";

function render(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

test("PlantUmlBlock shows the source and a button naming plantuml.com, sending nothing", () => {
  const html = render(React.createElement(PlantUmlBlock, { code: source, lang: "plantuml" }));
  assert.match(html, /Alice -&gt; Bob/);
  assert.match(html, /<button[^>]*title="Render on plantuml.com"[^>]*>Render on plantuml.com<\/button>/);
  assert.doesNotMatch(html, /<img|plantuml\.com\/plantuml/);
});

test("PlantUmlBlock waits for the end of a streamed reply", () => {
  const html = render(React.createElement(PlantUmlBlock, { code: source, lang: "puml", isStreaming: true }));
  assert.match(html, /<button[^>]*disabled=""[^>]*title="Preview available after streaming"/);
  assert.match(html, />puml</);
  assert.doesNotMatch(html, /<img/);
});

test("```plantuml and ```puml fences render through PlantUmlBlock; others do not", () => {
  const markdown = (lang, isStreaming) => render(
    React.createElement(MarkdownBody, { isStreaming }, `\`\`\`${lang}\n${source}\n\`\`\``),
  );
  for (const lang of ["plantuml", "puml", "PlantUML"]) {
    assert.match(markdown(lang), />Render on plantuml.com</, lang);
    assert.match(markdown(lang, true), />Render on plantuml.com</, `${lang} streaming`);
  }
  for (const lang of ["uml", "text", "mermaid"]) {
    assert.doesNotMatch(markdown(lang), /plantuml\.com/, lang);
  }
});
