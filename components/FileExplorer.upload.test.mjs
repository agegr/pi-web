import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("uploads branch through the native document picker only inside Capacitor shells (pi#31)", () => {
  assert.match(source, /import \{ filesFromPickedFiles, getCapacitorFilePicker \} from "@\/lib\/capacitor-bridge";/);
  // The native branch precedes the WebView chooser and feeds the unchanged
  // upload pipeline (prepareUpload → uploadFiles XHR).
  assert.match(
    source,
    /const FilePicker = getCapacitorFilePicker\(\);\s*\n\s*if \(FilePicker\) \{[\s\S]*?await FilePicker\.pickFiles\(\{ readData: true \}\);[\s\S]*?await prepareUpload\(filesFromPickedFiles\(files\)\);/,
  );
  // Cancelled picks stay silent.
  assert.match(source, /catch \{\s*\n\s*\/\/ Cancelled picks and unavailable pickers stay silent/);
  // The browser/PWA path is untouched: the standard hidden input flow still
  // opens the chooser outside the shells.
  assert.match(source, /uploadInputRef\.current\?\.click\(\);/);
  assert.match(source, /<input ref=\{uploadInputRef\} type="file" multiple hidden onChange=\{handleUploadInput\} \/>/);
  // The upload transport itself is unchanged — the same XHR to /api/files.
  assert.match(source, /\?type=upload&conflict=\$\{strategy\}/);
  assert.match(source, /const xhr = new XMLHttpRequest\(\);/);
});

test("native upload picks do not bypass the conflict/replace flow", () => {
  // filesFromPickedFiles feeds prepareUpload, not performUpload, so the
  // existing conflict prompt (pendingConflict / overwrite / skip) still gates
  // native picks exactly like browser picks.
  const prepareUploadIndex = source.indexOf("prepareUpload(filesFromPickedFiles(files))");
  const performUploadIndex = source.indexOf("const performUpload = useCallback");
  assert.ok(prepareUploadIndex > 0);
  assert.ok(performUploadIndex > 0);
  assert.ok(performUploadIndex < prepareUploadIndex, "prepareUpload pipeline still owns native picks");
});
