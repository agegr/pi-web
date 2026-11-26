import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// A real extension that registers a section, written into a throwaway agent
// directory so the boot load finds it the way it finds an installed package's.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-sections-agent-"));
const extensionsDir = join(agentDir, "extensions");
await mkdir(extensionsDir, { recursive: true });
// `extensions/*.ts` or `*.js` only: pi does not read an .mjs there.
await writeFile(join(extensionsDir, "boot-section.ts"), `
export default function bootSection(api) {
  const probe = globalThis.__piWebSectionsProbe = {
    factoryRan: true,
    hasApi: typeof api?.registerCommand === "function",
    address: "http://127.0.0.1:30141",
    enabled: false,
    failure: false,
  };
  const registry = globalThis[Symbol.for("@agegr/pi-web/settings-sections/v1")];
  registry.register({
    id: "ext:booted",
    label: { en: "Booted", "zh-CN": "已装载", "zh-TW": "已載入" },
    icon: "server",
    fields: [
      { kind: "readonly", label: { en: "Embedded" }, value: "http://127.0.0.1:30141", mono: true },
      { kind: "text", key: "address", label: { en: "Address" } },
      { kind: "switch", key: "enabled", label: { en: "Enabled" } },
    ],
    read: () => ({
      values: { address: probe.address, enabled: probe.enabled },
      status: { state: "ok", text: { en: "Running" } },
    }),
    apply: (values) => {
      if (typeof values.address !== "string" || !values.address.startsWith("http")) {
        throw new Error("Address must be an http(s) URL");
      }
      probe.address = values.address;
      probe.enabled = values.enabled === true;
    },
    status: () => ({
      state: probe.failure ? "error" : "ok",
      text: { en: probe.failure ? "Stopped" : "Running" },
    }),
  });
}
`, "utf8");

process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false, alias: { "@": process.cwd() } });
const {
  getSettingsSectionsBootLoader,
  getSettingsSectionsBootState,
  getSettingsSectionsRegistry,
  warmSettingsSections,
} = await jiti.import("./settings-sections-host.ts");

test.after(() => rm(agentDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }));

test("loading extensions at server start registers a section with no session", async () => {
  assert.equal(getSettingsSectionsBootState(), "idle");

  await warmSettingsSections({ cwd: agentDir });
  assert.equal(getSettingsSectionsBootState(), "ready");
  // The loader stays for the process: a section's handlers are its closures.
  assert.ok(getSettingsSectionsBootLoader(), "the boot loader is retained");

  // The extension factory ran at load time, not at a session start.
  assert.equal(globalThis.__piWebSectionsProbe.factoryRan, true);
  assert.equal(globalThis.__piWebSectionsProbe.hasApi, true);

  const registry = getSettingsSectionsRegistry();
  const listed = registry.list();
  assert.deepEqual(listed.map((section) => section.id), ["ext:booted"]);
  assert.equal(listed[0].icon, "server");
  assert.equal(listed[0].fields.length, 3);
  // The handlers answer before any AgentSession exists.
  assert.deepEqual(await registry.read("ext:booted"), {
    values: { address: "http://127.0.0.1:30141", enabled: false },
    status: { state: "ok", text: { en: "Running" } },
  });
  assert.deepEqual(await registry.status("ext:booted"), { state: "ok", text: { en: "Running" } });
});

test("applying calls the extension, whose rejection is what the form shows", async () => {
  const registry = getSettingsSectionsRegistry();
  await assert.rejects(
    () => registry.apply("ext:booted", { address: "nope", enabled: true }),
    /Address must be an http\(s\) URL/,
  );
  await registry.apply("ext:booted", { address: "http://127.0.0.1:9", enabled: true });
  assert.equal(globalThis.__piWebSectionsProbe.address, "http://127.0.0.1:9");
  assert.deepEqual(await registry.read("ext:booted"), {
    values: { address: "http://127.0.0.1:9", enabled: true },
    status: { state: "ok", text: { en: "Running" } },
  });
});

test("an unknown section is refused, and a second load is free", async () => {
  const registry = getSettingsSectionsRegistry();
  assert.equal(await registry.read("ext:missing"), null);
  assert.equal(await registry.status("ext:missing"), undefined);
  await assert.rejects(() => registry.apply("ext:missing", {}), /is not registered/);
  await assert.rejects(() => registry.apply("ext:booted", []), /must be an object/);

  // Not forced: the first answer already covers this process.
  await warmSettingsSections();
  assert.equal(getSettingsSectionsBootState(), "ready");
  assert.equal(registry.list().length, 1);
});

test("a registration this build cannot draw is refused, leaving the registry as it was", () => {
  const registry = getSettingsSectionsRegistry();
  assert.throws(
    () => registry.register({ id: "ext:no-handlers", label: { en: "No handlers" }, fields: [{ kind: "text", key: "a", label: { en: "A" } }] }),
    /must implement read\(\)/,
  );
  assert.throws(
    () => registry.register({ id: "ext:bad-field", label: { en: "Bad" }, fields: [{ kind: "textarea", key: "a", label: { en: "A" } }], read: async () => ({}), apply: async () => {} }),
    /is not one this build can render/,
  );
  assert.equal(registry.list().length, 1);
});
