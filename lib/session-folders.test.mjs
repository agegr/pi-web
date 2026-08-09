import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  assignSession,
  createFolder,
  deleteFolder,
  listFolders,
  moveFolder,
  pruneMissingSessions,
  renameFolder,
  SessionFolderError,
} = await jiti.import("./session-folders.ts");

async function tempStorePath(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-session-folders-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "session-folders.json");
}

test("listFolders returns an empty store when no file exists yet", async (t) => {
  const storePath = await tempStorePath(t);
  assert.deepEqual(listFolders(storePath), { version: 1, folders: [], assignments: {} });
  assert.equal(existsSync(storePath), false);
});

test("createFolder persists a root folder and assigns increasing order per parent", async (t) => {
  const storePath = await tempStorePath(t);
  const a = createFolder("Work", null, storePath);
  const b = createFolder("Learning", null, storePath);

  assert.equal(a.name, "Work");
  assert.equal(a.parentId, null);
  assert.equal(a.order, 0);
  assert.equal(b.order, 1);

  const store = listFolders(storePath);
  assert.equal(store.folders.length, 2);
  assert.equal(existsSync(storePath), true);
});

test("createFolder trims whitespace and rejects an empty name", async (t) => {
  const storePath = await tempStorePath(t);
  const folder = createFolder("  Client A  ", null, storePath);
  assert.equal(folder.name, "Client A");
  assert.throws(() => createFolder("   ", null, storePath), SessionFolderError);
});

test("createFolder rejects an unknown parentId", async (t) => {
  const storePath = await tempStorePath(t);
  assert.throws(() => createFolder("Sub", "missing-id", storePath), SessionFolderError);
});

test("nested subfolders are supported", async (t) => {
  const storePath = await tempStorePath(t);
  const parent = createFolder("Work", null, storePath);
  const child = createFolder("Client A", parent.id, storePath);
  assert.equal(child.parentId, parent.id);
});

test("renameFolder updates the name in place", async (t) => {
  const storePath = await tempStorePath(t);
  const folder = createFolder("Old name", null, storePath);
  const renamed = renameFolder(folder.id, "New name", storePath);
  assert.equal(renamed.name, "New name");
  assert.equal(listFolders(storePath).folders[0].name, "New name");
});

test("renameFolder throws for a missing folder", async (t) => {
  const storePath = await tempStorePath(t);
  assert.throws(() => renameFolder("missing-id", "x", storePath), SessionFolderError);
});

test("moveFolder re-parents a folder and rejects cycles", async (t) => {
  const storePath = await tempStorePath(t);
  const a = createFolder("A", null, storePath);
  const b = createFolder("B", null, storePath);
  const c = createFolder("C", a.id, storePath);

  moveFolder(b.id, a.id, storePath);
  assert.equal(listFolders(storePath).folders.find((f) => f.id === b.id)?.parentId, a.id);

  // a -> c is fine (c is a's child, moving a under c would cycle — test the actual cycle: moving a under its own child c)
  assert.throws(() => moveFolder(a.id, c.id, storePath), SessionFolderError);
  // A folder cannot be moved under itself either.
  assert.throws(() => moveFolder(a.id, a.id, storePath), SessionFolderError);
});

test("deleteFolder promotes child folders and unfiles child sessions instead of deleting them", async (t) => {
  const storePath = await tempStorePath(t);
  const root = createFolder("Root", null, storePath);
  const child = createFolder("Child", root.id, storePath);
  assignSession("session-1", root.id, storePath);
  assignSession("session-2", child.id, storePath);

  deleteFolder(root.id, storePath);

  const store = listFolders(storePath);
  assert.equal(store.folders.length, 1);
  assert.equal(store.folders[0].id, child.id);
  assert.equal(store.folders[0].parentId, null); // promoted to root's parent (root level)

  // Sessions are never deleted by folder deletion — session-1 becomes unfiled,
  // session-2 keeps its (now-promoted) folder.
  assert.equal(store.assignments["session-1"], undefined);
  assert.equal(store.assignments["session-2"], child.id);
});

test("deleteFolder throws for a missing folder", async (t) => {
  const storePath = await tempStorePath(t);
  assert.throws(() => deleteFolder("missing-id", storePath), SessionFolderError);
});

test("assignSession assigns and unfiles a session", async (t) => {
  const storePath = await tempStorePath(t);
  const folder = createFolder("Work", null, storePath);
  assignSession("session-1", folder.id, storePath);
  assert.equal(listFolders(storePath).assignments["session-1"], folder.id);

  assignSession("session-1", null, storePath);
  assert.equal(listFolders(storePath).assignments["session-1"], undefined);
});

test("assignSession rejects an unknown folder", async (t) => {
  const storePath = await tempStorePath(t);
  assert.throws(() => assignSession("session-1", "missing-id", storePath), SessionFolderError);
});

test("pruneMissingSessions drops assignments for sessions that no longer exist", async (t) => {
  const storePath = await tempStorePath(t);
  const folder = createFolder("Work", null, storePath);
  assignSession("keep-me", folder.id, storePath);
  assignSession("drop-me", folder.id, storePath);

  pruneMissingSessions(new Set(["keep-me"]), storePath);

  const store = listFolders(storePath);
  assert.equal(store.assignments["keep-me"], folder.id);
  assert.equal(store.assignments["drop-me"], undefined);
});

test("the store file on disk is valid, human-readable JSON", async (t) => {
  const storePath = await tempStorePath(t);
  createFolder("Work", null, storePath);
  const raw = readFileSync(storePath, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  assert.equal(Array.isArray(parsed.folders), true);
});

test("a corrupt store file is treated as empty rather than throwing", async (t) => {
  const storePath = await tempStorePath(t);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(storePath, ".."), { recursive: true });
  writeFileSync(storePath, "{not valid json", "utf8");
  assert.deepEqual(listFolders(storePath), { version: 1, folders: [], assignments: {} });
});
