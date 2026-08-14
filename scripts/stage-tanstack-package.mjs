import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const INCLUDED_FILES = [
  "bin",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
];

function fail(message) {
  console.error(`stage-tanstack-package: ${message}`);
  process.exit(1);
}

const [outputArg, stageArg] = process.argv.slice(2);
if (!outputArg || !isAbsolute(outputArg)) {
  fail("publication output must be an absolute path");
}
if (!stageArg || !isAbsolute(stageArg)) {
  fail("stage directory must be an absolute path");
}

const repoRoot = process.cwd();
const repoResolved = resolve(repoRoot);
const stageResolved = resolve(stageArg);
const relativeStage = relative(repoResolved, stageResolved);
const stageIsInsideRepository = !isAbsolute(relativeStage)
  && (relativeStage === ""
    || (!relativeStage.startsWith(`..${sep}`) && relativeStage !== ".."));
if (stageIsInsideRepository) {
  fail(`stage directory must be outside the repository: ${stageResolved}`);
}

if (existsSync(stageResolved) && readdirSync(stageResolved).length > 0) {
  fail(`stage directory must be fresh or empty: ${stageResolved}`);
}
if (!existsSync(join(outputArg, "server", "index.mjs"))) {
  fail(`publication output has no server/index.mjs: ${outputArg}`);
}

const rootPackage = JSON.parse(readFileSync(join(repoResolved, "package.json"), "utf8"));
const stagedPackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  description: rootPackage.description,
  homepage: rootPackage.homepage,
  repository: rootPackage.repository,
  bugs: rootPackage.bugs,
  license: rootPackage.license,
  engines: rootPackage.engines,
  bin: rootPackage.bin,
  dependencies: rootPackage.dependencies,
  optionalDependencies: rootPackage.optionalDependencies ?? {},
  files: ["bin", ".output", "README*.md", "LICENSE", "package.json"],
};

mkdirSync(stageResolved, { recursive: true });
cpSync(outputArg, join(stageResolved, ".output"), { recursive: true });
// The trace copy of externalized packages must not ship in the tarball:
// `dependencies` declares them, so npm install provides complete packages
// (with runtime resources) in the consuming project. Leaving them here would
// both duplicate the tree and serve resource-less bundles.
rmSync(join(stageResolved, ".output", "server", "node_modules"), {
  recursive: true,
  force: true,
});
for (const name of INCLUDED_FILES) {
  const source = join(repoResolved, name);
  if (!existsSync(source)) {
    fail(`included file is missing: ${source}`);
  }
  cpSync(source, join(stageResolved, name), { recursive: true });
}
writeFileSync(
  join(stageResolved, "package.json"),
  `${JSON.stringify(stagedPackage, null, 2)}\n`,
);

console.log(JSON.stringify({ stageDir: stageResolved }));
