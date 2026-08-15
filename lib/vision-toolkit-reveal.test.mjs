import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  moduleCache: false,
});

async function loadRoute() {
  return jiti.import("../app/api/vision-toolkit/reveal/route.ts");
}

function fakeChild(mode) {
  const child = new EventEmitter();
  child.unref = () => {
    child.unrefed = true;
  };
  queueMicrotask(() => {
    if (mode === "error") {
      const error = new Error("spawn ENOENT");
      error.code = "ENOENT";
      child.emit("error", error);
      return;
    }
    child.emit("spawn");
  });
  return child;
}

test("reveal commands select the config file in the system file manager", async () => {
  const { revealConfigFileCommand } = await loadRoute();
  assert.deepEqual(revealConfigFileCommand("/tmp/env", "darwin"), { command: "open", args: ["-R", "/tmp/env"] });
  assert.deepEqual(revealConfigFileCommand("/tmp/env", "win32"), { command: "explorer", args: ["/select,/tmp/env"] });
  assert.deepEqual(revealConfigFileCommand("/tmp/env", "linux"), { command: "xdg-open", args: ["/tmp"] });
});

test("waitForSpawn resolves after spawn and rejects opener startup errors", async () => {
  const { waitForSpawn } = await loadRoute();
  const ok = fakeChild("spawn");
  await waitForSpawn(ok);
  assert.equal(ok.unrefed, true);

  await assert.rejects(() => waitForSpawn(fakeChild("error")), /ENOENT/);
});

test("revealConfigFile reports injected opener failures", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-vision-reveal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const envPath = join(root, "env");
  writeFileSync(envPath, "VISION_MODEL=flash\n");
  const previous = process.env.VISION_ENV_FILE;
  process.env.VISION_ENV_FILE = envPath;
  t.after(() => {
    if (previous === undefined) delete process.env.VISION_ENV_FILE;
    else process.env.VISION_ENV_FILE = previous;
  });

  const { revealConfigFile } = await loadRoute();
  await assert.rejects(
    () => revealConfigFile(() => fakeChild("error")),
    /ENOENT/,
  );
});

test("reveal POST requires JSON content type", async () => {
  const { POST } = await loadRoute();
  const response = await POST(new Request("http://127.0.0.1/api/vision-toolkit/reveal", {
    method: "POST",
    headers: { host: "127.0.0.1" },
  }));
  assert.equal(response.status, 415);
});
