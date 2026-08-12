import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const ROOT = process.cwd();
const stagingScript = join(ROOT, "scripts", "stage-tanstack-package.mjs");

function makeFixture() {
  const fixture = mkdtempSync(join(tmpdir(), "pi-web-stage-fixture-"));
  const outputDir = join(fixture, "publication-output");
  mkdirSync(join(outputDir, "server"), { recursive: true });
  writeFileSync(join(outputDir, "server", "index.mjs"), "export default () => {};\n");
  mkdirSync(join(outputDir, "public"), { recursive: true });
  writeFileSync(join(outputDir, "public", "index.html"), "<h1>Pi Web</h1>\n");
  writeFileSync(join(outputDir, "nitro.json"), "{}\n");
  for (const name of ["bin", "README.md", "README.zh-CN.md", "README.ja.md", "README.ru.md", "LICENSE"]) {
    const target = join(fixture, name);
    if (name === "bin") {
      mkdirSync(target);
      writeFileSync(join(target, "pi-web.js"), "// bin\n");
    } else {
      writeFileSync(target, `${name} content\n`);
    }
  }
  const pkg = {
    name: "@agegr/pi-web",
    version: "0.0.0-fixture",
    description: "fixture",
    bin: { "pi-web": "bin/pi-web.js" },
    engines: { node: ">=22.19.0" },
    dependencies: { "lucide-react": "^0.562.0" },
    optionalDependencies: {},
    scripts: { dev: "next dev" },
    devDependencies: { next: "16.2.12" },
    files: [".next", "next.config.ts"],
  };
  writeFileSync(join(fixture, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  return { fixture, outputDir };
}

function runStage(outputDir, stageDir) {
  return spawnSync(process.execPath, [stagingScript, outputDir, stageDir], {
    encoding: "utf8",
    cwd: ROOT,
  });
}

test("staging requires absolute arguments and rejects in-repository or populated stages", () => {
  const { fixture, outputDir } = makeFixture();
  try {
    const relative = runStage(outputDir, "relative-stage");
    assert.notEqual(relative.status, 0, "relative stage must fail");

    const inRepo = runStage(outputDir, join(ROOT, "tmp-stage"));
    assert.notEqual(inRepo.status, 0, "in-repository stage must fail");

    const populated = mkdtempSync(join(tmpdir(), "pi-web-stage-populated-"));
    writeFileSync(join(populated, "existing.txt"), "x");
    const existing = runStage(outputDir, populated);
    assert.notEqual(existing.status, 0, "existing populated stage must fail");
  } finally {
    // nothing to clean inside the repo; fixture is in tmp
  }
});

test("staging copies output and metadata without repo-only files", () => {
  const { fixture, outputDir } = makeFixture();
  const stageDir = join(fixture, "stage");
  const result = runStage(outputDir, stageDir);
  assert.equal(result.status, 0, result.stderr);

  for (const name of [
    ".output",
    "bin",
    "package.json",
    "README.md",
    "README.zh-CN.md",
    "README.ja.md",
    "README.ru.md",
    "LICENSE",
  ]) {
    assert.ok(existsSync(join(stageDir, name)), `stage is missing ${name}`);
  }
  assert.ok(!existsSync(join(stageDir, "public")), "stage must not receive a second source public directory");

  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const staged = JSON.parse(readFileSync(join(stageDir, "package.json"), "utf8"));
  assert.equal(staged.name, rootPackage.name);
  assert.equal(staged.version, rootPackage.version);
  assert.equal(staged.bin["pi-web"], "bin/pi-web.js");
  assert.equal(staged.engines.node, rootPackage.engines.node);
  assert.deepEqual(staged.dependencies, rootPackage.dependencies);
  assert.deepEqual(staged.optionalDependencies, rootPackage.optionalDependencies ?? {});
  assert.ok(staged.files.includes(".output"));
  assert.ok(!staged.files.includes(".next"));
  assert.equal(staged.scripts, undefined, "repository-only scripts must be absent");
  assert.equal(staged.devDependencies, undefined, "devDependencies must be absent");
  assert.ok(!existsSync(join(stageDir, ".output", "server", "node_modules", "@earendil-works")), "no duplicated packages in staged output");
});

test("staging never writes .output into the repository", () => {
  const { fixture, outputDir } = makeFixture();
  const stageDir = join(fixture, "stage2");
  const result = runStage(outputDir, stageDir);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!existsSync(join(ROOT, ".output")), "repository must not contain .output");
});
