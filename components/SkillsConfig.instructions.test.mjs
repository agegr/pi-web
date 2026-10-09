import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { skillInstructionsBody } = await jiti.import("./SkillsConfig.tsx");

test("skill instructions omit frontmatter and preserve the Markdown body", () => {
  assert.equal(
    skillInstructionsBody("---\nname: example\ndescription: Example\n---\n\n# Instructions\n\n- One\n"),
    "# Instructions\n\n- One",
  );
});

test("the selected skill is loaded lazily and rendered with the shared Markdown renderer", () => {
  assert.match(source, /fetch\(`\/api\/skills\/content\?\$\{params\}`/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /<MarkdownBody className="skill-instructions" cwd=\{skill\.baseDir\}>/);
});
