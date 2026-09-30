import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { defaultCwdPath, localDateStamp } =
  await createJiti(import.meta.url).import("./default-cwd.ts");

test("stamps the local calendar date, not the UTC one", () => {
  // 00:30 local time on Jan 2 — still Jan 1 in UTC for any zone east of UTC.
  const justAfterMidnight = new Date(2026, 0, 2, 0, 30);
  assert.equal(localDateStamp(justAfterMidnight), "20260102");
  // 23:30 local time on Dec 31 — already Jan 1 in UTC for any zone west of UTC.
  assert.equal(localDateStamp(new Date(2025, 11, 31, 23, 30)), "20251231");
});

test("places the dated folder under ~/pi-cwd", () => {
  const home = path.join(os.tmpdir(), "pi-web-home");
  assert.equal(
    defaultCwdPath(new Date(2026, 8, 29, 7), home),
    path.join(home, "pi-cwd", "20260929"),
  );
});
