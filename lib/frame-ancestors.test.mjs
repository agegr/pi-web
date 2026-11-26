import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const original = {
  password: process.env.PI_WEB_PASSWORD,
  ancestors: process.env.PI_WEB_FRAME_ANCESTORS,
  agentDir: process.env.PI_CODING_AGENT_DIR,
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-frame-ancestors-"));
process.env.PI_CODING_AGENT_DIR = path.join(tmp, "agent");
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { proxy } = await jiti.import("../proxy.ts");
const { frameAncestorSources, pageFramingHeaders } = await jiti.import("./frame-ancestors.ts");

function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  delete process.env.PI_WEB_PASSWORD;
  delete process.env.PI_WEB_FRAME_ANCESTORS;
});
after(() => {
  restore("PI_WEB_PASSWORD", original.password);
  restore("PI_WEB_FRAME_ANCESTORS", original.ancestors);
  restore("PI_CODING_AGENT_DIR", original.agentDir);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// A stored (uncompressed) zip: enough of a .docx for mammoth to read.
function storedZip(files) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(text);
    const fields = (header) => {
      header.writeUInt32LE(crc32(data), 14);
      header.writeUInt32LE(data.length, 18);
      header.writeUInt32LE(data.length, 22);
      header.writeUInt16LE(nameBuf.length, 26);
      return header;
    };
    const local = fields(Buffer.alloc(30));
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function request(path, headers = {}) {
  return new NextRequest(`http://127.0.0.1:30141${path}`, {
    headers: { Host: "127.0.0.1:30141", ...headers },
  });
}

test("the app page refuses a cross-site frame by default", () => {
  const response = proxy(request("/", {
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Dest": "iframe",
    Referer: "https://attacker.example/",
  }));
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'self'");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
});

test("every page answer carries the policy, redirects and the login page included", () => {
  assert.equal(proxy(request("/login")).status, 307);
  assert.equal(proxy(request("/login")).headers.get("content-security-policy"), "frame-ancestors 'self'");

  process.env.PI_WEB_PASSWORD = "secret";
  for (const path of ["/", "/login"]) {
    assert.equal(proxy(request(path)).headers.get("content-security-policy"), "frame-ancestors 'self'", path);
  }
});

test("API answers are not pages and get no framing policy", () => {
  const response = proxy(request("/api/sessions"));
  assert.equal(response.headers.get("content-security-policy"), null);
  assert.equal(response.headers.get("x-frame-options"), null);
});

test("PI_WEB_FRAME_ANCESTORS lets the named origins frame the app", () => {
  process.env.PI_WEB_FRAME_ANCESTORS = "https://portal.example, http://localhost:*";
  const response = proxy(request("/"));
  assert.equal(
    response.headers.get("content-security-policy"),
    "frame-ancestors 'self' https://portal.example http://localhost:*",
  );
  // X-Frame-Options cannot name another origin, so it must not block them.
  assert.equal(response.headers.get("x-frame-options"), null);
});

test("accepts CSP source expressions and drops anything that could reach past the directive", () => {
  assert.deepEqual(
    frameAncestorSources("*, https:, *.example.com, https://a.example:8443, http://[::1]:3000, http://127.0.0.1:*"),
    ["*", "https:", "*.example.com", "https://a.example:8443", "http://[::1]:3000", "http://127.0.0.1:*"],
  );
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(
      frameAncestorSources("https://ok.example, https://a.example; script-src *, 'unsafe-inline', 'none', https://a.example/path?x, a b"),
      ["https://ok.example"],
    );
    assert.deepEqual(pageFramingHeaders(" , ;"), [
      ["Content-Security-Policy", "frame-ancestors 'self'"],
      ["X-Frame-Options", "SAMEORIGIN"],
    ]);
  } finally {
    console.warn = warn;
  }
});

test("the documents Pi Web frames itself let the same origins be their ancestors", async () => {
  const project = path.join(tmp, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, "a.docx"), storedZip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>',
  }));
  fs.writeFileSync(path.join(project, "a.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  const { allowFileRoot } = await jiti.import("./allowed-roots.ts");
  const { GET } = await jiti.import("../app/api/files/[...path]/route.ts");
  allowFileRoot(project);
  async function framing(file, type) {
    const filePath = path.join(project, file);
    const response = await GET(
      request(`/api/files${filePath.split(path.sep).map(encodeURIComponent).join("/")}?type=${type}`, { "Sec-Fetch-Site": "same-origin" }),
      { params: Promise.resolve({ path: filePath.split(path.sep).filter(Boolean) }) },
    );
    assert.equal(response.status, 200, `${file} ${type}`);
    await response.body?.cancel();
    return response.headers.get("content-security-policy")?.match(/frame-ancestors [^;]*/)?.[0];
  }

  assert.equal(await framing("a.docx", "preview"), "frame-ancestors 'self'");
  assert.equal(await framing("a.svg", "read"), "frame-ancestors 'self'");
  process.env.PI_WEB_FRAME_ANCESTORS = "https://portal.example";
  assert.equal(await framing("a.docx", "preview"), "frame-ancestors 'self' https://portal.example");
  assert.equal(await framing("a.svg", "read"), "frame-ancestors 'self' https://portal.example");
});
