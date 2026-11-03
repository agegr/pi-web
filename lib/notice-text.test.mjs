import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./notice-text.ts");
}

// qrcode-terminal's `small` output: █ ▀ ▄ and runs of spaces that must keep their width.
const QR = [
  "▄▄▄▄▄▄▄▄▄▄▄",
  "█ ▄▄▄ █▀▄ █",
  "█ █   █  ▄█",
  "█▄▄▄▄▄█▄▀▄█",
  "▀▀▀▀▀▀▀▀▀▀▀",
].join("\n");

test("keeps a terminal QR code in a notice apart from its prose (#755)", async () => {
  const { splitNoticeText } = await loadSubject();
  const message = `请用微信扫码登录：\n\n${QR}\n\n二维码链接：https://example.com/q`;

  const parts = splitNoticeText(message);

  assert.deepEqual(parts, [
    { kind: "text", text: "请用微信扫码登录：\n\n" },
    { kind: "art", text: QR },
    { kind: "text", text: "\n\n二维码链接：https://example.com/q" },
  ]);
  assert.equal(parts.map((part) => part.text).join(""), message);
});

test("leaves a notice without block characters as one piece of prose", async () => {
  const { splitNoticeText } = await loadSubject();

  assert.deepEqual(splitNoticeText("Saved   to\n  disk"), [{ kind: "text", text: "Saved   to\n  disk" }]);
  assert.deepEqual(splitNoticeText(""), []);
});

test("starts a new run after a line without blocks", async () => {
  const { splitNoticeText } = await loadSubject();

  assert.deepEqual(splitNoticeText("█▀█\n\n█▄█\nok ▌"), [
    { kind: "art", text: "█▀█" },
    { kind: "text", text: "\n\n" },
    { kind: "art", text: "█▄█\nok ▌" },
  ]);
});

test("notice URLs become link parts without their sentence punctuation", async () => {
  const { splitNoticeLinks } = await loadSubject();
  const message = "Code review opened at http://localhost:39193. Or see (https://example.com/a?b=1), then go.";
  const parts = splitNoticeLinks(message);
  assert.deepEqual(parts.filter((part) => part.kind === "link").map((part) => part.text), [
    "http://localhost:39193",
    "https://example.com/a?b=1",
  ]);
  assert.equal(parts.map((part) => part.text).join(""), message);
  assert.deepEqual(splitNoticeLinks("no links here"), [{ kind: "text", text: "no links here" }]);
  assert.deepEqual(splitNoticeLinks("https:// alone"), [{ kind: "text", text: "https:// alone" }]);
});
