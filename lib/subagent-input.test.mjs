import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  appendSubagentInputFiles,
  loadSubagentInputFiles,
  MAX_SUBAGENT_INPUT_BYTES,
  MAX_SUBAGENT_INPUT_FILES,
  subagentInputLimits,
} = await createJiti(import.meta.url).import("./subagent-input.ts");

test("loads cwd-relative UTF-8 files and formats them as delegated user input", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-input-"));
  try {
    await mkdir(join(cwd, "docs"));
    await writeFile(join(cwd, "docs", "article.md"), "# Article\n\nEvidence.", "utf8");

    const files = loadSubagentInputFiles(cwd, ["docs/article.md"]);
    assert.deepEqual(files, [{ path: "docs/article.md", content: "# Article\n\nEvidence." }]);
    assert.equal(
      appendSubagentInputFiles("Analyze the argument.", files),
      "Analyze the argument.\n\n<documents>\n<document path=\"docs/article.md\">\n# Article\n\nEvidence.\n</document>\n</documents>",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("oversized files are refused before allocating their contents", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-large-input-"));
  try {
    const file = join(cwd, "large.txt");
    await writeFile(file, "");
    await truncate(file, 2 ** 31);
    assert.throws(() => loadSubagentInputFiles(cwd, ["large.txt"]), /exceeds the 512 KB total limit/);
    assert.throws(() => loadSubagentInputFiles(cwd, ["large.txt"], { maxBytes: 400, model: "small-context" }), /400-byte total limit for small-context/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects files outside cwd, including symlink targets", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-input-cwd-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-web-subagent-input-outside-"));
  try {
    const outsideFile = join(outside, "article.md");
    await writeFile(outsideFile, "Private", "utf8");
    await symlink(outsideFile, join(cwd, "linked.md"));

    assert.throws(() => loadSubagentInputFiles(cwd, [outsideFile]), /outside the session cwd/);
    assert.throws(() => loadSubagentInputFiles(cwd, ["linked.md"]), /outside the session cwd/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("rejects invalid UTF-8 and bounded input sets", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-input-"));
  try {
    await writeFile(join(cwd, "binary.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(join(cwd, "large.txt"), "x".repeat(MAX_SUBAGENT_INPUT_BYTES + 1), "utf8");

    assert.throws(() => loadSubagentInputFiles(cwd, ["binary.txt"]), /not valid UTF-8/);
    assert.throws(() => loadSubagentInputFiles(cwd, ["large.txt"]), /exceeds the 512 KB total limit\. /);
    assert.throws(
      () => loadSubagentInputFiles(cwd, Array(MAX_SUBAGENT_INPUT_FILES + 1).fill("binary.txt")),
      /at most/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("the size limit is about a tenth of the child model's context window, capped at the flat limit", () => {
  const model = (contextWindow) => ({ provider: "p", id: "m", contextWindow });
  // By pi's chars/4 estimate, a tenth of the window is 0.4 bytes of ASCII per window token.
  assert.deepEqual(subagentInputLimits(model(272_000)), { maxBytes: 108_800, model: "p/m" });
  assert.deepEqual(subagentInputLimits(model(200_000)), { maxBytes: 80_000, model: "p/m" });
  assert.deepEqual(subagentInputLimits(model(128_000)), { maxBytes: 51_200, model: "p/m" });
  assert.deepEqual(subagentInputLimits(model(1_000_000)), { maxBytes: 400_000, model: "p/m" });
  // A window whose tenth exceeds the flat limit, or one pi does not know, keeps the flat limit.
  assert.deepEqual(subagentInputLimits(model(2_000_000)), {});
  assert.deepEqual(subagentInputLimits(model(0)), {});
  assert.deepEqual(subagentInputLimits(model(undefined)), {});
  assert.deepEqual(subagentInputLimits(model(Number.NaN)), {});
  assert.deepEqual(subagentInputLimits(undefined), {});
});

test("a model's limit refuses a larger set and names the limit, the model and the way out", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-subagent-input-"));
  try {
    await writeFile(join(cwd, "a.md"), "a".repeat(30_000), "utf8");
    await writeFile(join(cwd, "b.md"), "b".repeat(30_000), "utf8");
    const limits = subagentInputLimits({ provider: "openai", id: "small", contextWindow: 128_000 });

    // Either file fits alone; the limit is on their total.
    assert.equal(loadSubagentInputFiles(cwd, ["a.md"], limits).length, 1);
    assert.throws(() => loadSubagentInputFiles(cwd, ["a.md", "b.md"], limits), (error) => {
      assert.match(error.message, /exceeds the 50 KB total limit for openai\/small, about a tenth of its context window\./);
      assert.match(error.message, /Pass fewer or smaller files, or name the paths in prompt if the subagent can read them\.$/);
      return true;
    });
    // The same set fits the flat limit when the model's window is unknown.
    const unknownWindow = subagentInputLimits({ provider: "openai", id: "virtual", contextWindow: 0 });
    assert.equal(loadSubagentInputFiles(cwd, ["a.md", "b.md"], unknownWindow).length, 2);
    assert.throws(() => loadSubagentInputFiles(cwd, ["a.md"], { maxBytes: 100 }), /exceeds the 100-byte total limit\. /);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
