import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getSafeNpxEnv, redactNpxOutput } = await jiti.import("./npx.ts");

test("removes credential-like variables from the npx environment", () => {
  const previousToken = process.env.OMP_WEB_NPX_TEST_TOKEN;
  const previousPath = process.env.OMP_WEB_NPX_TEST_PATH;
  process.env.OMP_WEB_NPX_TEST_TOKEN = "secret-token";
  process.env.OMP_WEB_NPX_TEST_PATH = "/tmp/kept";
  try {
    const env = getSafeNpxEnv({ FORCE_COLOR: "0" });
    assert.equal(env.OMP_WEB_NPX_TEST_TOKEN, undefined);
    assert.equal(env.OMP_WEB_NPX_TEST_PATH, "/tmp/kept");
    assert.equal(env.FORCE_COLOR, "0");
  } finally {
    if (previousToken === undefined) delete process.env.OMP_WEB_NPX_TEST_TOKEN;
    else process.env.OMP_WEB_NPX_TEST_TOKEN = previousToken;
    if (previousPath === undefined) delete process.env.OMP_WEB_NPX_TEST_PATH;
    else process.env.OMP_WEB_NPX_TEST_PATH = previousPath;
  }
});

test("redacts inherited credentials and authorization headers from output", () => {
  const output = redactNpxOutput(
    "token=secret-token Authorization: Bearer abc.def.ghi",
    { OMP_WEB_NPX_TEST_TOKEN: "secret-token" },
  );
  assert.equal(output, "token=[REDACTED] Authorization: Bearer [REDACTED]");
});
