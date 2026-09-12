import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const packages = {
  "pi-agent-core": "agent",
  "pi-ai": "ai",
  "pi-coding-agent": "coding-agent",
  "pi-tui": "tui",
};

test("Web loads the repository's built Pi modules, with no independent SDK copies", async () => {
  for (const [name, directory] of Object.entries(packages)) {
    const specifier = `@earendil-works/${name}`;
    const localEntry = new URL(`../../pi/packages/${directory}/dist/index.js`, import.meta.url);
    assert.equal(realpathSync(fileURLToPath(import.meta.resolve(specifier))), realpathSync(fileURLToPath(localEntry)));
    assert.strictEqual(await import(specifier), await import(localEntry.href));

    // The emitted entry must correspond to the current CLI source, not an old build.
    const sourceMap = JSON.parse(readFileSync(new URL(`${localEntry.href}.map`), "utf8"));
    for (const [index, source] of sourceMap.sources.entries()) {
      assert.equal(sourceMap.sourcesContent[index], readFileSync(new URL(source, localEntry), "utf8"));
    }
  }
});

test("Next.js adapters expose the same native local SDK modules, including subpath imports", async (t) => {
  const previousCwd = process.cwd();
  // npm, bin/pi-web.js and Start-PiWeb.ps1 all launch Next in pi-web.
  process.chdir(fileURLToPath(new URL("../", import.meta.url)));
  t.after(() => process.chdir(previousCwd));
  const config = await createJiti(import.meta.url).import("../next.config.ts", { default: true });
  const nativeRequire = createRequire(import.meta.url);
  const webpackConfig = config.webpack({ resolve: { alias: {} } });
  assert.deepEqual(Object.keys(config.turbopack.resolveAlias).sort(), [
    ...Object.keys(packages).map((name) => `@earendil-works/${name}`),
    "@earendil-works/pi-ai/compat",
  ].sort());
  for (const [specifier, adapter] of Object.entries(config.turbopack.resolveAlias)) {
    const sdk = await import(specifier);
    assert.strictEqual(nativeRequire(fileURLToPath(new URL(`../${adapter}`, import.meta.url))), sdk);
    assert.strictEqual(nativeRequire(webpackConfig.resolve.alias[`${specifier}$`]), sdk);
  }
});
