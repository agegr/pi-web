import { describe, it } from "node:test";
import assert from "node:assert";
import { sanitizeFilename } from "../../../../lib/sanitize-filename.ts";

describe("sanitizeFilename", () => {
  it("strips path separators", () => {
    assert.strictEqual(sanitizeFilename("../../../etc/passwd"), ".._.._.._etc_passwd");
    assert.strictEqual(sanitizeFilename("..\\..\\evil.exe"), ".._.._evil.exe");
  });

  it("removes null bytes", () => {
    const result = sanitizeFilename("safe\u0000evil.txt");
    assert.ok(result);
    assert.ok(!result.includes("\u0000"));
  });

  it("removes control characters", () => {
    const result = sanitizeFilename("file\x01name.txt");
    assert.ok(result);
    assert.ok(!result.includes("\x01"));
  });

  it("returns null for empty string", () => {
    assert.strictEqual(sanitizeFilename(""), null);
  });

  it("returns null for dot-only names", () => {
    assert.strictEqual(sanitizeFilename("."), null);
    assert.strictEqual(sanitizeFilename(".."), null);
    assert.strictEqual(sanitizeFilename("..."), null);
  });

  it("rejects Windows reserved names (case-insensitive)", () => {
    for (const name of ["con", "CON", "prn", "aux", "nul", "com1", "lpt1"]) {
      assert.strictEqual(sanitizeFilename(name), null, `should reject ${name}`);
    }
  });

  it("rejects Windows reserved names with extension", () => {
    assert.strictEqual(sanitizeFilename("con.txt"), null);
    assert.strictEqual(sanitizeFilename("NUL.txt"), null);
  });

  it("preserves normal filenames", () => {
    assert.strictEqual(sanitizeFilename("report.pdf"), "report.pdf");
    assert.strictEqual(sanitizeFilename("my_code.ts"), "my_code.ts");
    assert.strictEqual(sanitizeFilename("README.md"), "README.md");
  });

  it("preserves Chinese/Unicode filenames", () => {
    assert.strictEqual(sanitizeFilename("报告.docx"), "报告.docx");
    assert.strictEqual(sanitizeFilename("résumé.pdf"), "résumé.pdf");
  });

  it("handles mixed content safely", () => {
    const result = sanitizeFilename("safe/..\\con\u0000.txt");
    assert.ok(result);
    assert.ok(!result.includes("/"));
    assert.ok(!result.includes("\\"));
    assert.ok(!result.includes("\u0000"));
    assert.notStrictEqual(result?.toLowerCase().split(".")[0], "con");
  });
});
