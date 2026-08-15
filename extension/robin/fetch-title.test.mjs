import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { fetchPageTitle } from "./fetch-title.ts";

const routes = {
  "/plain": { type: "text/html", body: "<html><head><title>Hacker News</title></head><body>x</body></html>" },
  "/entities": { type: "text/html; charset=utf-8", body: "<title>Tom &amp; Jerry &#8212; &quot;fun&quot;</title>" },
  "/whitespace": { type: "text/html", body: "<title>\n  spaced   out\n</title>" },
  "/attributes": { type: "text/html", body: '<title data-x="1">With attrs</title>' },
  "/empty": { type: "text/html", body: "<title>   </title>" },
  "/none": { type: "text/html", body: "<html><body>no title here</body></html>" },
  "/json": { type: "application/json", body: '{"title":"not html"}' },
  "/notfound": { status: 404, type: "text/html", body: "<title>Nope</title>" },
};

const server = createServer((req, res) => {
  if (req.url === "/huge") {
    // Title far past the read cap, after a lot of filler.
    res.writeHead(200, { "Content-Type": "text/html" });
    res.write("<!-- ".padEnd(200_000, "x"));
    res.end("--><title>Too Late</title>");
    return;
  }
  const route = routes[req.url ?? ""];
  if (!route) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(route.status ?? 200, { "Content-Type": route.type });
  res.end(route.body);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

after(() => server.close());

test("reads a plain title", async () => {
  assert.equal(await fetchPageTitle(`${base}/plain`), "Hacker News");
});

test("decodes named and numeric entities", async () => {
  assert.equal(await fetchPageTitle(`${base}/entities`), 'Tom & Jerry — "fun"');
});

test("collapses whitespace and tolerates attributes", async () => {
  assert.equal(await fetchPageTitle(`${base}/whitespace`), "spaced out");
  assert.equal(await fetchPageTitle(`${base}/attributes`), "With attrs");
});

test("returns null when there is no usable title", async () => {
  assert.equal(await fetchPageTitle(`${base}/empty`), null);
  assert.equal(await fetchPageTitle(`${base}/none`), null);
});

test("refuses non-HTML and error responses", async () => {
  assert.equal(await fetchPageTitle(`${base}/json`), null);
  assert.equal(await fetchPageTitle(`${base}/notfound`), null);
});

test("stops reading before a title buried past the byte cap", async () => {
  assert.equal(await fetchPageTitle(`${base}/huge`), null);
});

test("an unreachable host resolves to null rather than throwing", async () => {
  // Port 1 on loopback refuses immediately.
  assert.equal(await fetchPageTitle("http://127.0.0.1:1/"), null);
});
