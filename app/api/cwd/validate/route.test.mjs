import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");
const { projectIdentityKey } = await jiti.import("../../../../lib/project-identity.ts");

test("validated cwd responses include server-resolved project identity", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-cwd-validate-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const response = await POST(new Request("http://localhost/api/cwd/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    cwd,
    projectRoot: cwd,
    projectKey: projectIdentityKey(cwd),
  });
});
