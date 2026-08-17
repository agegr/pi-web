import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { DirectoryPicker } = await jiti.import("./DirectoryPicker.tsx");

test("DirectoryPicker exports a React component function", () => {
  assert.equal(typeof DirectoryPicker, "function");
});
