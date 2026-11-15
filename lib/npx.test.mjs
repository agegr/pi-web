import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { npxEnvironment } = await jiti.import("./npx.ts");

test("an npx child gets the host environment without this server's own variables", () => {
  const base = {
    PATH: "/usr/bin",
    HTTPS_PROXY: "http://proxy.example:8080",
    GITHUB_TOKEN: "token",
    PI_WEB_PASSWORD: "secret",
    PORT: "30141",
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    FORCE_COLOR: "3",
  };
  const before = { ...base };

  assert.deepEqual(npxEnvironment(base), {
    PATH: "/usr/bin",
    HTTPS_PROXY: "http://proxy.example:8080",
    GITHUB_TOKEN: "token",
    FORCE_COLOR: "0",
  });
  assert.deepEqual(base, before);
});
