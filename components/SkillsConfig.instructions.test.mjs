import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { resolveSkillLink, skillInstructionsBody } = await jiti.import("./SkillsConfig.tsx");

test("skill instructions omit frontmatter and preserve the Markdown body", () => {
  assert.equal(
    skillInstructionsBody("---\nname: example\ndescription: Example\n---\n\n# Instructions\n\n- One\n"),
    "# Instructions\n\n- One",
  );
});

const link = (document, anchor = "") => ({ document, anchor });

for (const [name, from, cases] of [
  ["anchors stay in the current document and decode once", "guides/intro.md", [
    ["#", link("guides/intro.md")],
    ["#install", link("guides/intro.md", "install")],
    ["#caf%C3%A9%20notes", link("guides/intro.md", "café notes")],
    ["#literal%2520anchor", link("guides/intro.md", "literal%20anchor")],
    ["intro.md#part%23two", link("guides/intro.md", "part#two")],
    ["./intro.md#usage", link("guides/intro.md", "usage")],
  ]],
  ["encoded file names keep URL delimiters and Unicode", "SKILL.md", [
    ["guides/first%20steps.md", link("guides/first steps.md")],
    ["caf%C3%A9.MD#r%C3%A9sum%C3%A9", link("café.MD", "résumé")],
    ["C%23%20guide.markdown#intro", link("C# guide.markdown", "intro")],
    ["literal%2520name.md", link("literal%20name.md")],
    ["guides%2Fintro.md", link("guides/intro.md")],
    ["bad%.md", link("bad%.md")],
  ]],
  ["nested links resolve from the linking document's folder", "guides/deep/start.md", [
    ["next.md", link("guides/deep/next.md")],
    ["../overview.md", link("guides/overview.md")],
    ["../../SKILL.md#final", link("SKILL.md", "final")],
    ["./child/../next.md", link("guides/deep/next.md")],
    [".././other//intro.md", link("guides/other/intro.md")],
    ["%2e%2e/%2e%2e/SKILL.md", link("SKILL.md")],
    ["../../../outside.md", link("../outside.md")],
  ]],
  ["paths past the skill folder stay for the route to refuse", "SKILL.md", [
    ["../outside.md", link("../outside.md")],
    ["child/../../outside.md", link("../outside.md")],
    ["%2e%2e%2Foutside.md", link("../outside.md")],
    ["../../a/b.md", link("../../a/b.md")],
    ["/etc/secret.md", link("/etc/secret.md")],
    ["%2Fetc/../secret.md#x", link("/etc/../secret.md", "x")],
    ["docs\\next.md", link("docs\\next.md")],
    ["C:/Users/me/notes.md", link("C:/Users/me/notes.md")],
  ]],
]) {
  test(`skill links: ${name}`, () => {
    for (const [href, expected] of cases) {
      assert.deepEqual(resolveSkillLink(href, from), expected, href);
    }
  });
}
