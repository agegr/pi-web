import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { GET, dynamic } = await jiti.import("./manifest.webmanifest/route.ts");

test("manifest route reads the app name at runtime without changing other metadata", async () => {
  const original = process.env.PI_WEB_APP_NAME;
  const getManifest = async () => {
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/manifest+json");
    return response.json();
  };

  try {
    assert.equal(dynamic, "force-dynamic");
    delete process.env.PI_WEB_APP_NAME;
    const defaults = await getManifest();
    assert.equal(defaults.name, "Pi Web");
    assert.equal(defaults.short_name, "Pi Web");

    // Reuse the same imported function: the environment must not be captured
    // at module load time (or baked into a statically generated manifest).
    for (const [value, expected] of [
      ["", "Pi Web"],
      [" \t\n ", "Pi Web"],
      ["Work Pi", "Work Pi"],
      ["  工作 Pi 🚀 \n", "工作 Pi 🚀"],
      ["Another Pi", "Another Pi"],
    ]) {
      process.env.PI_WEB_APP_NAME = value;
      const expectedManifest = {
        ...defaults,
        name: expected,
        short_name: expected,
      };
      assert.deepEqual(await getManifest(), expectedManifest);
    }
  } finally {
    if (original === undefined) delete process.env.PI_WEB_APP_NAME;
    else process.env.PI_WEB_APP_NAME = original;
  }
});
