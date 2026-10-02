import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("renders top-bar panels in a body portal above themed stacking contexts", () => {
  assert.match(source, /import \{ createPortal \} from "react-dom"/);
  assert.match(
    source,
    /activeTopPanel && topPanelPos && typeof document !== "undefined" && createPortal\([\s\S]*?position: "fixed"[\s\S]*?zIndex: 500[\s\S]*?document\.body/,
  );
});
