import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  splitDialogTitle,
  splitDialogTitleCode,
} = await jiti.import("./dialog-title.ts");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const React = await jiti.import("react");

test("splitDialogTitle keeps a one-line title entirely in the head", () => {
  assert.deepEqual(splitDialogTitle("Approve command"), {
    head: "Approve command",
    rest: "",
  });
});

test("splitDialogTitle splits on the first newline only", () => {
  assert.deepEqual(splitDialogTitle("Run this\ncommand here\nmore"), {
    head: "Run this",
    rest: "command here\nmore",
  });
});

test("splitDialogTitle keeps a blank title intact", () => {
  assert.deepEqual(splitDialogTitle(""), { head: "", rest: "" });
});

test("splitDialogTitleCode leaves text with no code fence as a single text segment", () => {
  assert.deepEqual(splitDialogTitleCode("Approve command"), [
    { text: "Approve command", isCode: false },
  ]);
});

test("splitDialogTitleCode highlights a ```bash code fence", () => {
  const segments = splitDialogTitleCode("Confirm running:\n```bash\nrm -rf /\n```");
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0], { text: "Confirm running:\n", isCode: false });
  assert.deepEqual(segments[1], { text: "rm -rf /", isCode: true });
  assert.deepEqual(segments[2], { text: "", isCode: false });
});

test("splitDialogTitleCode highlights a plain ```sh code fence", () => {
  const segments = splitDialogTitleCode("Run:\n```sh\ndocker system prune -a\n```");
  assert.equal(segments[1].isCode, true);
  assert.equal(segments[1].text, "docker system prune -a");
});

test("splitDialogTitleCode highlights multiple consecutive code fences", () => {
  const segments = splitDialogTitleCode("A\n```sh\na\n```\nB\n```bash\nb\n```\nC");
  assert.deepEqual(
    segments.map((s) => s.isCode),
    [false, true, false, true, false],
  );
});

test("renderDialogTitle renders code segments inside <pre> and text as pre-wrap spans", () => {
  // A small inline reimplementation of the ChatWindow renderDialogTitle mapping to
  // assert the segment contract the component relies on.
  const segments = splitDialogTitleCode("Run:\n```sh\nrm -rf /\n```");
  const markup = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      segments.map((seg, i) =>
        seg.isCode
          ? React.createElement("pre", { key: i }, seg.text)
          : React.createElement("span", { key: i, style: { whiteSpace: "pre-wrap", wordBreak: "break-word" } }, seg.text),
      ),
    ),
  );
  assert.match(markup, /<pre>rm -rf \/<\/pre>/);
  assert.match(markup, /<span[^>]*white-space:pre-wrap[^>]*>Run:\n<\/span>/);
});
