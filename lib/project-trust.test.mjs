import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// This module gates repository-controlled code execution, so the wiring is
// asserted by source inspection (like rpc-manager.test.mjs) rather than by
// loading the full SDK runtime.

test("projectTrustReloadOptions denies untrusted projects and skips clean ones", async () => {
  const source = await readFile(new URL("./project-trust.ts", import.meta.url), "utf8");

  // Detects trust-requiring project resources via the SDK helper.
  assert.match(source, /hasTrustRequiringProjectResources\(cwd\)/);
  // No such resources -> undefined, so ordinary projects keep the normal path.
  assert.match(source, /return undefined/);
  // Otherwise the decision comes from the shared CLI trust store, default deny.
  assert.match(source, /new ProjectTrustStore\(agentDir\)/);
  assert.match(source, /resolveProjectTrust:\s*async \(\) => trustStore\.get\(cwd\) === true/);
});

test("both session-creation sites pass the project-trust gate to the SDK", async () => {
  for (const rel of ["./rpc-manager.ts", "../app/api/models/route.ts"]) {
    const source = await readFile(new URL(rel, import.meta.url), "utf8");
    assert.match(source, /projectTrustReloadOptions\(cwd, agentDir\)/, `${rel} should compute trust reload options`);
    assert.match(
      source,
      /resourceLoaderReloadOptions: trustReloadOptions/,
      `${rel} should forward the gate to createAgentSessionServices`,
    );
  }
});
