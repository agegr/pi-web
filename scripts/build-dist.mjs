#!/usr/bin/env node
/**
 * Build distributable executables for pi-web.
 *
 * Usage:
 *   node scripts/build-dist.mjs [--targets <t1,t2,...>]
 *
 * Default targets: node24-macos-arm64,node24-macos-x64,node24-linux-x64,node24-win-x64
 *
 * Steps:
 *   1. next build  (generates .next/standalone)
 *   2. patch .next/standalone/server.js  (remove process.chdir)
 *   3. write pkg config into .next/standalone/package.json
 *   4. run @yao-pkg/pkg to produce binaries in dist/
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const STANDALONE = resolve(ROOT, '.next/standalone');
const OUT = resolve(ROOT, 'dist');

const args = process.argv.slice(2);
const targetsIdx = args.indexOf('--targets');
const targets = targetsIdx !== -1
  ? args[targetsIdx + 1].split(',')
  : ['node24-macos-arm64', 'node24-macos-x64', 'node24-linux-x64', 'node24-win-x64'];

function run(cmd, cwd = ROOT) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// Step 1: Next.js build (Next.js 14 uses webpack by default — no Turbopack issues)
console.log('\n=== Step 1: next build ===');
run('node node_modules/next/dist/bin/next build');

// Step 1b: Copy static assets into standalone directory.
// Next.js standalone output does NOT include .next/static/ or public/ — they must be copied manually.
console.log('\n=== Step 1b: copy static assets ===');
const staticSrc = resolve(ROOT, '.next/static');
const staticDst = resolve(STANDALONE, '.next/static');
if (existsSync(staticSrc)) {
  cpSync(staticSrc, staticDst, { recursive: true });
  console.log(`Copied: .next/static → standalone/.next/static`);
}
const publicSrc = resolve(ROOT, 'public');
const publicDst = resolve(STANDALONE, 'public');
if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDst, { recursive: true });
  console.log(`Copied: public → standalone/public`);
}

// Step 2: Patch server.js — remove process.chdir(__dirname).
// Inside a pkg executable __dirname is a virtual snapshot path; chdir would fail.
console.log('\n=== Step 2: patch server.js ===');
const serverPath = resolve(STANDALONE, 'server.js');
let serverSrc = readFileSync(serverPath, 'utf8');

if (serverSrc.includes('process.chdir(__dirname)')) {
  serverSrc = serverSrc.replace('process.chdir(__dirname)', '// process.chdir(__dirname) -- removed for pkg');
  console.log('Patched: removed process.chdir(__dirname)');
} else {
  console.log('No process.chdir found — nothing to patch');
}

if (serverSrc.includes('parseInt(process.env.PORT, 10) || 3000')) {
  serverSrc = serverSrc.replace(
    'parseInt(process.env.PORT, 10) || 3000',
    'parseInt(process.env.PORT, 10) || 3030'
  );
  console.log('Patched: default port set to 3030');
}

writeFileSync(serverPath, serverSrc, 'utf8');

// Step 2b-extra-pre: Patch webpack-bundled route files — replace dynamic import() of
// serverExternalPackages with require(). Webpack compiles serverExternalPackages as
// `import("pkg-name")` (ESM dynamic import), but pkg snapshot cannot resolve ESM imports
// for packages by name; require() works because pkg resolves it via the snapshot module graph.
const serverAppDir = resolve(STANDALONE, '.next/server/app');
if (existsSync(serverAppDir)) {
  const patchExternalImports = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) { patchExternalImports(full); continue; }
      if (!entry.endsWith('.js')) continue;
      let src = readFileSync(full, 'utf8');
      // Match: import("@mariozechner/pi-coding-agent") or import("@mariozechner/pi-ai")
      const before = src;
      // Replace import("@mariozechner/pi-coding-agent") with a runtime path-based import()
      // that loads from adjacent to the executable (not from snapshot).
      src = src.replace(
        /\bimport\("(@mariozechner\/pi-coding-agent)"\)/g,
        `(process.pkg ? import(require('path').join(require('path').dirname(process.execPath), 'node_modules', '$1', 'dist', 'index.js')) : import("$1"))`
      );
      if (src !== before) {
        writeFileSync(full, src, 'utf8');
        console.log(`Patched: replaced import() with require() in .next/server/app/${entry}`);
      }
    }
  };
  patchExternalImports(serverAppDir);
}

// Step 2b-extra-1: Create CJS wrapper for @mariozechner/pi-coding-agent.
// The package is pure ESM ("type":"module", exports only "import"). In pkg's snapshot,
// dynamic import() cannot resolve named packages. We create a CJS wrapper module that
// pkg can bundle, and redirect the route files to use it instead.
// Node 24 supports require(esm) natively; the wrapper uses Module.createRequire to load the
// ESM package from its real path (resolved relative to the wrapper file).
const piPkgDir = resolve(STANDALONE, 'node_modules/@mariozechner/pi-coding-agent');
if (existsSync(piPkgDir)) {
  const piPkgJson = JSON.parse(readFileSync(resolve(piPkgDir, 'package.json'), 'utf8'));
  const piMain = piPkgJson.main || './dist/index.js';
  const wrapperPath = resolve(piPkgDir, '__cjs_wrapper__.js');
  // Write a CJS file (no "type":"module" in parent scope because we put it directly, but the
  // parent package.json says "module" — so we use .cjs extension or a sub-package.json trick).
  // Easiest: write __cjs_wrapper__.cjs next to package.json, which is always CJS regardless of "type".
  // pkg cannot correctly handle ESM packages in its snapshot (they need real fs for import()).
  // Solution: mark the entire package as an "external asset" — pkg will NOT bundle it into
  // the snapshot. Instead, at build time we copy it next to the executable. At runtime,
  // we resolve it from the directory adjacent to process.execPath.
  // The route files are patched to call a helper that does a dynamic import() from the real fs path.
  console.log('Note: @mariozechner/pi-coding-agent will be placed next to the executable (not bundled)');
}

// Step 2b-extra-0: Patch recursive-readdir.js — pkg snapshot does not support
// fs.readdir({withFileTypes:true}). Replace with a two-step stat-based fallback.
const recursiveReaddirPath = resolve(STANDALONE, 'node_modules/next/dist/lib/recursive-readdir.js');
let rrSrc = readFileSync(recursiveReaddirPath, 'utf8');
const rrOld = `const dir = await _promises.default.readdir(directory, {
                    withFileTypes: true
                });`;
const rrNew = `const _entries = await _promises.default.readdir(directory);
                const dir = await Promise.all(_entries.map(async (name) => {
                  const _s = await _promises.default.stat(_path.default.join(directory, name));
                  return { name, isDirectory: () => _s.isDirectory(), isSymbolicLink: () => _s.isSymbolicLink(), isFile: () => _s.isFile() };
                }));`;
if (rrSrc.includes(rrOld)) {
  rrSrc = rrSrc.replace(rrOld, rrNew);
  writeFileSync(recursiveReaddirPath, rrSrc, 'utf8');
  console.log('Patched: replaced readdir withFileTypes in recursive-readdir.js');
} else {
  console.log('recursive-readdir.js pattern not found — skipping (may be already patched or changed)');
}

// Step 2b-extra: Patch next/dist/compiled/send/index.js — replace createReadStream with a
// readFileSync-based fallback when running inside pkg (snapshot files can't be streamed).
const sendPath = resolve(STANDALONE, 'node_modules/next/dist/compiled/send/index.js');
let sendSrc = readFileSync(sendPath, 'utf8');
// The stream method calls: d.createReadStream(e,t) where d = require('fs')
// We prefix the method body to intercept snapshot paths.
const streamMethodOld = `SendStream.prototype.stream=function stream(e,t){var a=this;var i=this.res;var stream=d.createReadStream(e,t);`;
const streamMethodNew = `SendStream.prototype.stream=function stream(e,t){var a=this;var i=this.res;var stream;if(process.pkg&&e.startsWith('/snapshot/')){var _buf=d.readFileSync(e);var _Readable=require('stream').Readable;stream=new _Readable({read(){}});stream.push(_buf.slice(t&&t.start||0,t&&t.end!==undefined?t.end+1:undefined));stream.push(null);}else{stream=d.createReadStream(e,t);}`;
if (sendSrc.includes(streamMethodOld)) {
  sendSrc = sendSrc.replace(streamMethodOld, streamMethodNew);
  writeFileSync(sendPath, sendSrc, 'utf8');
  console.log('Patched: replaced createReadStream in send/index.js for pkg snapshot support');
} else {
  console.log('send/index.js stream pattern not found — skipping (may already be patched)');
}

// Step 2b: Patch Next.js files that unconditionally require('inspector') / require('node:inspector').
// pkg does not include the inspector builtin; calling require on it throws ERR_INSPECTOR_NOT_AVAILABLE.
// Replace the require calls with inline no-op stubs.
const INSPECTOR_STUB = `{ url: () => undefined, open: () => {}, close: () => {}, Session: class { connect(){} connectToMainThread(){} disconnect(){} post(m,p,cb){ if(typeof p==='function')p(null,{});else if(cb)cb(null,{}); } on(){} once(){} off(){} removeListener(){} } }`;

const filesToPatchInspector = [
  {
    path: resolve(STANDALONE, 'node_modules/next/dist/server/lib/app-info-log.js'),
    from: `require("inspector")`,
    to: INSPECTOR_STUB,
  },
  {
    path: resolve(STANDALONE, 'node_modules/next/dist/server/node-environment-extensions/console-dim.external.js'),
    from: `require("node:inspector")`,
    to: INSPECTOR_STUB,
  },
];

for (const { path: p, from, to } of filesToPatchInspector) {
  if (!existsSync(p)) { console.log(`Skipping (not found): ${p.replace(STANDALONE, '')}`); continue; }
  let src = readFileSync(p, 'utf8');
  if (src.includes(from)) {
    src = src.replace(from, to);
    writeFileSync(p, src, 'utf8');
    console.log(`Patched: replaced ${from} in ${p.replace(STANDALONE, '')}`);
  } else {
    console.log(`No match for ${from} in ${p.replace(STANDALONE, '')} — skipping`);
  }
}

// Step 3: Inject pkg config into .next/standalone/package.json
console.log('\n=== Step 3: write pkg config ===');
const standalonePkg = JSON.parse(readFileSync(resolve(STANDALONE, 'package.json'), 'utf8'));
standalonePkg.bin = 'server.js';
standalonePkg.pkg = {
  assets: [
    '.next/**/*',
    'public/**/*',
    'node_modules/**/*',
    '!node_modules/@mariozechner/**',  // excluded: pure ESM, must load from real fs at runtime
  ],
  targets,
  outputPath: OUT,
  compress: 'GZip',
};
writeFileSync(resolve(STANDALONE, 'package.json'), JSON.stringify(standalonePkg, null, 2), 'utf8');
console.log('pkg config written to .next/standalone/package.json');
console.log('Targets:', targets.join(', '));

