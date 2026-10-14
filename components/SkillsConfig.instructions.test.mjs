import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { skillInstructionsBody } = await jiti.import("./SkillDocumentReader.tsx");

test("skill instructions omit frontmatter and preserve the Markdown body", () => {
  assert.equal(
    skillInstructionsBody("---\nname: example\ndescription: Example\n---\n\n# Instructions\n\n- One\n"),
    "# Instructions\n\n- One",
  );
});
