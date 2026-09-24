import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { NextRequest } = await jiti.import("next/server");


function browseRequest(query) {
  return new NextRequest(`http://localhost/api/cwd/browse${query}`, {
    headers: { host: "localhost" },
  });
}

async function listNames(response) {
  const data = await response.json();
  return (data.directories ?? []).map((entry) => entry.name);
}

test("hidden dot-prefixed directories are excluded unless the literal showHidden=true opts in", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-cwd-browse-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "visible"));
  await mkdir(path.join(root, ".hidden"));

  // Absent parameter: hidden.
  const absent = await GET(browseRequest(`?path=${encodeURIComponent(root)}`));
  assert.equal(absent.status, 200);
  assert.deepEqual(await listNames(absent), ["visible"]);

  // The literal "true" opts in.
  const shown = await GET(browseRequest(`?path=${encodeURIComponent(root)}&showHidden=true`));
  assert.equal(shown.status, 200);
  assert.deepEqual(await listNames(shown), [".hidden", "visible"]);

  // Any other value — including "1" — defaults to hidden.
  for (const value of ["1", "TRUE", "yes", "false", ""]) {
    const response = await GET(browseRequest(`?path=${encodeURIComponent(root)}&showHidden=${value}`));
    assert.equal(response.status, 200);
    assert.deepEqual(await listNames(response), ["visible"], `showHidden=${value} must stay hidden`);
  }
});

test("the Windows drive-picker branch EXECUTES (via a pinned platform) and ignores showHidden entirely", async (t) => {
  // Execute the REAL route handler with process.platform pinned to win32 and
  // no path: the drive branch runs (before showHidden is ever read) and
  // answers with the drive-picker shape — drives list (empty on this POSIX
  // host, since no A:\ exists) and no directories key consumption.
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(process, "platform", original);
    else Reflect.deleteProperty(process, "platform");
  });

  for (const query of ["", "?showHidden=true"]) {
    const response = await GET(browseRequest(query));
    assert.equal(response.status, 200, `drive branch answers ${JSON.stringify(query)}`);
    const data = await response.json();
    assert.equal(data.path, "");
    assert.equal(data.parentPath, null);
    assert.ok(Array.isArray(data.drives), "the drive-picker shape carries a drives list");
    assert.deepEqual(data.directories, []);
  }

  // The pure helper keeps driving the branch on win32 only (and not on
  // POSIX, restored by t.after).
  const { shouldShowWindowsDrivePicker } = await jiti.import("@/lib/directory-browser.ts");
  assert.equal(shouldShowWindowsDrivePicker(undefined, "win32"), true);
  assert.equal(shouldShowWindowsDrivePicker("C:\\Projects", "win32"), false);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "linux"), false);
});

test("with the platform restored, the no-path browse lists the home directory (non-drive branch executes)", async () => {
  const response = await GET(browseRequest(""));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.path, os.homedir());
  assert.ok(Array.isArray(data.directories), "the POSIX start-directory listing executes");
});

test("browse responses still resolve the directory and its parent", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-cwd-browse-parent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const response = await GET(browseRequest(`?path=${encodeURIComponent(root)}`));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.path, root);
  assert.equal(data.parentPath, path.dirname(root));
});
