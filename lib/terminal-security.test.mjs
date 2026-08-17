import assert from "node:assert/strict";
import test from "node:test";

import { getTerminalAccessError, isLoopbackTerminalRequest } from "./terminal-security.ts";

function authorization(password) {
  return `Basic ${Buffer.from(`pi:${password}`, "utf8").toString("base64")}`;
}

function request(host, options = {}) {
  return new Request(`http://${host}/api/sessions/s/terminal`, {
    method: options.method ?? "POST",
    headers: {
      host,
      origin: `http://${host}`,
      "sec-fetch-site": "same-origin",
      ...(options.json === false ? {} : { "content-type": "application/json" }),
      ...(options.authorization ? { authorization: options.authorization } : {}),
      ...(options.headers ?? {}),
    },
  });
}

test("terminal access accepts only loopback hostnames", () => {
  assert.equal(isLoopbackTerminalRequest(request("127.0.0.1:30141")), true);
  assert.equal(isLoopbackTerminalRequest(request("localhost:30141")), true);
  assert.equal(isLoopbackTerminalRequest(request("[::1]:30141")), true);
  assert.equal(isLoopbackTerminalRequest(request("192.168.1.20:30141")), false);
  assert.equal(isLoopbackTerminalRequest(request("pi-web.internal:30141")), false);
});

test("terminal access requires a configured password and valid authentication", () => {
  const previous = process.env.PI_WEB_PASSWORD;
  try {
    delete process.env.PI_WEB_PASSWORD;
    assert.equal(getTerminalAccessError(request("localhost:30141"))?.status, 503);

    process.env.PI_WEB_PASSWORD = "secret";
    assert.equal(getTerminalAccessError(request("localhost:30141"))?.status, 401);
    assert.equal(
      getTerminalAccessError(request("localhost:30141", { authorization: authorization("wrong") }))?.status,
      401,
    );
    assert.equal(
      getTerminalAccessError(request("localhost:30141", { authorization: authorization("secret") })),
      null,
    );
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = previous;
  }
});

test("terminal access rejects LAN, cross-origin, and non-JSON commands", () => {
  const previous = process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "secret";
  try {
    const auth = authorization("secret");
    assert.equal(getTerminalAccessError(request("192.168.1.20:30141", { authorization: auth }))?.status, 403);
    assert.equal(getTerminalAccessError(request("localhost:30141", {
      authorization: auth,
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    }))?.status, 403);
    assert.equal(getTerminalAccessError(
      request("localhost:30141", { authorization: auth, json: false }),
      { requireJson: true },
    )?.status, 415);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = previous;
  }
});
