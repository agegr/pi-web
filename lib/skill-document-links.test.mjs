import assert from "node:assert/strict";
import test from "node:test";
import { resolveSkillDocumentLink } from "./skill-document-links.ts";

const document = (path, anchor = "") => ({ kind: "document", document: path, anchor });
const error = (reason) => ({ kind: "error", reason });

for (const [name, current, cases] of [
  ["anchors stay in the current document and decode once", "guides/intro.md", [
    ["#", document("guides/intro.md")],
    ["#install", document("guides/intro.md", "install")],
    ["#caf%C3%A9%20notes", document("guides/intro.md", "café notes")],
    ["#literal%2520anchor", document("guides/intro.md", "literal%20anchor")],
    ["#section?mode=1", document("guides/intro.md", "section?mode=1")],
    ["intro.md#part%23two", document("guides/intro.md", "part#two")],
  ]],
  ["encoded filenames preserve URL delimiters and Unicode", "SKILL.md", [
    ["guides/first%20steps.md", document("guides/first steps.md")],
    ["caf%C3%A9.MD#r%C3%A9sum%C3%A9", document("café.MD", "résumé")],
    ["C%23%20guide.markdown#intro", document("C# guide.markdown", "intro")],
    ["report%3F.md", document("report?.md")],
    ["literal%2520name.md", document("literal%20name.md")],
    ["guides%2Fintro.md", document("guides/intro.md")],
    ["UPPER.MARKDOWN", document("UPPER.MARKDOWN")],
  ]],
  ["nested links resolve relative to the displayed document", "guides/deep/start.md", [
    ["next.md", document("guides/deep/next.md")],
    ["./next.md#usage", document("guides/deep/next.md", "usage")],
    ["../overview.md", document("guides/overview.md")],
    ["../../SKILL.md", document("SKILL.md")],
    ["./child/../next.md", document("guides/deep/next.md")],
    [".././other//intro.md", document("guides/other/intro.md")],
    ["%2e%2e/%2e%2e/SKILL.md", document("SKILL.md")],
    ["../../../outside.md", error("outside")],
    ["../../%2e%2e/outside.md", error("outside")],
  ]],
  ["root escapes and absolute paths are refused", "SKILL.md", [
    ["../outside.md", error("outside")],
    ["child/../../outside.md", error("outside")],
    ["../skill/SKILL.md", error("outside")],
    ["%2e%2e%2Foutside.md", error("outside")],
    ["/etc/secret.md", error("outside")],
    ["%2Fetc/secret.md", error("outside")],
    ["\\outside.md", error("outside")],
    ["docs\\next.md", error("outside")],
    ["docs%5Cnext.md", error("outside")],
    ["C:/Users/me/notes.md", error("outside")],
    ["C%3A%5Cnotes.md", error("outside")],
  ]],
  ["only Markdown documents without literal queries are supported", "SKILL.md", [
    ["image.png", error("unsupported")],
    ["notes.txt#heading", error("unsupported")],
    ["README", error("unsupported")],
    ["docs/", error("unsupported")],
    ["notes.md.exe", error("unsupported")],
    ["notes.md?raw=1", error("unsupported")],
    ["notes.md?raw=1#heading", error("unsupported")],
    ["?raw=1", error("unsupported")],
  ]],
  ["unsupported schemes never become local documents", "SKILL.md", [
    ["file:///etc/secret.md", error("outside")],
    ["ftp://example.com/notes.md", error("outside")],
    ["javascript:alert(1)", error("outside")],
    ["data:text/markdown,notes.md", error("outside")],
    ["vscode://file/notes.md", error("outside")],
    ["custom+scheme.-:notes.md", error("outside")],
    ["FILE%3A///etc/secret.md", error("outside")],
  ]],
  ["malformed escapes and control characters are invalid", "SKILL.md", [
    ["bad%.md", error("invalid")],
    ["%E0%A4%A.md", error("invalid")],
    ["notes.md#bad%", error("invalid")],
    ["notes%00.md", error("invalid")],
    ["notes.md#bad%0Aanchor", error("invalid")],
    ["notes.md#bad%7Fanchor", error("invalid")],
    ["notes\t.md", error("invalid")],
  ]],
]) {
  test(name, () => {
    for (const [href, expected] of cases) {
      assert.deepEqual(resolveSkillDocumentLink(href, current), expected, href);
    }
  });
}

test("an empty sanitized URL is refused rather than treated as same-document navigation", () => {
  assert.deepEqual(resolveSkillDocumentLink("", "guides/intro.md"), error("invalid"));
});

test("web, mail, and protocol-relative links are left to the browser", () => {
  for (const href of [
    "https://example.com/guide.md#intro",
    "HTTP://example.com/guide.md",
    "mailto:hello@example.com",
    "MAILTO:hello@example.com",
    "//example.com/guide.md",
  ]) {
    assert.deepEqual(resolveSkillDocumentLink(href, "guides/intro.md"), { kind: "external" }, href);
  }
});
