import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { contentDispositionFileName } = await jiti.import("./session-export-client.ts");

test("/export saves the file under the name the export route gives", () => {
  assert.equal(
    contentDispositionFileName(`attachment; filename="pi-session-a_b.html"; filename*=UTF-8''pi-session-a_b.html`),
    "pi-session-a_b.html",
  );
  assert.equal(
    contentDispositionFileName(`attachment; filename="pi-session-__.html"; filename*=UTF-8''pi-session-%E4%BC%9A%E8%AF%9D.html`),
    "pi-session-会话.html",
  );
  assert.equal(contentDispositionFileName(`attachment; filename="plain.html"`), "plain.html");
  assert.equal(contentDispositionFileName(`attachment; filename*=UTF-8''%E0%A4%A; filename="fallback.html"`), "fallback.html");
  assert.equal(contentDispositionFileName(null), null);
});
