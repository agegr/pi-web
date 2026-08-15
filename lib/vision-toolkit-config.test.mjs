import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });

function createTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-vision-toolkit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function withEnv(t, vars) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function loadHelper() {
  return jiti.import("./vision-toolkit-config.ts");
}

function settings(overrides = {}) {
  return {
    protocol: "chat_completions",
    baseUrl: "https://vision.example.test/v1",
    model: "gemini-flash",
    language: "zh",
    ...overrides,
  };
}

test("parse keeps comments and unknown keys", async (t) => {
  const root = createTempRoot(t);
  const envPath = join(root, "env");
  writeFileSync(envPath, [
    "# keep this comment",
    "CUSTOM_FLAG=stay",
    "VISION_BASE_URL=https://old.example.test/v1",
    "VISION_API_KEY=sk-keep-me",
    "VISION_MODEL=old-model",
    "",
  ].join("\n"));
  withEnv(t, { VISION_ENV_FILE: envPath, VISION_API_KEY: undefined });

  const { writeVisionToolkitSettings } = await loadHelper();
  writeVisionToolkitSettings(settings({
    baseUrl: "https://new.example.test/v1",
    model: "new-model",
  }));

  const saved = readFileSync(envPath, "utf8");
  assert.match(saved, /^# keep this comment$/m);
  assert.match(saved, /^CUSTOM_FLAG=stay$/m);
  assert.match(saved, /^VISION_BASE_URL=https:\/\/new\.example\.test\/v1$/m);
  assert.match(saved, /^VISION_API_KEY=sk-keep-me$/m);
  assert.match(saved, /^VISION_MODEL=new-model$/m);
});

test("blank apiKey on write does not wipe stored key", async (t) => {
  const root = createTempRoot(t);
  const envPath = join(root, "env");
  writeFileSync(envPath, "VISION_API_KEY=sk-stored-secret\nVISION_MODEL=flash\n");
  withEnv(t, { VISION_ENV_FILE: envPath, VISION_API_KEY: undefined });

  const { writeVisionToolkitSettings } = await loadHelper();
  writeVisionToolkitSettings(settings({ model: "flash-2" }), "");
  writeVisionToolkitSettings(settings({ model: "flash-3" }));

  const saved = readFileSync(envPath, "utf8");
  assert.match(saved, /^VISION_API_KEY=sk-stored-secret$/m);
  assert.match(saved, /^VISION_MODEL=flash-3$/m);
});

test("snapshot never includes apiKey or VISION_API_KEY", async (t) => {
  const root = createTempRoot(t);
  const envPath = join(root, "env");
  writeFileSync(envPath, "VISION_API_KEY=sk-must-not-leak\nVISION_BASE_URL=https://vision.example.test/v1\n");
  withEnv(t, { VISION_ENV_FILE: envPath, VISION_API_KEY: undefined });

  const { readVisionToolkitSnapshot } = await loadHelper();
  const snapshot = readVisionToolkitSnapshot();
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.credential.configured, true);
  assert.equal(snapshot.credential.source, "file");
  assert.equal("apiKey" in snapshot, false);
  assert.equal("apiKey" in snapshot.credential, false);
  assert.equal("apiKey" in snapshot.settings, false);
  assert.doesNotMatch(serialized, /apiKey/);
  assert.doesNotMatch(serialized, /VISION_API_KEY/);
  assert.doesNotMatch(serialized, /sk-must-not-leak/);
});

test("reject quoted, NAME=value, whitespace-only, and non-printable keys", async () => {
  const { validateApiKey } = await loadHelper();

  assert.equal(validateApiKey(""), undefined);
  assert.match(validateApiKey("   "), /./);
  assert.match(validateApiKey('"sk-quoted"'), /./);
  assert.match(validateApiKey("'sk-quoted'"), /./);
  assert.match(validateApiKey("VISION_API_KEY=sk-value"), /./);
  assert.match(validateApiKey("sk with spaces"), /./);
  assert.match(validateApiKey("sk-new\nline"), /./);
  assert.match(validateApiKey("sk-key\u0007bell"), /./);
  assert.equal(validateApiKey("sk-plain-key_123"), undefined);
});

