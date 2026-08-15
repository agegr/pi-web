import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./RemoteAccessConfig.tsx", import.meta.url), "utf8");

test("remote access settings save allowed hosts and password through the dedicated API", () => {
  assert.match(source, /fetch\("\/api\/remote-access"/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /allowedHosts: draft\.allowedHosts/);
  assert.match(source, /body\.password = draft\.password/);
  assert.match(source, /body\.password = null/);
  assert.doesNotMatch(source, /passwordHash/);
});

test("remote access settings keep listen address read-only and warn about public exposure", () => {
  assert.match(source, /remote\.warning/);
  assert.match(source, /bindHostname/);
  assert.match(source, /settings-readonly-value/);
  assert.match(source, /http:\/\/\$\{snapshot\.bindHostname\}:\$\{snapshot\.bindPort\}/);
  assert.doesNotMatch(source, /0\.0\.0\.0/);
  assert.doesNotMatch(source, /http:\/\/127\.0\.0\.1:\$\{snapshot\.bindPort\}/);
});
