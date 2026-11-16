import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET } = await jiti.import("./route.ts");
const { fontDirectories, listInstalledFonts } = await jiti.import("../../../lib/installed-fonts.ts");

test("the picker's list is the host's font families, in the shape the field reads", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.fonts));
  for (const font of body.fonts) {
    assert.equal(typeof font.family, "string");
    assert.ok(font.family.length > 0);
    assert.ok(Array.isArray(font.aliases));
    assert.ok(font.aliases.every((alias) => typeof alias === "string" && alias !== font.family));
    assert.equal(typeof font.monospace, "boolean");
  }

  // The route serves what the reader found, deduplicated by family.
  const families = body.fonts.map((font) => font.family.toLocaleLowerCase());
  assert.equal(new Set(families).size, families.length);
  if (fontDirectories().some((dir) => fs.existsSync(dir))) {
    assert.deepEqual(body.fonts, await listInstalledFonts());
  }
});
