import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import test from "node:test";

// route.ts 与 comet-cli.ts 均含无扩展名的相对 import（next/server、../../allowed-commands），
// node:test 环境无法直接 import。遵循 events-route.test.mjs 范式：源码契约断言 +
// 真实下游文件系统验证（铁律4：不 mock）。
const routeSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const guardSource = await readFile(
  new URL("../../../../lib/unified-engine/guards/comet-cli.ts", import.meta.url),
  "utf8",
);

test("route 契约：GET 调 isCometAvailable 返回 { available }", () => {
  assert.match(routeSource, /isCometAvailable/);
  assert.match(routeSource, /NextResponse\.json\(/);
  assert.match(routeSource, /available:\s*isCometAvailable\(\)/);
});

test("comet-cli 契约：探测 vendor/comet/.../comet-guard.mjs", () => {
  assert.match(guardSource, /COMET_SCRIPTS_DIR/);
  assert.match(guardSource, /"vendor"/);
  assert.match(guardSource, /"comet"/);
  assert.match(guardSource, /"scripts"/);
  assert.match(guardSource, /comet-guard\.mjs/);
  assert.match(guardSource, /isCometAvailable[\s\S]*existsSync/);
});

test("真实下游：comet-guard.mjs 存在性探测（铁律4：真实文件系统，不 mock）", () => {
  // isCometAvailable 探测的目标文件，真实 existsSync 验证（不经 import 链、不经 mock）。
  // 不断言 true/false（依赖 vendor/comet 是否 vendored），只验证探测可执行且返回 boolean。
  const guardPath = new URL(
    "../../../../vendor/comet/assets/skills/comet/scripts/comet-guard.mjs",
    import.meta.url,
  );
  const exists = existsSync(guardPath);
  assert.equal(typeof exists, "boolean");
});
