import assert from "node:assert/strict";
import test from "node:test";
import { isPlainActivation, sessionDeepLink } from "./session-links.ts";
import { getInitialNavigation, withTabOpen } from "./initial-navigation.ts";

const plain = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

test("a session link is the encoded id in ?session= and nothing else", () => {
  assert.equal(sessionDeepLink("abc-123"), "?session=abc-123");
  assert.equal(sessionDeepLink("a/b?c&d=1+two #%"), "?session=a%2Fb%3Fc%26d%3D1%2Btwo%20%23%25");
  assert.equal(sessionDeepLink("会话"), "?session=%E4%BC%9A%E8%AF%9D");
});

test("resolved on the page, it keeps origin and path and drops every other parameter", () => {
  const pages = [
    "http://127.0.0.1:30141/",
    "http://127.0.0.1:30141/?session=old#e1",
    // A sub-path deployment, with a stale cwd that would otherwise win over session.
    "https://example.github.io/pi-web/?cwd=%2Fwork%2Fold&session=old#entry",
  ];
  for (const page of pages) {
    const current = new URL(page);
    for (const id of ["abc-123", "a/b?c&d=1+two #%", "https://external.invalid/x", "//evil.invalid"]) {
      const target = new URL(sessionDeepLink(id), current);
      assert.equal(target.origin, current.origin, `${id} on ${page} stays on this instance`);
      assert.equal(target.pathname, current.pathname, `${id} on ${page} keeps the path`);
      assert.deepEqual([...target.searchParams.keys()], ["session"]);
      assert.equal(target.searchParams.get("session"), id);
      assert.equal(target.hash, "");
    }
  }
});

test("the link's session wins over whatever session the new tab remembers", () => {
  const target = new URL(sessionDeepLink("linked"), "http://127.0.0.1:30141/?cwd=%2Fwork");
  const navigation = getInitialNavigation(target.searchParams);
  assert.equal(navigation.requestedCwd, null);
  assert.equal(navigation.sessionId, "linked");
  assert.equal(withTabOpen(navigation, { kind: "session", sessionId: "other-tab" }).sessionId, "linked");
  assert.equal(withTabOpen(navigation, { kind: "new", cwd: "/work" }).sessionId, "linked");
});

test("only an unmodified primary activation stays in the page", () => {
  assert.equal(isPlainActivation(plain), true);
  for (const change of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { button: 2 },
    { defaultPrevented: true },
  ]) {
    assert.equal(isPlainActivation({ ...plain, ...change }), false, JSON.stringify(change));
  }
});