// Step 4: Run pkg
console.log('\n=== Step 4: pkg ===');
mkdirSync(OUT, { recursive: true });
run(`node ${resolve(ROOT, 'node_modules/.bin/pkg')} . --compress GZip`, STANDALONE);

// Step 5: Copy ESM-only packages next to executables.
// These packages cannot be bundled in pkg snapshot (ESM needs real filesystem for import()).
console.log('\n=== Step 5: copy ESM packages next to executables ===');
const esmPackages = ['@mariozechner/pi-coding-agent', '@mariozechner/pi-ai', '@mariozechner/pi-agent-core'];
for (const pkg of esmPackages) {
  const src = resolve(STANDALONE, 'node_modules', pkg);
  if (!existsSync(src)) continue;
  const dst = resolve(OUT, 'node_modules', pkg);
  cpSync(src, dst, { recursive: true });
  console.log(`Copied: ${pkg} → dist/node_modules/${pkg}`);
}
// Also copy any peer deps needed by pi-coding-agent that are ESM
const piNodeModules = resolve(STANDALONE, 'node_modules/@mariozechner/pi-coding-agent/node_modules');
if (existsSync(piNodeModules)) {
  cpSync(piNodeModules, resolve(OUT, 'node_modules/@mariozechner/pi-coding-agent/node_modules'), { recursive: true });
}

console.log(`\n=== Done! Executables in ${OUT}/ ===`);
console.log('NOTE: dist/node_modules/ must be distributed alongside the executable.');
