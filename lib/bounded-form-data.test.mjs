import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./bounded-form-data.ts");
}

function multipartBody(boundary, value) {
  return `--${boundary}\r\nContent-Disposition: form-data; name="value"\r\n\r\n${value}\r\n--${boundary}--\r\n`;
}

test("rejects a declared oversized request before reading its body", async () => {
  const { parseFormDataWithinLimit, RequestBodyTooLargeError } = await loadSubject();
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-length": "99", "content-type": "multipart/form-data; boundary=test" },
    body: multipartBody("test", "small"),
  });

  await assert.rejects(() => parseFormDataWithinLimit(request, 10), RequestBodyTooLargeError);
});

test("stops a chunked request once its body exceeds the limit", async () => {
  const { parseFormDataWithinLimit, RequestBodyTooLargeError } = await loadSubject();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("1234"));
      controller.enqueue(new TextEncoder().encode("5678"));
      controller.close();
    },
  });
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test" },
    body: stream,
    duplex: "half",
  });

  await assert.rejects(() => parseFormDataWithinLimit(request, 6), RequestBodyTooLargeError);
});

test("parses bounded JSON and rejects oversized JSON", async () => {
  const { parseJsonWithinLimit, RequestBodyTooLargeError } = await loadSubject();
  const body = JSON.stringify({ type: "input", data: "hello" });
  const parsed = await parseJsonWithinLimit(new Request("http://localhost/terminal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }), body.length);
  assert.deepEqual(parsed, { type: "input", data: "hello" });

  await assert.rejects(() => parseJsonWithinLimit(new Request("http://localhost/terminal", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "1000" },
    body,
  }), 100), RequestBodyTooLargeError);
});

test("parses multipart data inside the request limit", async () => {
  const { parseFormDataWithinLimit } = await loadSubject();
  const boundary = "test";
  const body = multipartBody(boundary, "small");
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
  });

  const formData = await parseFormDataWithinLimit(request, body.length + 1);
  assert.equal(formData.get("value"), "small");
});
