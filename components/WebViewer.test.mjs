import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./WebViewer.tsx", import.meta.url), "utf8");

test("web viewer validates and normalizes user-entered addresses before framing them", () => {
  assert.match(source, /normalizeWebUrl\(input\)/);
  assert.match(source, /onNavigate\(nextUrl, getWebUrlLabel\(nextUrl\)\)/);
  assert.match(source, /inputMode="url"/);
  assert.match(source, /type="text"/);
});

test("web viewer uses a native Electron webview when available and preserves the iframe fallback", () => {
  assert.match(source, /createElement\("webview"/);
  assert.match(source, /partition: "persist:pi-web-web"/);
  assert.match(source, /expectedUrlRef\.current = currentUrl/);
  assert.match(source, /if \(currentUrl !== url\) webview\.src = url/);
  assert.match(source, /desktop \? \(/);
  assert.match(source, /<iframe/);
  assert.match(source, /sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-storage-access-by-user-activation"/);
  assert.match(source, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
});
