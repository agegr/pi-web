import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { orderSkillsByDormancy } = await jiti.import("./SkillsConfig.tsx");

test("lists active skills before dormant skills while preserving their order", () => {
  const skills = [
    { name: "dormant-a", disableModelInvocation: true },
    { name: "active-a", disableModelInvocation: false },
    { name: "dormant-b", disableModelInvocation: true },
    { name: "active-b", disableModelInvocation: false },
  ];

  assert.deepEqual(
    orderSkillsByDormancy(skills).map((skill) => skill.name),
    ["active-a", "active-b", "dormant-a", "dormant-b"],
  );
});

test("renders dormant skills directly without a collapsible section", () => {
  assert.doesNotMatch(source, /dormantGroupsOpen|i18n\.dormant/);
  assert.match(source, /orderSkillsByDormancy\(grpSkills\)\.map\(renderSkillRow\)/);
});
