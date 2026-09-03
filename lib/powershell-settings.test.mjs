import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  isPowerShellToolEnabled,
  readPowerShellToolEnabled,
  resolveShellTools,
  writePowerShellToolEnabled,
} = await createJiti(import.meta.url).import("./powershell-settings.ts");

test("PowerShell is opt-in on Windows and never selected on other platforms", () => {
  assert.equal(isPowerShellToolEnabled(undefined, "win32"), false);
  assert.equal(isPowerShellToolEnabled(["read", "powershell"], "win32"), true);
  assert.equal(isPowerShellToolEnabled(["read", "bash", "powershell"], "win32"), false);
  assert.equal(isPowerShellToolEnabled(["read", "powershell"], "darwin"), false);
  assert.deepEqual(
    resolveShellTools(["read", "bash", "edit"], ["read", "powershell"], "win32"),
    ["read", "powershell", "edit"],
  );
  assert.deepEqual(
    resolveShellTools(["read", "bash", "edit"], ["read", "powershell"], "darwin"),
    ["read", "bash", "edit"],
  );
});

test("the setting preserves unrelated config and switches defaultTools both ways", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-"));
  const settingsPath = join(root, "settings.json");

  assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), false);
  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultTools: ["read", "powershell", "edit", "write"],
  });

  const configured = JSON.parse(await readFile(settingsPath, "utf8"));
  configured.unrelated = { keep: true };
  await writeFile(settingsPath, JSON.stringify(configured));
  await writePowerShellToolEnabled(false, settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    defaultTools: ["read", "bash", "edit", "write"],
    unrelated: { keep: true },
  });
});

test("enabling PowerShell adds it when a custom defaultTools list has no shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-custom-"));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["read", "grep"] }));

  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(
    JSON.parse(await readFile(settingsPath, "utf8")).defaultTools,
    ["read", "grep", "powershell"],
  );
});

test("invalid defaultTools are rejected without overwriting the settings file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-invalid-"));
  const settingsPath = join(root, "settings.json");
  const original = JSON.stringify({ defaultTools: "bash", unrelated: true });
  await writeFile(settingsPath, original);

  await assert.rejects(
    writePowerShellToolEnabled(true, settingsPath, "win32"),
    /defaultTools must be an array of strings/,
  );
  assert.equal(await readFile(settingsPath, "utf8"), original);
});
