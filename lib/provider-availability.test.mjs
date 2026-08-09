import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./provider-availability.ts");
  } catch {
    return import("./provider-availability.ts");
  }
}

const { getDisabledProviders, normalizeDisabledProviders, readModelsUiState } = await loadSubject();

test("normalizes disabled provider names", () => {
  assert.deepEqual(normalizeDisabledProviders([
    " anthropic ",
    "",
    "anthropic",
    null,
    "  acme-gateway",
    42,
  ]), ["anthropic", "acme-gateway"]);
  assert.deepEqual(normalizeDisabledProviders(undefined), []);
});

test("reads and exposes disabled providers from the UI state sidecar", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-models-ui-"));
  await writeFile(join(agentDir, "models-ui.json"), JSON.stringify({
    disabledProviders: [" anthropic ", "anthropic", "acme-gateway"],
  }));

  assert.deepEqual(readModelsUiState(agentDir), {
    disabledProviders: ["anthropic", "acme-gateway"],
  });
  assert.deepEqual([...getDisabledProviders(agentDir)], ["anthropic", "acme-gateway"]);
});

test("ignores a missing or malformed UI state sidecar", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-web-models-ui-"));
  assert.deepEqual(readModelsUiState(agentDir), { disabledProviders: [] });

  await writeFile(join(agentDir, "models-ui.json"), "not json");
  assert.deepEqual(readModelsUiState(agentDir), { disabledProviders: [] });
});
