import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, parse } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let mode = process.env.PI_WEB_TANSTACK_OUTPUT_MODE || "standalone";
const modeIndex = process.argv.indexOf("--mode");
if (modeIndex !== -1 && process.argv[modeIndex + 1]) {
  mode = process.argv[modeIndex + 1];
}
const modeEquals = process.argv.find((argument) => argument.startsWith("--mode="));
if (modeEquals) {
  mode = modeEquals.slice("--mode=".length);
}
assert.ok(mode === "standalone" || mode === "publication", "mode must be standalone or publication");

const outputArg = [...process.argv.slice(2)].reverse()
  .find((argument) => !argument.startsWith("--mode")) || "";
const outputDir = (outputArg || process.env.PI_WEB_TANSTACK_OUTPUT_DIR || "").trim();
assert.ok(outputDir && isAbsolute(outputDir), "PI_WEB_TANSTACK_OUTPUT_DIR must be an absolute path");
assert.ok(existsSync(join(outputDir, "server", "index.mjs")), "server/index.mjs is missing");
assert.ok(existsSync(join(outputDir, "nitro.json")), "nitro.json is missing");

const packages = [
  "undici",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];
const tracedResolve = (name) => import.meta.resolve(name, pathToFileURL(join(outputDir, "server", "index.mjs")).href);
const versions = {};

function packageJsonFor(resolveFrom, name) {
  let directory = dirname(fileURLToPath(resolveFrom(name)));
  const root = parse(directory).root;
  while (directory !== root) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8"));
      if (pkg.name === name) return pkg;
    }
    directory = dirname(directory);
  }
  throw new Error(`package.json not found for ${name}`);
}

for (const name of packages) {
  const rootPackage = packageJsonFor(
    (p) => import.meta.resolve(p, new URL("../package.json", import.meta.url).href),
    name,
  );
  const tracedPackage = packageJsonFor(tracedResolve, name);
  assert.equal(tracedPackage.version, rootPackage.version, `${name} runtime version differs from the repository install`);
  versions[name] = tracedPackage.version;
}

// Both output modes externalize and copy the five process-sensitive packages
// into server/node_modules so the generated server loads them with their full
// runtime resources. The publication stage excludes that copy from the tarball
// (npm install provides the packages), which smoke-installed-package.mjs verifies.
for (const name of packages) {
  assert.ok(
    existsSync(join(outputDir, "server", "node_modules", name)),
    `${name} must be copied into server/node_modules (${mode} mode)`,
  );
}

function sizeOf(directory) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = sizeOf(fullPath);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      bytes += statSync(fullPath).size;
    }
  }
  return { files, bytes };
}

const nitro = JSON.parse(readFileSync(join(outputDir, "nitro.json"), "utf8"));
const serverFiles = [];
function collectServerCode(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) collectServerCode(fullPath);
    else if (/\.[cm]?js$/.test(entry.name)) serverFiles.push(fullPath);
  }
}
collectServerCode(join(outputDir, "server"));
const runtimeImports = serverFiles
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
for (const name of packages) {
  assert.ok(runtimeImports.includes(name), `${name} has no runtime import edge in generated server code`);
}

console.log(JSON.stringify({ outputDir, nitro, versions, ...sizeOf(outputDir) }, null, 2));
