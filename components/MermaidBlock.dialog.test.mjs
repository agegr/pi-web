import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./MermaidBlock.tsx", import.meta.url), "utf8");
const image = await readFile(new URL("./ImagePreview.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("full-screen viewers share Codex viewer and close chrome", () => {
  assert.match(image, /className="codex-viewer image-preview-dialog"/);
  assert.match(image, /className="codex-viewer-close image-preview-close"/);
  assert.match(source, /className="codex-viewer mermaid-zoom-dialog"/);
  assert.match(source, /className="codex-viewer-close mermaid-zoom-icon-button"/);
});

test("ordinary viewers use consistent backdrop while image preview keeps media contrast", () => {
  assert.match(styles, /\.codex-viewer::backdrop\s*\{\s*background:\s*rgba\(0, 0, 0, \.4\);/);
  assert.match(styles, /\.image-preview-dialog::backdrop\s*\{\s*background:\s*rgba\(0, 0, 0, 0\.72\);/);
});

test("Mermaid viewer preserves zoom controls and Escape close", () => {
  assert.match(source, /setZoom\(\(value\) => Math\.max\(ZOOM_MIN/);
  assert.match(source, /setZoom\(\(value\) => Math\.min\(ZOOM_MAX/);
  assert.match(source, /event\.key !== "Escape"[\s\S]*?onClose\(\)/);
});

test("Mermaid zoom keeps the trigger mounted and restores focus on close", () => {
  assert.match(source, /previewButtonRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(source, /visibility: "hidden"/);
  assert.match(source, /onClosed=\{\(\) => previewButtonRef\.current\?\.focus/);
  assert.match(source, /onClosed\?\.\(\)/);
});

test("Mermaid zoom controls meet touch target size on coarse pointers", () => {
  assert.match(styles, /@media \(pointer: coarse\)[\s\S]*?\.mermaid-zoom-stepper button,[\s\S]*?\.mermaid-zoom-icon-button[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
});
