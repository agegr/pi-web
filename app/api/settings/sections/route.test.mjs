import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// The route a pi extension's Settings section is listed, read and applied
// through, with a real extension in a throwaway agent directory.
const root = await mkdtemp(join(tmpdir(), "pi-web-sections-route-"));
const agentDir = join(root, "agent");
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
await mkdir(join(agentDir, "extensions"), { recursive: true });
await writeFile(join(agentDir, "extensions", "route-section.ts"), `
export default function routeSection() {
  const registry = globalThis[Symbol.for("@agegr/pi-web/settings-sections/v1")];
  registry.register({
    id: "ext:route",
    label: { en: "Route", "zh-CN": "路由", "zh-TW": "路由" },
    fields: [{ kind: "text", key: "address", label: { en: "Address" } }],
    read: () => ({ values: { address: "http://127.0.0.1:1" }, status: { state: "ok", text: { en: "Running" } } }),
    apply: (values) => {
      if (typeof values.address !== "string" || !values.address.startsWith("http")) {
        throw new Error("Address must be an http(s) URL");
      }
    },
    status: () => ({ state: "ok", text: { en: "Running" } }),
  });
}
`, "utf8");

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false, alias: { "@": process.cwd() } });
const { GET, POST } = await jiti.import("./route.ts");
const { warmSettingsSections } = await jiti.import("@/lib/settings-sections-host.ts");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
});

// The route's write guard wants a request that looks like the page's own.
function post(body, headers = { "Content-Type": "application/json" }) {
  return POST(new Request("http://localhost/api/settings/sections", {
    method: "POST",
    headers: { host: "localhost", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

test("until the extensions answer, the list is empty rather than an error", async () => {
  const body = await (await GET(new Request("http://localhost/api/settings/sections"))).json();
  assert.deepEqual(body, { ready: false, sections: [] });
});

test("the boot load makes the section listable, readable and applicable", async () => {
  await warmSettingsSections({ cwd: agentDir });

  const list = await (await GET(new Request("http://localhost/api/settings/sections"))).json();
  assert.equal(list.ready, true);
  assert.deepEqual(list.sections.map((section) => section.id), ["ext:route"]);
  assert.equal(list.sections[0].label.en, "Route");

  const read = await (await GET(new Request("http://localhost/api/settings/sections?id=ext:route"))).json();
  assert.deepEqual(read, {
    values: { address: "http://127.0.0.1:1" },
    status: { state: "ok", text: { en: "Running" } },
  });

  const status = await (await GET(new Request("http://localhost/api/settings/sections?status=ext:route"))).json();
  assert.deepEqual(status, { status: { state: "ok", text: { en: "Running" } } });

  assert.equal((await post({ id: "ext:route", values: { address: "http://127.0.0.1:2" } })).status, 200);
});

test("a section no extension registered is answered as unknown", async () => {
  const missing = await GET(new Request("http://localhost/api/settings/sections?id=ext:gone"));
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /is not registered/);
});

test("a refusal is the extension's message; bad requests never reach it", async () => {
  const rejected = await post({ id: "ext:route", values: { address: "nope" } });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /Address must be an http\(s\) URL/);

  assert.equal((await post({ id: "ext:route", values: {} }, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post({ values: {} })).status, 400);
  assert.equal((await post({ id: "ext:route", values: [] })).status, 400);
});
