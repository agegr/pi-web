import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import {
  getLaunchResourceLoaderOptions,
  parseLaunchAgentOptions,
} from "./launch-agent-options.ts";

test("launch agent options default to an empty object", () => {
  assert.deepEqual(parseLaunchAgentOptions(undefined), {});
});

test("launch agent options preserve validated session-construction settings", () => {
  const options = {
    model: "anthropic/claude-sonnet",
    thinking: "high",
    models: ["anthropic/*"],
    tools: ["read", "bash"],
    excludeTools: ["write"],
    noSkills: true,
    noContextFiles: true,
    appendSystemPrompt: ["Be concise."],
  };

  assert.deepEqual(parseLaunchAgentOptions(JSON.stringify(options)), options);
});

test("no-skills and no-context-files reach Pi's DefaultResourceLoader", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-launch-options-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  try {
    await mkdir(join(agentDir, "skills", "sample"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, "AGENTS.md"), "# Project context\n");
    await writeFile(
      join(agentDir, "skills", "sample", "SKILL.md"),
      "---\nname: sample\ndescription: sample\n---\n# Sample\n",
    );

    const launchOptions = parseLaunchAgentOptions(JSON.stringify({
      noSkills: true,
      noContextFiles: true,
    }));
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      ...getLaunchResourceLoaderOptions(launchOptions),
    });
    await loader.reload();

    assert.deepEqual(loader.getSkills().skills, []);
    assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("launch agent options reject malformed internal handoff values", () => {
  assert.throws(() => parseLaunchAgentOptions("{"), /Invalid PI_WEB_AGENT_OPTIONS JSON/);
  assert.throws(() => parseLaunchAgentOptions("[]"), /must contain a JSON object/);
  assert.throws(() => parseLaunchAgentOptions('{"tools":"read"}'), /tools must be an array/);
  assert.throws(() => parseLaunchAgentOptions('{"noSkills":"yes"}'), /noSkills must be a boolean/);
  assert.throws(() => parseLaunchAgentOptions('{"thinking":"extreme"}'), /Invalid thinking level/);
  assert.throws(() => parseLaunchAgentOptions('{"noTools":"sometimes"}'), /noTools must be/);
});
