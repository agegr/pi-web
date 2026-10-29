import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import { openWhenServing, waitForFirstPage } from "../bin/browser-opener.js";

async function listen(t, host, handler) {
  const server = http.createServer(handler);
  server.listen(0, host);
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test("waits for the whole page a redirect leads to", async (t) => {
  const requested = [];
  let bodyEnded = false;
  const port = await listen(t, "127.0.0.1", (request, response) => {
    requested.push(request.url);
    if (request.url === "/") {
      response.writeHead(307, { Location: "/login" });
      response.end();
      return;
    }
    response.write("login page");
    setTimeout(() => {
      bodyEnded = true;
      response.end();
    }, 50);
  });

  assert.equal(await waitForFirstPage(`http://127.0.0.1:${port}/`), true);
  assert.equal(bodyEnded, true);
  assert.deepEqual(requested, ["/", "/login"]);
});

test("counts any status as an answer", async (t) => {
  const port = await listen(t, "127.0.0.1", (request, response) => {
    response.writeHead(403);
    response.end("Untrusted request");
  });

  assert.equal(await waitForFirstPage(`http://127.0.0.1:${port}/`), true);
});

test("asks again after a refused connection", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init);
    if (calls.length < 3) throw new TypeError("fetch failed");
    return new Response("page");
  };

  assert.equal(await waitForFirstPage("http://x/", { fetchImpl, retryMs: 1 }), true);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test("gives up at the deadline without rejecting", async () => {
  // A real fetch keeps the process alive with its socket. Stand in for it, or
  // Node 22's test runner cancels the test once only the deadline's unref'd
  // timer is left.
  const hanging = (url, { signal }) => new Promise((resolve, reject) => {
    const socket = setTimeout(() => {}, 60_000);
    signal.addEventListener("abort", () => {
      clearTimeout(socket);
      reject(signal.reason);
    });
  });
  assert.equal(await waitForFirstPage("http://x/", { fetchImpl: hanging, timeoutMs: 30 }), false);

  const refused = async () => {
    throw new TypeError("fetch failed");
  };
  assert.equal(await waitForFirstPage("http://x/", { fetchImpl: refused, timeoutMs: 30, retryMs: 5 }), false);
});

test("opens the launch URL once the server answered on loopback", async (t) => {
  // Loopback is all a wildcard bind is asked on, so the test needs no wildcard listener.
  const port = String(await listen(t, "127.0.0.1", (request, response) => response.end("page")));
  const events = [];
  const wait = async (url) => {
    events.push(`wait ${url}`);
    const answered = await waitForFirstPage(url);
    events.push(`answered ${answered}`);
    return answered;
  };
  const url = `http://0.0.0.0:${port}`;

  await openWhenServing({ hostname: "0.0.0.0", port, url, wait, open: (opened) => events.push(`open ${opened}`) });
  assert.deepEqual(events, [`wait http://127.0.0.1:${port}/`, "answered true", `open ${url}`]);
});

test("opens anyway when nothing answered, and at once for port 0", async () => {
  const opened = [];
  const open = (url) => opened.push(url);

  await openWhenServing({ hostname: "::", port: "8080", url: "launch url", open, wait: async (url) => {
    assert.equal(url, "http://[::1]:8080/");
    return false;
  } });
  await openWhenServing({ hostname: "127.0.0.1", port: "0", url: "port 0 url", open, wait: () => {
    throw new Error("port 0 has no address to ask");
  } });
  assert.deepEqual(opened, ["launch url", "port 0 url"]);
});
