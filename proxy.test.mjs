import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { getAuthenticatedLoginRedirect } = await jiti.import("./lib/login-redirect.ts");

test("redirects authenticated login visits to the requested internal page", () => {
  assert.equal(
    getAuthenticatedLoginRedirect(new URLSearchParams({ next: "/settings?tab=models" })),
    "/settings?tab=models",
  );
});

test("redirects authenticated login visits to home by default", () => {
  assert.equal(getAuthenticatedLoginRedirect(new URLSearchParams()), "/");
  assert.equal(getAuthenticatedLoginRedirect(new URLSearchParams({ next: "https://example.com" })), "/");
  assert.equal(getAuthenticatedLoginRedirect(new URLSearchParams({ next: "//example.com" })), "/");
  assert.equal(getAuthenticatedLoginRedirect(new URLSearchParams({ next: "/login" })), "/");
});
