import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ImagePreview.tsx", import.meta.url), "utf8");

test("Escape closes image preview without reaching global shortcuts", () => {
  assert.match(
    source,
    /event\.key !== "Escape"[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?setOpen\(false\)/,
  );
});
