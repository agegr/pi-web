import assert from "node:assert/strict";
import test from "node:test";
import { isPlainActivation, newSessionDeepLink, sessionDeepLink } from "./session-links.ts";
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

test("a fresh-composer link encodes its directory and drops stale navigation parameters", () => {
  assert.equal(newSessionDeepLink("/work/a b&c#d%"), "?cwd=%2Fwork%2Fa%20b%26c%23d%25");
  for (const page of [
    "http://127.0.0.1:30141/?session=old#entry",
    "https://example.invalid/pi-web/?cwd=%2Fold&session=old&sidebar=collapsed#entry",
  ]) {
    const current = new URL(page);
    for (const cwd of ["/work/项目 & notes#1+%", "C:\\Projects\\a b", "\\\\server\\share\\项目", "//external.invalid/path"]) {
      const target = new URL(newSessionDeepLink(cwd), current);
      assert.equal(target.origin, current.origin);
      assert.equal(target.pathname, current.pathname);
      assert.deepEqual([...target.searchParams.keys()], ["cwd"]);
      assert.equal(target.searchParams.get("cwd"), cwd);
      assert.equal(target.hash, "");
    }
  }
});

test("a fresh-composer link never restores the tab's remembered session or directory", () => {
  const target = new URL(newSessionDeepLink("/work/project"), "http://127.0.0.1:30141/?session=old");
  const navigation = getInitialNavigation(target.searchParams);
  assert.equal(navigation.requestedCwd, "/work/project");
  assert.equal(navigation.sessionId, null);
  for (const remembered of [{ kind: "session", sessionId: "old" }, { kind: "new", cwd: "/old" }]) {
    assert.equal(withTabOpen(navigation, remembered), navigation);
  }
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
