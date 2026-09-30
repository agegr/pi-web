import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./linked-directory.ts");
}

// project/
//   inner/            real directory
//   inside-link   ->  ./inner
//   outside-link  ->  ../outside
//   file-link     ->  ../outside/file.txt
//   dangling-link ->  ../missing
// outside/
//   file.txt
//   nested-link   ->  ../secret
// secret/
function createFixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-linked-dir-")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const project = path.join(base, "project");
  const outside = path.join(base, "outside");
  const secret = path.join(base, "secret");
  fs.mkdirSync(path.join(project, "inner"), { recursive: true });
  fs.mkdirSync(outside);
  fs.mkdirSync(secret);
  fs.writeFileSync(path.join(outside, "file.txt"), "outside");
  const dirType = process.platform === "win32" ? "junction" : "dir";
  try {
    fs.symlinkSync(path.join(project, "inner"), path.join(project, "inside-link"), dirType);
    fs.symlinkSync(outside, path.join(project, "outside-link"), dirType);
    fs.symlinkSync(secret, path.join(outside, "nested-link"), dirType);
    fs.symlinkSync(path.join(outside, "file.txt"), path.join(project, "file-link"), "file");
    fs.symlinkSync(path.join(base, "missing"), path.join(project, "dangling-link"), dirType);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return null;
    }
    throw error;
  }
  // `base` is already canonical, so these roots double as resolved roots.
  return { base, project, outside, secret, roots: new Set([project]) };
}

test("reports the target of a directory link that leaves the allowed roots", async (t) => {
  const { getOutsideLinkTarget } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, outside, roots } = fixture;

  assert.equal(getOutsideLinkTarget(path.join(project, "outside-link"), roots), outside);
  assert.equal(getOutsideLinkTarget(path.join(project, "inside-link"), roots), null);
  assert.equal(getOutsideLinkTarget(path.join(project, "inner"), roots), null);
  assert.equal(getOutsideLinkTarget(path.join(project, "dangling-link"), roots), null);
});

test("annotates only the listed directories that lead outside the roots", async (t) => {
  const { withOutsideLinkTargets } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, outside, roots } = fixture;

  const dirents = fs.readdirSync(project, { withFileTypes: true });
  const entries = [
    { name: "inner", isDir: true },
    { name: "inside-link", isDir: true },
    { name: "outside-link", isDir: true },
    { name: "file-link", isDir: false },
  ];
  assert.deepEqual(withOutsideLinkTargets(project, entries, dirents, roots), [
    { name: "inner", isDir: true },
    { name: "inside-link", isDir: true },
    { name: "outside-link", isDir: true, outsideLinkTarget: outside },
    { name: "file-link", isDir: false },
  ]);
  // A root that reaches the target makes the link an ordinary directory.
  assert.equal(
    withOutsideLinkTargets(project, entries, dirents, new Set([project, outside]))[2].outsideLinkTarget,
    undefined,
  );
});

test("never resolves an entry that is a directory by its own type", async (t) => {
  const { withOutsideLinkTargets } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { base, roots } = fixture;

  // `base/secret` is outside the roots, but a real directory listed inside an
  // authorized directory cannot be, so it is not even resolved.
  const dirents = [{ name: "secret", isDirectory: () => true }];
  assert.deepEqual(
    withOutsideLinkTargets(base, [{ name: "secret", isDir: true }], dirents, roots),
    [{ name: "secret", isDir: true }],
  );
});

test("approves the target of a link that sits directly inside the roots", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, outside, roots } = fixture;

  assert.deepEqual(
    checkLinkedDirectoryApproval(path.join(project, "outside-link"), outside, roots),
    { ok: true, target: outside, alreadyAllowed: false },
  );
  const inner = path.join(project, "inner");
  assert.deepEqual(
    checkLinkedDirectoryApproval(path.join(project, "inside-link"), inner, roots),
    { ok: true, target: inner, alreadyAllowed: true },
  );
});

test("refuses a link whose target is not the one the operator was shown", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, secret, roots } = fixture;

  assert.equal(checkLinkedDirectoryApproval(path.join(project, "outside-link"), secret, roots).status, 409);
});

test("refuses a link reached through another link that was never allowed", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, outside, secret, roots } = fixture;

  const nested = path.join(project, "outside-link", "nested-link");
  assert.equal(checkLinkedDirectoryApproval(nested, secret, roots).status, 403);
  // Once the operator allowed the first target, the next link is a new choice.
  assert.deepEqual(
    checkLinkedDirectoryApproval(nested, secret, new Set([project, outside])),
    { ok: true, target: secret, alreadyAllowed: false },
  );
});

test("refuses a `..` path that the filesystem would resolve through a link", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, secret, roots } = fixture;

  // The filesystem resolves this `..` from the link target and reaches the
  // real outside/nested-link; lexically it names project/outside/nested-link.
  const traversal = [project, "outside-link", "..", "outside", "nested-link"].join(path.sep);
  assert.deepEqual(
    checkLinkedDirectoryApproval(traversal, secret, roots),
    { ok: false, status: 403, error: "Access denied" },
  );
});

test("refuses paths outside the roots, plain directories, file links and dangling links", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { base, project, outside, roots } = fixture;

  assert.equal(checkLinkedDirectoryApproval(outside, outside, roots).status, 403);
  assert.equal(checkLinkedDirectoryApproval(path.join(project, "inner"), outside, roots).status, 400);
  const file = path.join(outside, "file.txt");
  assert.equal(checkLinkedDirectoryApproval(path.join(project, "file-link"), file, roots).status, 400);
  const missing = path.join(base, "missing");
  assert.equal(checkLinkedDirectoryApproval(path.join(project, "dangling-link"), missing, roots).status, 404);
  assert.equal(checkLinkedDirectoryApproval(path.join(project, "missing"), outside, roots).status, 404);
});

test("flags a link whose target contains the project", async (t) => {
  const { withOutsideLinkTargets } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { base, project, outside, roots } = fixture;
  // A repository can carry a link to a parent of wherever it is cloned.
  fs.symlinkSync(base, path.join(project, "parent-link"), process.platform === "win32" ? "junction" : "dir");

  const dirents = fs.readdirSync(project, { withFileTypes: true });
  const entries = [{ name: "outside-link", isDir: true }, { name: "parent-link", isDir: true }];
  assert.deepEqual(withOutsideLinkTargets(project, entries, dirents, roots), [
    { name: "outside-link", isDir: true, outsideLinkTarget: outside },
    { name: "parent-link", isDir: true, outsideLinkTarget: base, outsideLinkEncloses: true },
  ]);
});
