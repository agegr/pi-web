import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const routeSource = await import("node:fs/promises").then(({ readFile }) =>
  readFile(new URL("./[...path]/route.ts", import.meta.url), "utf8"));

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { validateMkdirFolderName } = await jiti.import("../../../lib/file-upload.ts");

test("mkdir reuses the upload path's security machinery verbatim", async () => {
  const route = routeSource;
  // Trust gate first, exactly like every other POST branch.
  const postStart = route.indexOf("export async function POST(");
  const mkdirStart = route.indexOf('if (type === "mkdir")');
  const trustCheck = route.indexOf("if (!isApiRequestAllowed(request))");
  assert.ok(postStart !== -1 && trustCheck > postStart);
  assert.ok(mkdirStart > trustCheck, "mkdir branch must sit behind the trust gate");
  const mkdirBlock = route.slice(mkdirStart, route.indexOf('if (type !== "upload")', mkdirStart));
  // The allowed-roots check (including the realpathSync symlink defense) is
  // the shared getUploadDirectory helper, resolved before the mkdir branch.
  assert.match(route.slice(postStart, mkdirStart), /await getUploadDirectory\(segments\)/);
  assert.match(mkdirBlock, /validateMkdirFolderName\(name\)/);
  // Exactly parent/name, no intermediates.
  assert.match(mkdirBlock, /path\.join\(directory, name as string\)/);
  assert.match(mkdirBlock, /fs\.mkdirSync\(destination, \{ recursive: false \}\)/);
  // An existing target answers a typed 409 conflict with nothing overwritten.
  assert.match(mkdirBlock, /code === "EEXIST"[\s\S]*?status: 409/);
  assert.match(mkdirBlock, /conflict: true/);
  // Invalid names answer 400 before any filesystem write.
  assert.match(mkdirBlock, /validateMkdirFolderName\(name\)[\s\S]*?status: 400/);
});

test("outside-roots parents are refused before mkdir runs", async () => {
  const route = routeSource;
  // getUploadDirectory is the shared allowed-roots + realpath gate; the mkdir
  // branch runs only after it resolves (the "response" early-return above).
  const uploadDirStart = route.indexOf("async function getUploadDirectory(");
  const uploadDirBlock = route.slice(uploadDirStart, route.indexOf("function parseUploadFileNames"));
  assert.match(uploadDirBlock, /isFilePathAllowed\(directory, allowedRoots\)/);
  assert.match(uploadDirBlock, /realDirectory = fs\.realpathSync\(directory\)/);
  assert.match(uploadDirBlock, /isFilePathAllowed\(realDirectory, realRoots\)/);
  assert.match(uploadDirBlock, /status: 403/);
  const mkdirStart = route.indexOf('if (type === "mkdir")');
  const postBlock = route.slice(route.indexOf("export async function POST("));
  assert.ok(postBlock.indexOf('if ("response" in uploadDirectory) return uploadDirectory.response;') < mkdirStart);
});

test("mkdir is refused for a path-style or missing folder name", async () => {
  // The route's name gate is the pure validator; behavioral coverage lives
  // here so the 400 contract is established without standing up Next.
  assert.match(validateMkdirFolderName("a/b"), /must not contain a path/);
  assert.match(validateMkdirFolderName(null), /required/);
});

test("recursive mkdir conflicts are detectable against a real filesystem", async (t) => {
  // Establishes the EEXIST contract the route maps to 409: mkdirSync with
  // recursive:false throws EEXIST for files AND directories, and never
  // overwrites the existing target.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-mkdir-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "existing");
  fs.writeFileSync(target, "keep me");
  assert.throws(() => fs.mkdirSync(target, { recursive: false }), (error) => error.code === "EEXIST");
  assert.equal(fs.readFileSync(target, "utf8"), "keep me");
  // The parent must already exist — no intermediates are created.
  assert.throws(
    () => fs.mkdirSync(path.join(root, "missing/child"), { recursive: false }),
    (error) => error.code === "ENOENT",
  );
});
