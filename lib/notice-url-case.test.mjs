import assert from "node:assert/strict";
import test from "node:test";
import { splitNoticeLinks } from "./notice-text.ts";

test("notice links accept case-insensitive HTTP schemes without changing paths", () => {
  const message = "Open HTTPS://Example.com/CaseSensitive?Token=AbC. Or Http://[::1]:3000/review";
  const parts = splitNoticeLinks(message);
  const links = parts.filter((part) => part.kind === "link").map((part) => part.text);
  assert.deepEqual(links, ["HTTPS://Example.com/CaseSensitive?Token=AbC", "Http://[::1]:3000/review"]);
  assert.equal(parts.map((part) => part.text).join(""), message);
  assert.equal(new URL(links[0]).pathname, "/CaseSensitive");
  assert.deepEqual(splitNoticeLinks("HTTPS:// alone"), [{ kind: "text", text: "HTTPS:// alone" }]);
});
