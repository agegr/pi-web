import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

async function file(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

function skill(name) {
  return `---\nname: ${name}\ndescription: DESC_${name}\n---\nBODY_${name}\n`;
}

async function npmPackage(agentDir, name, { tools = [], skillName }) {
  const root = join(agentDir, "npm", "node_modules", name);
  const extensions = tools.map((_, i) => `./entry-${i}/package-entry-${i}${name.startsWith("@") ? "-scoped" : ""}.mjs`);
  await file(root, "package.json", JSON.stringify({ name, version: "1.2.3", pi: { extensions, skills: ["./skills"] } }));
  for (const [i, tool] of tools.entries()) {
    await file(root, extensions[i], `export default function (pi) {
  pi.registerTool({ name: "${tool}", label: "${tool}", description: "${tool}", parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "${tool}" }] }) });
}
`);
  }
  await file(root, `skills/${skillName}/SKILL.md`, skill(skillName));
}

const profiles = [
  { name: "unscoped", extensions: "plain-adapter", tools: ["plain_tool"] },
  { name: "scoped", extensions: "@team/adapter", tools: ["ask_user", "other_tool"] },
  { name: "unscoped-name", extensions: "adapter", tools: ["ask_user", "other_tool"] },
  { name: "one-extension", extensions: "package-entry-1-scoped", tools: ["other_tool"] },
  { name: "named", extensions: "package-entry-0", tools: ["plain_tool"], named: true },
  { name: "empty-project-packages", extensions: "plain-adapter", tools: ["plain_tool"], emptyProject: true },
  { name: "shutdown-changes-packages", extensions: "plain-adapter", tools: ["plain_tool"], changeOnReload: true },
  { name: "shutdown-changes-packages-on-command-reload", extensions: "plain-adapter", tools: ["plain_tool"], changeOnReload: true, commandReload: true },
  { name: "trust-revoked-on-reopen", extensions: "plain-adapter", tools: ["plain_tool"], revokeOnReopen: true },
  { name: "no-list", extensions: "true", tools: ["ask_user", "other_tool", "plain_tool"] },
];

for (const profile of profiles) {
  test(`package scope (${profile.name}) on spawn, reload, live resume and RPC reopen`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-package-scope-"));
    const agentDir = join(root, "agent"), cwd = join(root, "project");
    const previousDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const jiti = createJiti(import.meta.url);
    let parent, child;
    try {
      await file(agentDir, "agents/settings.json", '{"builtInEnabled":true}');
      const packages = ["npm:plain-adapter", "npm:@team/adapter@1.2.3", "npm:reference-only"];
      const initial = profile.changeOnReload ? [] : packages;
      await file(agentDir, "settings.json", JSON.stringify({ packages: initial }));
      if (profile.emptyProject) await file(cwd, ".pi/settings.json", '{"packages":[]}');
      await npmPackage(agentDir, "plain-adapter", { tools: ["plain_tool"], skillName: "plain-skill" });
      await npmPackage(agentDir, "@team/adapter", { tools: ["ask_user", "other_tool"], skillName: "ask-user" });
      await npmPackage(agentDir, "reference-only", { skillName: "reference-only" });
      // Exercise actual delegated commands without selecting or contacting a model.
      const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
      const trustStore = new ProjectTrustStore(agentDir);
      const revokeMarker = join(agentDir, "revoke-trust");
      await file(agentDir, "extensions/resource-check.ts", `import { existsSync, writeFileSync } from "node:fs";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
export default function (pi) {
  if (existsSync(${JSON.stringify(revokeMarker)})) new ProjectTrustStore(${JSON.stringify(agentDir)}).set(${JSON.stringify(cwd)}, false);
  ${profile.changeOnReload ? `pi.on("session_shutdown", ({ reason }) => {
    if (reason === "reload") writeFileSync(${JSON.stringify(join(agentDir, "settings.json"))}, ${JSON.stringify(JSON.stringify({ packages }))});
  });` : ""}
  pi.registerCommand("reload-resource-check", { description: "Reload resources", handler: async (_args, ctx) => ctx.reload() });
  pi.registerCommand("resource-check", { description: "Record execution", handler: async (args) => {
    pi.appendEntry("resource-check", { args });
  } });
}
`);
      await file(agentDir, "skills/user-notes/SKILL.md", skill("user-notes"));
      await file(cwd, ".pi/skills/project-notes/SKILL.md", skill("project-notes"));
      const extensions = profile.extensions === "true" ? "true" : JSON.stringify([profile.extensions, "resource-check"]);
      await file(agentDir, `agents/${profile.name}.md`, `---
description: Resource scope
tools: read
extensions: ${extensions}
skills: ${profile.named ? "ask-user, plain-skill, reference-only, user-notes, project-notes" : "true"}
---
Resource scope profile
`);
      const { trustProject } = await jiti.import("./project-trust.ts");
      trustProject(cwd, agentDir);
      const { getRpcSession, startRpcSession } = await jiti.import("./rpc-manager.ts");
      parent = (await startRpcSession("", "", cwd)).session;
      await parent.waitUntilReady();
      const definition = parent.inner.getToolDefinition("Agent");
      assert.ok(definition);
      const callAgent = (id, params) => definition.execute(id, { prompt: `/resource-check ${id}`, description: "resource scope", ...params }, undefined, undefined, parent.inner.extensionRunner.createContext());
      const spawned = await callAgent("spawn", { subagent_type: profile.name });
      assert.ok(spawned.details?.sessionId, JSON.stringify(spawned.content));
      const id = spawned.details.sessionId;
      child = getRpcSession(id);
      assert.ok(child);
      const executedChecks = () => child.inner.sessionManager.getEntries()
        .filter((entry) => entry.type === "custom" && entry.customType === "resource-check")
        .map((entry) => entry.data.args);
      assert.equal(spawned.details.status, "completed", JSON.stringify(spawned.content));
      assert.deepEqual(executedChecks(), ["spawn"]);
      const check = async (stage) => {
        const { inner } = child;
        const tools = ["ask_user", "other_tool", "plain_tool"].filter((name) => inner.getActiveToolNames().includes(name));
        assert.deepEqual(tools, profile.tools, stage);
        // An extensions list scopes extensions only: pi filters a package's resource types
        // independently, so every package's skills stay, whichever extensions were dropped.
        const visible = ["ask-user", "plain-skill", "reference-only", "user-notes", "project-notes"]
          .filter((name) => !(stage === "RPC reopen" && profile.revokeOnReopen && name === "project-notes"));
        if (profile.named) {
          const { systemPromptOptions } = await inner.extensionRunner.emitBeforeAgentStart({ messageType: "user", prompt: "inspect resources" }, { cwd, selectedTools: inner.getActiveToolNames() });
          const prompt = systemPromptOptions.forceSystemPrompt;
          assert.doesNotMatch(prompt, /not found in SDK discovery/, stage);
          for (const name of visible) assert.ok(prompt.includes(`BODY_${name}`), `${stage}: ${name}`);
          assert.deepEqual(inner.resourceLoader.getSkills().skills, [], stage);
        } else {
          assert.deepEqual(inner.resourceLoader.getSkills().skills.map(({ name }) => name).sort(), visible.sort(), stage);
          for (const name of visible) assert.ok(inner.systemPrompt.includes(`DESC_${name}`), `${stage}: ${name}`);
        }
      };
      if (!profile.changeOnReload) await check("spawn");
      else assert.equal(child.inner.getActiveToolNames().includes("plain_tool"), false);
      if (profile.commandReload) await child.inner.prompt("/reload-resource-check");
      else await child.send({ type: "reload" });
      await check("reload");
      const resumed = await callAgent("resume", { resume: id });
      assert.equal(resumed.details?.sessionId, id, JSON.stringify(resumed.content));
      assert.equal(resumed.details?.status, "completed");
      assert.deepEqual(executedChecks(), ["spawn", "resume"]);
      assert.equal(getRpcSession(id), child);
      await check("resume");
      const sessionFile = child.sessionFile;
      await child.shutdown();
      if (profile.revokeOnReopen) {
        assert.equal(trustStore.get(cwd), true);
        await file(cwd, ".pi/settings.json", '{"packages":["npm:is-number@7.0.0"]}');
        await writeFile(revokeMarker, "");
      }
      child = (await startRpcSession(id, sessionFile)).session;
      if (profile.revokeOnReopen) {
        assert.equal(trustStore.get(cwd), false, "global bootstrap factory revoked trust");
        assert.equal(child.inner.settingsManager.isProjectTrusted(), false);
        await assert.rejects(access(join(cwd, ".pi", "npm", "package.json")), { code: "ENOENT" });
      }
      await child.waitUntilReady();
      assert.deepEqual(executedChecks(), ["spawn", "resume"]);
      await check("RPC reopen");
    } finally {
      await child?.shutdown();
      await parent?.shutdown();
      if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousDir;
      await rm(root, { recursive: true, force: true });
    }
  });
}
