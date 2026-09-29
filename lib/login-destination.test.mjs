import assert from "node:assert/strict";
import test from "node:test";

const { safeLoginDestination } = await import("./login-destination.ts");

const origin = "http://127.0.0.1:30141";

test("returns to the local page that sent the browser to the login page", () => {
  assert.equal(safeLoginDestination("/?session=abc", origin), `${origin}/?session=abc`);
  assert.equal(safeLoginDestination("/?cwd=%2Fhome%2Fpi#top", origin), `${origin}/?cwd=%2Fhome%2Fpi#top`);
});

test("falls back to the app root without a usable destination", () => {
  assert.equal(safeLoginDestination(null, origin), "/");
  assert.equal(safeLoginDestination("", origin), "/");
  assert.equal(safeLoginDestination("session", origin), "/");
  assert.equal(safeLoginDestination("https://evil.example/", origin), "/");
  assert.equal(safeLoginDestination("javascript:alert(1)", origin), "/");
});

test("rejects paths the URL parser resolves to another host", () => {
  for (const next of [
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\\\tevil.example",
  ]) {
    assert.equal(safeLoginDestination(next, origin), "/", JSON.stringify(next));
  }
});
