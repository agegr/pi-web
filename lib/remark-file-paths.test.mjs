import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { remarkFilePaths } = await jiti.import("./remark-file-paths.ts");

function runTransform(tree) {
  remarkFilePaths()(tree);
  return tree;
}

function paragraph(...children) {
  return { type: "root", children: [{ type: "paragraph", children }] };
}

function text(value) {
  return { type: "text", value };
}

test("splits a text node around a file path", () => {
  const tree = runTransform(paragraph(text("Generated /tmp/a.html now")));

  assert.deepEqual(tree.children[0].children, [
    { type: "text", value: "Generated " },
    {
      type: "link",
      url: "/tmp/a.html",
      children: [{ type: "text", value: "/tmp/a.html" }],
    },
    { type: "text", value: " now" },
  ]);
});

test("does not descend into code blocks", () => {
  const tree = runTransform({
    type: "root",
    children: [{ type: "code", lang: "bash", value: "cat /tmp/a.html" }],
  });

  assert.deepEqual(tree.children, [
    { type: "code", lang: "bash", value: "cat /tmp/a.html" },
  ]);
});

test("does not descend into inline code", () => {
  const tree = runTransform(
    paragraph({ type: "inlineCode", value: "/tmp/a.html" }),
  );

  assert.deepEqual(tree.children[0].children, [
    { type: "inlineCode", value: "/tmp/a.html" },
  ]);
});

test("does not nest a link inside an existing link", () => {
  const tree = runTransform(
    paragraph({
      type: "link",
      url: "/tmp/a.html",
      children: [text("/tmp/a.html")],
    }),
  );

  assert.deepEqual(tree.children[0].children, [
    {
      type: "link",
      url: "/tmp/a.html",
      children: [{ type: "text", value: "/tmp/a.html" }],
    },
  ]);
});

test("splits several paths in one text node", () => {
  const tree = runTransform(paragraph(text("/tmp/a.html and /tmp/b.md")));
  const types = tree.children[0].children.map((node) => node.type);

  assert.deepEqual(types, ["link", "text", "link"]);
});

test("transforms text nested in emphasis and list items", () => {
  const tree = runTransform({
    type: "root",
    children: [
      {
        type: "list",
        children: [
          {
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [
                  { type: "strong", children: [text("see /tmp/a.html")] },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  const strong = tree.children[0].children[0].children[0].children[0];
  assert.deepEqual(
    strong.children.map((node) => node.type),
    ["text", "link"],
  );
});

test("leaves a tree without paths unchanged", () => {
  const tree = runTransform(paragraph(text("nothing to see")));

  assert.deepEqual(tree.children[0].children, [
    { type: "text", value: "nothing to see" },
  ]);
});
