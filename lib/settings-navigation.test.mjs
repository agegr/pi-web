import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getLastSettingsSection,
  getLastSettingsSelection,
  settingsSectionRequiresProject,
  SETTINGS_SECTION_VALUES,
  setLastSettingsSection,
  setLastSettingsSelection,
} = await jiti.import("./settings-navigation.ts");

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("restores the last settings section and falls back without a project", () => {
  const storage = createStorage();

  setLastSettingsSection("models", storage);
  assert.equal(getLastSettingsSection(null, storage), "models");

  setLastSettingsSection("skills", storage);
  assert.equal(getLastSettingsSection("/project", storage), "skills");
  assert.equal(getLastSettingsSection(null, storage), "general");

  setLastSettingsSection("agents", storage);
  assert.equal(getLastSettingsSection("/project", storage), "agents");
});

test("keeps project settings selections isolated by cwd", () => {
  const storage = createStorage();

  setLastSettingsSelection("skills", "/one/skill.md", "/project-one", storage);
  setLastSettingsSelection("skills", "/two/skill.md", "/project-two", storage);

  assert.equal(getLastSettingsSelection("skills", "/project-one", storage), "/one/skill.md");
  assert.equal(getLastSettingsSelection("skills", "/project-two", storage), "/two/skill.md");
  assert.equal(getLastSettingsSelection("skills", "/project-three", storage), null);
});

test("shares the models selection globally", () => {
  const storage = createStorage();
  const selection = JSON.stringify({ type: "provider", name: "custom" });

  setLastSettingsSelection("models", selection, "/project-one", storage);

  assert.equal(getLastSettingsSelection("models", "/project-two", storage), selection);
  assert.equal(getLastSettingsSelection("models", null, storage), selection);
});

test("restores Settings › MCP without a project, since it lists the global file alone", () => {
  const storage = createStorage();

  setLastSettingsSection("mcp", storage);
  assert.equal(getLastSettingsSection(null, storage), "mcp");
  assert.equal(getLastSettingsSection("/project", storage), "mcp");
  assert.ok(SETTINGS_SECTION_VALUES.includes("mcp"));
  assert.equal(settingsSectionRequiresProject("mcp"), false);
  assert.equal(settingsSectionRequiresProject("models"), false);
  assert.equal(settingsSectionRequiresProject("general"), false);
  for (const section of ["skills", "agents", "plugins"]) {
    assert.equal(settingsSectionRequiresProject(section), true, section);
  }
});

test("keeps the MCP selection per project and once more for no project", () => {
  const storage = createStorage();

  setLastSettingsSelection("mcp", "global\0github", null, storage);
  setLastSettingsSelection("mcp", "project\0lint", "/project-one", storage);
  setLastSettingsSelection("mcp", "codemode", "/project-two", storage);

  assert.equal(getLastSettingsSelection("mcp", null, storage), "global\0github");
  assert.equal(getLastSettingsSelection("mcp", undefined, storage), "global\0github");
  assert.equal(getLastSettingsSelection("mcp", "/project-one", storage), "project\0lint");
  assert.equal(getLastSettingsSelection("mcp", "/project-two", storage), "codemode");
  assert.equal(getLastSettingsSelection("mcp", "/project-three", storage), null);
  // A project section still remembers nothing without a project.
  setLastSettingsSelection("plugins", "key", null, storage);
  assert.equal(getLastSettingsSelection("plugins", null, storage), null);
  // A folder literally named "mcp" cannot reach the no-project key.
  assert.equal(getLastSettingsSelection("mcp", "mcp", storage), null);
});

test("ignores malformed and unavailable browser storage", () => {
  const malformed = createStorage({ "pi-web:settings-navigation": "{" });
  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };

  assert.equal(getLastSettingsSection("/project", malformed), "general");
  assert.equal(getLastSettingsSelection("plugins", "/project", malformed), null);
  assert.equal(getLastSettingsSection("/project", unavailable), "general");
  assert.doesNotThrow(() => setLastSettingsSection("plugins", unavailable));
  assert.doesNotThrow(() => setLastSettingsSelection("plugins", "key", "/project", unavailable));
});
