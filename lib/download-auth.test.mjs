import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

const { DOWNLOAD_TOKEN_TTL_MS, createDownloadToken, verifyDownloadToken } =
  await jiti.import("./download-auth.ts");

const SECRET = "test-secret-12345";

test("token verifies after issuance", () => {
  const token = createDownloadToken(
    SECRET,
    "/api/files/home/user/%E6%8A%A5%E8%A1%A8.xlsx",
  );
  assert.equal(
    verifyDownloadToken(
      SECRET,
      "/api/files/home/user/%E6%8A%A5%E8%A1%A8.xlsx",
      token,
    ),
    true,
  );
});

test("token fails when the pathname is tampered with", () => {
  const token = createDownloadToken(SECRET, "/api/files/home/user/a.docx");
  assert.equal(
    verifyDownloadToken(SECRET, "/api/files/home/user/b.docx", token),
    false,
  );
});

test("expired token fails verification", () => {
  const now = Date.now();
  const token = createDownloadToken(SECRET, "/api/files/home/user/a.docx", now);
  assert.equal(
    verifyDownloadToken(
      SECRET,
      "/api/files/home/user/a.docx",
      token,
      now + DOWNLOAD_TOKEN_TTL_MS + 1,
    ),
    false,
  );
});

test("token verifies anywhere inside the TTL window", () => {
  const now = Date.now();
  const token = createDownloadToken(SECRET, "/api/files/home/user/a.docx", now);
  assert.equal(
    verifyDownloadToken(
      SECRET,
      "/api/files/home/user/a.docx",
      token,
      now + DOWNLOAD_TOKEN_TTL_MS - 1,
    ),
    true,
  );
});

test("token fails with a different secret", () => {
  const token = createDownloadToken(SECRET, "/api/files/home/user/a.docx");
  assert.equal(
    verifyDownloadToken("other-secret", "/api/files/home/user/a.docx", token),
    false,
  );
});

test("malformed tokens are rejected", () => {
  assert.equal(
    verifyDownloadToken(SECRET, "/api/files/home/user/a.docx", "garbage"),
    false,
  );
  assert.equal(
    verifyDownloadToken(SECRET, "/api/files/home/user/a.docx", "123.zzz"),
    false,
  );
  assert.equal(
    verifyDownloadToken(SECRET, "/api/files/home/user/a.docx", ""),
    false,
  );
});

test("empty pathname or empty token is rejected", () => {
  const token = createDownloadToken(SECRET, "/api/files/home/user/a.docx");
  assert.equal(verifyDownloadToken(SECRET, "", token), false);
  assert.equal(
    verifyDownloadToken(SECRET, "/api/files/home/user/a.docx", null),
    false,
  );
});
