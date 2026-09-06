import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("a removed project directory is handled as expected state instead of a console error", () => {
  const trustEffect = source.slice(
    source.indexOf("  useEffect(() => {\n    setProjectTrust(null)"),
    source.indexOf("  const handleTrustProject = useCallback"),
  );

  assert.match(trustEffect, /data\.code === "cwd_not_found"/);
  assert.match(trustEffect, /setProjectTrustError/);
  assert.ok(
    trustEffect.indexOf('data.code === "cwd_not_found"')
      < trustEffect.indexOf('throw new Error(data.error ?? `HTTP ${response.status}`)'),
  );
});
