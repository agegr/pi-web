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
