import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  builtinToolsOf,
  isPowerShellToolEnabled,
  readPowerShellToolEnabled,
  resolveDefaultToolEntries,
  resolveShellTools,
  withBuiltinTools,
  writeBuiltinTools,
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

test("defaultTools entries resolve like pi's +name / -name modifiers", () => {
  assert.deepEqual(resolveDefaultToolEntries([]), []);
  assert.deepEqual(resolveDefaultToolEntries(["read", "grep"]), ["read", "grep"]);
  assert.deepEqual(resolveDefaultToolEntries(["+codemode"]), ["read", "bash", "edit", "write", "codemode"]);
  assert.deepEqual(resolveDefaultToolEntries(["-bash", "+powershell"]), ["read", "edit", "write", "powershell"]);
  assert.deepEqual(resolveDefaultToolEntries(["read", "+grep", "-read"]), ["grep"]);
});

test("the PowerShell switch reads and rewrites a modifier-only defaultTools list", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-powershell-modifiers-"));
  const settingsPath = join(root, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["-bash", "+powershell"] }));
  assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), true);

  await writeFile(settingsPath, JSON.stringify({ defaultTools: ["+codemode"] }));
  assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), false);
  await writePowerShellToolEnabled(true, settingsPath, "win32");
  assert.deepEqual(
    JSON.parse(await readFile(settingsPath, "utf8")).defaultTools,
    ["read", "powershell", "edit", "write", "codemode"],
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

test("the built-in tool switches edit only built-in entries, as modifiers unless a plain name is kept", () => {
  assert.deepEqual(builtinToolsOf(undefined, "darwin"), ["read", "edit", "write", "bash"]);
  assert.deepEqual(builtinToolsOf(["-bash", "+grep", "+codemode"], "darwin"), ["read", "grep", "edit", "write"]);
  // pi's defaults remove the key; other entries stay as they are.
  assert.equal(withBuiltinTools(undefined, ["read", "edit", "write", "bash"], "darwin"), undefined);
  assert.equal(withBuiltinTools(["read", "bash", "edit", "write", "grep"], ["read", "edit", "write", "bash"], "darwin"), undefined);
  assert.deepEqual(withBuiltinTools(["+codemode", "-ls"], ["read", "bash"], "darwin"), ["+codemode", "-edit", "-write"]);
  assert.deepEqual(withBuiltinTools(["+codemode"], [], "darwin"), ["+codemode", "-read", "-bash", "-edit", "-write"]);
  assert.deepEqual(withBuiltinTools(undefined, [], "darwin"), ["-read", "-bash", "-edit", "-write"]);
  // Beside an extension's plain name the built-ins are plain, or they would drop out.
  assert.deepEqual(withBuiltinTools(["lookup", "read", "-codemode"], ["read", "grep"], "darwin"), ["read", "grep", "lookup", "-codemode"]);
  // powershell is a built-in only on Windows.
  assert.deepEqual(withBuiltinTools(["-bash", "+powershell"], ["read", "edit", "write", "bash"], "darwin"), ["+powershell"]);
});

test("on Windows the shell switch keeps PowerShell while its switch is on", async () => {
  assert.deepEqual(builtinToolsOf(["-bash", "+powershell"], "win32"), ["read", "edit", "write", "bash"]);
  assert.deepEqual(withBuiltinTools(["-bash", "+powershell"], ["read", "grep", "bash"], "win32"), ["-bash", "-edit", "-write", "+grep", "+powershell"]);
  assert.deepEqual(withBuiltinTools(["read", "powershell", "edit", "write"], ["read", "bash"], "win32"), ["-bash", "-edit", "-write", "+powershell"]);
  assert.deepEqual(withBuiltinTools(["read", "powershell"], ["read"], "win32"), ["-bash", "-edit", "-write"]);

  const root = await mkdtemp(join(tmpdir(), "pi-web-builtin-tools-"));
  const settingsPath = join(root, "settings.json");
  await writePowerShellToolEnabled(true, settingsPath, "win32");
  await writeBuiltinTools(["read", "ls", "bash"], settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { defaultTools: ["-bash", "-edit", "-write", "+ls", "+powershell"] });
  assert.equal(await readPowerShellToolEnabled(settingsPath, "win32"), true);
  await writePowerShellToolEnabled(false, settingsPath, "win32");
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).defaultTools, ["read", "ls", "bash"]);
});
