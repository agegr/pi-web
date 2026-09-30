import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The allowed roots come from the session catalogue, so point it at an empty
// scratch agent directory instead of the user's real ~/.pi/agent.
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-linked-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST } = await jiti.import("./[...path]/route.ts");
const { GET: getFileIndex } = await jiti.import("../file-index/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { encodeFilePathForApi } = await jiti.import("../../../lib/file-paths.ts");
const { NextRequest } = await jiti.import("next/server");

function request(method, filePath, type, body, contentType = "application/json") {
  const encoded = encodeFilePathForApi(filePath);
  const url = `http://localhost/api/files/${encoded}?type=${type}`;
  const context = { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) };
  const handler = method === "GET" ? GET : POST;
  const init = body === undefined
    ? { method, headers: { host: "localhost" } }
    : { method, headers: { host: "localhost", "content-type": contentType }, body: JSON.stringify(body) };
  return handler(new NextRequest(url, init), context);
}

function allowLink(linkPath, target) {
  return request("POST", linkPath, "allow-link", { target });
}

// A project that gathers other folders through links, as in #748:
// hub/linked and hub/second lead outside the roots, hub/alias -> hub/inner.
function createHub(t) {
  const hub = path.join(base, `hub-${t.name.replace(/\W+/g, "-")}`);
  const elsewhere = `${hub}-elsewhere`;
  const second = `${hub}-second`;
  fs.mkdirSync(path.join(hub, "inner"), { recursive: true });
  fs.mkdirSync(elsewhere);
  fs.mkdirSync(second);
  fs.writeFileSync(path.join(hub, "inner", "inner.txt"), "inner");
  fs.writeFileSync(path.join(elsewhere, "linked.txt"), "linked");
  fs.writeFileSync(path.join(second, "second.txt"), "second");
  const dirType = process.platform === "win32" ? "junction" : "dir";
  try {
    fs.symlinkSync(elsewhere, path.join(hub, "linked"), dirType);
    fs.symlinkSync(second, path.join(hub, "second"), dirType);
    fs.symlinkSync(path.join(hub, "inner"), path.join(hub, "alias"), dirType);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return null;
    }
    throw error;
  }
  allowFileRoot(hub);
  return { hub, elsewhere, second };
}

test("lists a link that leaves the project with its target and refuses to open it", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere } = fixture;

  const listing = await request("GET", hub, "list");
  assert.equal(listing.status, 200);
  const { entries } = await listing.json();
  const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
  assert.deepEqual(byName.linked, { name: "linked", isDir: true, size: 0, modified: "", outsideLinkTarget: elsewhere });
  assert.equal(byName.second.outsideLinkTarget, fixture.second);
  assert.deepEqual(byName.alias, { name: "alias", isDir: true, size: 0, modified: "" });
  assert.deepEqual(byName.inner, { name: "inner", isDir: true, size: 0, modified: "" });

  assert.equal((await request("GET", path.join(hub, "linked"), "list")).status, 403);
  assert.equal((await request("GET", path.join(hub, "linked", "linked.txt"), "read")).status, 403);
});

test("browses a link that stays inside the project without approval", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub } = fixture;

  const listing = await request("GET", path.join(hub, "alias"), "list");
  assert.equal(listing.status, 200);
  assert.deepEqual((await listing.json()).entries.map((entry) => entry.name), ["inner.txt"]);
  const read = await request("GET", path.join(hub, "alias", "inner.txt"), "read");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, "inner");
});

test("an explicit allow-link request makes that link target browsable", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere, second } = fixture;

  const allowed = await allowLink(path.join(hub, "linked"), elsewhere);
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { path: elsewhere });

  const listing = await request("GET", path.join(hub, "linked"), "list");
  assert.equal(listing.status, 200);
  assert.deepEqual((await listing.json()).entries.map((entry) => entry.name), ["linked.txt"]);
  const read = await request("GET", path.join(hub, "linked", "linked.txt"), "read");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, "linked");

  // The parent no longer reports that link as leaving the roots, but every
  // other link is still its own decision.
  const { entries } = await (await request("GET", hub, "list")).json();
  const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
  assert.equal(byName.linked.outsideLinkTarget, undefined);
  assert.equal(byName.second.outsideLinkTarget, second);
  assert.equal((await request("GET", path.join(hub, "second"), "list")).status, 403);
});

test("allow-link refuses anything that is not a directory link inside the roots", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere } = fixture;

  assert.equal((await allowLink(path.join(hub, "inner"), path.join(hub, "inner"))).status, 400);
  assert.equal((await allowLink(path.join(elsewhere, "linked.txt"), elsewhere)).status, 403);
  assert.equal((await request("GET", path.join(hub, "linked"), "list")).status, 403);
});

test("allow-link grants only the target the listing showed", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere, second } = fixture;
  const link = path.join(hub, "linked");

  // Without the shown target, or as a simple request that skips CORS preflight.
  assert.equal((await request("POST", link, "allow-link", {})).status, 400);
  assert.equal((await request("POST", link, "allow-link", { target: elsewhere }, "text/plain")).status, 415);

  // The link was pointed elsewhere after it was listed.
  const changed = await allowLink(link, second);
  assert.equal(changed.status, 409);
  assert.equal((await request("GET", path.join(hub, "second"), "list")).status, 403);
  assert.equal((await request("GET", link, "list")).status, 403);
});

test("a `..` carried inside an encoded segment cannot climb out through a link", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere } = fixture;
  // The filesystem resolves hub/linked/../x from the link target, reaching the
  // directory beside `elsewhere`; lexically it names hub/x, which exists too.
  const beside = path.join(path.dirname(elsewhere), "beside.txt");
  fs.writeFileSync(beside, "outside");
  fs.writeFileSync(path.join(hub, "beside.txt"), "inside");
  t.after(() => fs.rmSync(beside, { force: true }));

  // `%2F` survives URL parsing, so the catch-all receives one decoded segment.
  const segments = [...encodeFilePathForApi(hub).split("/").map(decodeURIComponent), "linked/../beside.txt"];
  const response = await GET(
    new NextRequest(`http://localhost/api/files/x?type=read`, { headers: { host: "localhost" } }),
    { params: Promise.resolve({ path: segments }) },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});

test("a cwd that climbs out through a link is refused by the other routes too", async (t) => {
  const fixture = createHub(t);
  if (!fixture) return;
  const { hub, elsewhere } = fixture;
  const beside = path.join(path.dirname(elsewhere), "beside-secret.txt");
  fs.writeFileSync(beside, "outside");
  t.after(() => fs.rmSync(beside, { force: true }));

  // Query-string paths are not normalized by URL parsing, so `..` reaches the
  // existing-path check, which must refuse it rather than read it as `hub`.
  const cwd = `${hub}${path.sep}linked${path.sep}..`;
  const response = await getFileIndex(new NextRequest(
    `http://localhost/api/file-index?cwd=${encodeURIComponent(cwd)}`,
    { headers: { host: "localhost" } },
  ));
  assert.equal(response.status, 403);
});
