import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

const jiti = createJiti(import.meta.url);
const uploadClient = await jiti.import("../lib/file-upload-client.ts");
const { formatImageBytes } = await jiti.import("../lib/model-image-limits.ts");
const { errorMessage } = await jiti.import("../lib/errors.ts");

const sourceText = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("ChatWindow.tsx", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Runs one of ChatWindow's useCallback bodies against the given scope. */
function chatWindowCallback(name, context) {
  function findCallback(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      return node.initializer.arguments[0];
    }
    return ts.forEachChild(node, findCallback);
  }
  return new Script(ts.transpileModule(findCallback(source).getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText).runInNewContext(context);
}

const photo = new File(["x"], "photo.png", { type: "image/png" });
const report = new File(["x"], "report.pdf", { type: "application/pdf" });
const log = new File(["x"], "server.log", { type: "" });

/** Runs ChatWindow's real drop path, as the composer's attach button or a drop does. */
async function drop(items, { cwd = "/project", response } = {}) {
  const calls = { images: [], uploads: [], mentions: [], notices: [], refreshed: 0 };
  const scope = {
    session: null,
    newSessionCwd: cwd,
    chatInputRef: {
      current: {
        addImages: (images) => calls.images.push(...images),
        insertText: (text) => calls.mentions.push(text),
      },
    },
    addNotice: (notice) => calls.notices.push([notice.type, notice.message]),
    t: (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    onFilesUploaded: () => { calls.refreshed += 1; },
    ...uploadClient,
    formatImageBytes,
    errorMessage,
    uploadFiles: async (target, uploads, strategy) => {
      calls.uploads.push([target, uploads.map((item) => item.path), strategy]);
      return response;
    },
  };
  scope.uploadDroppedItems = chatWindowCallback("uploadDroppedItems", scope);
  scope.onDrop = chatWindowCallback("onDrop", scope);
  if (items.every((item) => item instanceof File)) chatWindowCallback("onAttachFiles", scope)(items);
  else scope.onDrop(items);
  await new Promise((resolve) => setImmediate(resolve));
  return calls;
}

/** Picks files with the composer's attach button. */
const attach = (files, options) => drop(files, options);

function folder(name, children) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      const entries = Object.entries(children).map(([childName, value]) => (
        value instanceof File
          ? { name: childName, isFile: true, isDirectory: false, file: (resolve) => resolve(value) }
          : folder(childName, value)
      ));
      return { readEntries: (resolve) => resolve(entries.splice(0, entries.length)) };
    },
  };
}

test("the attach button sends picked files down the chat drop path (#1101)", async () => {
  const mixed = await attach([photo, report, log], {
    response: { status: 207, data: { uploaded: ["report.pdf"], skipped: ["server.log"] } },
  });
  // Images attach to the prompt; the rest are uploaded like a drop: never replacing a file, then mentioned.
  assert.deepEqual(mixed.images, [photo]);
  assert.deepEqual(mixed.uploads, [["/project", ["report.pdf", "server.log"], "skip"]]);
  assert.deepEqual(mixed.mentions, ["@report.pdf @server.log "]);
  assert.deepEqual(mixed.notices, [
    ["success", 'chat.dropUploaded {"count":1}'],
    ["warning", 'chat.dropAlreadyExists {"names":"server.log"}'],
  ]);
  assert.equal(mixed.refreshed, 1);

  const imagesOnly = await attach([photo]);
  assert.deepEqual(imagesOnly.images, [photo]);
  assert.deepEqual(imagesOnly.uploads, []);
  assert.deepEqual(imagesOnly.notices, []);
});

test("without a working directory, picked files behave like a drop there (#1101)", async () => {
  const calls = await attach([photo, report], { cwd: null });
  assert.deepEqual(calls.images, [photo]);
  assert.deepEqual(calls.uploads, []);
  assert.deepEqual(calls.notices, [["warning", "chat.dropNeedsCwd"]]);
});

test("a dropped folder uploads with its subfolders and is mentioned once (#1786)", async () => {
  const entry = folder("data", { "a.csv": report, sub: { "b.csv": log }, ".DS_Store": log, "photo.png": photo });
  const calls = await drop([{ kind: "folder", name: "data", entry }, { kind: "file", file: photo }], {
    response: { status: 200, data: { uploaded: ["data/a.csv", "data/sub/b.csv", "data/photo.png"], skipped: [] } },
  });
  // A top-level image still attaches; one inside the folder is part of the folder.
  assert.deepEqual(calls.images, [photo]);
  assert.deepEqual(calls.uploads, [["/project", ["data/a.csv", "data/sub/b.csv", "data/photo.png"], "skip"]]);
  assert.deepEqual(calls.mentions, ["@data/ "]);
});

test("a drop over the upload limit is refused before anything is sent (#1786)", async () => {
  const big = new File([new Uint8Array(60 * 1024 * 1024)], "big.bin");
  const other = new File([new Uint8Array(41 * 1024 * 1024)], "other.bin");
  const calls = await drop([{ kind: "folder", name: "data", entry: folder("data", { "big.bin": big, "other.bin": other }) }]);
  assert.deepEqual(calls.uploads, []);
  assert.deepEqual(calls.notices, [["error", 'files.uploadTooLarge {"size":"101 MiB","limit":"100 MiB"}']]);
});
