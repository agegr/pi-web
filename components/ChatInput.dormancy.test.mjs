import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { buildSlashCommandLayout, filterSlashCommands } = await jiti.import("./ChatInput.tsx");

test("uses the rendered slash command order for selection indices", () => {
  const dormant = {
    name: "skill:alpha",
    description: "Dormant skill",
    source: "skill",
  };
  const active = {
    name: "skill:beta",
    description: "Active skill",
    source: "skill",
  };
  const builtin = {
    name: "compact",
    description: "Compact",
    source: "builtin",
  };

  const layout = buildSlashCommandLayout(
    [dormant, active, builtin],
    { alpha: true, beta: false },
  );

  assert.deepEqual(
    layout.commands.map((command) => command.name),
    ["compact", "skill:beta", "skill:alpha"],
  );
  assert.deepEqual(
    layout.groups.flatMap((group) => group.items.map((item) => item.index)),
    [0, 1, 2],
  );
});

test("search keeps an exact dormant skill ahead of an active prefix match", () => {
  const commands = [
    { name: "skill:review", description: "Review", source: "skill" },
    { name: "skill:review-pr", description: "Review a PR", source: "skill" },
  ];
  const matches = filterSlashCommands(commands, "review", (key) => key);
  const layout = buildSlashCommandLayout(matches, { review: true }, "review");
  assert.deepEqual(layout.commands.map((command) => command.name), ["skill:review", "skill:review-pr"]);
  assert.deepEqual(layout.groups[0].items.map((item) => item.index), [0, 1]);
});

test("search preserves ranking for explicit skill prefixes and description matches", () => {
  const commands = [
    { name: "skill:alpha", description: "Inspect changes", source: "skill" },
    { name: "skill:alpha-extra", description: "Inspect changes", source: "skill" },
  ];
  for (const query of ["skill:alpha", "inspect"]) {
    const matches = filterSlashCommands(commands, query, (key) => key);
    const layout = buildSlashCommandLayout(matches, { alpha: true }, query);
    assert.deepEqual(layout.commands, matches);
  }
});