test("create file as 0600 when missing", async (t) => {
  const root = createTempRoot(t);
  const dir = join(root, "agent-vision-toolkit");
  const envPath = join(dir, "env");
  withEnv(t, { VISION_ENV_FILE: envPath, VISION_API_KEY: undefined });

  const { writeVisionToolkitSettings, readVisionToolkitSnapshot } = await loadHelper();
  writeVisionToolkitSettings(settings(), "sk-new-file-key");

  const snapshot = readVisionToolkitSnapshot();
  assert.equal(snapshot.configPath, envPath);
  assert.equal(snapshot.credential.configured, true);
  assert.equal(readFileSync(envPath, "utf8").includes("sk-new-file-key"), true);
  if (process.platform !== "win32") {
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(envPath).mode & 0o777, 0o600);
  }
});

test("source is env when process env has VISION_API_KEY and file does not", async (t) => {
  const root = createTempRoot(t);
  const envPath = join(root, "env");
  writeFileSync(envPath, "VISION_BASE_URL=https://vision.example.test/v1\nVISION_MODEL=flash\n");
  withEnv(t, { VISION_ENV_FILE: envPath, VISION_API_KEY: "sk-from-process-env" });

  const { readVisionToolkitSnapshot } = await loadHelper();
  const snapshot = readVisionToolkitSnapshot();

  assert.equal(snapshot.credential.configured, true);
  assert.equal(snapshot.credential.source, "env");
  assert.equal(snapshot.credential.writable, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /sk-from-process-env/);
});

test("saving without a file key does not write an empty VISION_API_KEY assignment", async (t) => {
  const root = createTempRoot(t);
  const envPath = join(root, "env");
  writeFileSync(envPath, "VISION_BASE_URL=https://vision.example.test/v1\nVISION_MODEL=flash\n");
  withEnv(t, { VISION_ENV_FILE: envPath, VISION_API_KEY: "sk-from-process-env" });

  const { writeVisionToolkitSettings, readStoredVisionApiKey } = await loadHelper();
  writeVisionToolkitSettings(settings({ model: "flash-2" }));

  const saved = readFileSync(envPath, "utf8");
  assert.doesNotMatch(saved, /^VISION_API_KEY=/m);
  assert.match(saved, /^VISION_MODEL=flash-2$/m);
  assert.equal(readStoredVisionApiKey(), "sk-from-process-env");
});

test("saving drops a blank VISION_API_KEY assignment so the process env key remains effective", async (t) => {
  const root = createTempRoot(t);
  const envPath = join(root, "env");
  writeFileSync(envPath, "VISION_API_KEY=\nVISION_MODEL=flash\n");
  withEnv(t, { VISION_ENV_FILE: envPath, VISION_API_KEY: "sk-from-process-env" });

  const { writeVisionToolkitSettings, readStoredVisionApiKey } = await loadHelper();
  writeVisionToolkitSettings(settings({ model: "flash-2" }));

  const saved = readFileSync(envPath, "utf8");
  assert.doesNotMatch(saved, /^VISION_API_KEY=/m);
  assert.equal(readStoredVisionApiKey(), "sk-from-process-env");
});

test("empty process env does not wipe a file key", async (t) => {
  const root = createTempRoot(t);
  const envPath = join(root, "env");
  writeFileSync(envPath, "VISION_API_KEY=sk-file-secret\nVISION_MODEL=flash\n");
  withEnv(t, { VISION_ENV_FILE: envPath, VISION_API_KEY: "" });

  const { writeVisionToolkitSettings, readStoredVisionApiKey } = await loadHelper();
  writeVisionToolkitSettings(settings({ model: "flash-2" }), "");

  assert.match(readFileSync(envPath, "utf8"), /^VISION_API_KEY=sk-file-secret$/m);
  assert.equal(readStoredVisionApiKey(), "sk-file-secret");
});
