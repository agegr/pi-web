import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function subject() {
  return import("./git-review.ts");
}

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function repo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-review-test-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  fs.writeFileSync(path.join(cwd, "app.txt"), "one\ntwo\nthree\n");
  git(cwd, "add", "app.txt");
  git(cwd, "commit", "-qm", "initial");
  return cwd;
}

test("splits a file patch into server-owned hunk patches", async () => {
  const { splitGitReviewPatch } = await subject();
  const patch = [
    "diff --git a/a.txt b/a.txt",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1 +1 @@",
    "-one",
    "+ONE",
    "@@ -9 +9 @@",
    "-nine",
    "+NINE",
    "",
  ].join("\n");
  const parsed = splitGitReviewPatch(patch);
  assert.equal(parsed.hunks.length, 2);
  assert.match(parsed.hunks[0].patch, /@@ -1 \+1 @@/);
  assert.doesNotMatch(parsed.hunks[0].patch, /@@ -9 \+9 @@/);
  assert.match(parsed.hunks[1].patch, /diff --git a\/a.txt b\/a.txt/);
});

test("captures only prompt changes, preserves the real index, and supports reversible decisions", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));

  fs.writeFileSync(path.join(cwd, "app.txt"), "preexisting\ntwo\nthree\n");
  git(cwd, "add", "app.txt");
  const stagedBefore = git(cwd, "diff", "--cached");

  const started = await api.startGitReview(cwd);
  assert.equal(started.supported, true);
  fs.writeFileSync(path.join(cwd, "app.txt"), "preexisting\ntwo\nthree\nai change\n");

  const review = await api.finishGitReview(started.reviewId);
  assert.equal(review.files.length, 1);
  assert.equal(review.files[0].hunks.length, 1);
  assert.equal(git(cwd, "diff", "--cached"), stagedBefore, "temporary index must not mutate the real index");

  const file = review.files[0];
  const hunk = file.hunks[0];
  const rejected = await api.decideGitReview(review.id, { decision: "rejected", revision: review.revision, fileId: file.id, hunkId: hunk.id });
  assert.equal(fs.readFileSync(path.join(cwd, "app.txt"), "utf8"), "preexisting\ntwo\nthree\n");
  assert.equal(rejected.files[0].hunks[0].decision, "rejected");

  const accepted = await api.decideGitReview(review.id, { decision: "accepted", revision: rejected.revision, fileId: file.id, hunkId: hunk.id });
  assert.equal(fs.readFileSync(path.join(cwd, "app.txt"), "utf8"), "preexisting\ntwo\nthree\nai change\n");
  assert.equal(accepted.files[0].hunks[0].decision, "accepted");
});

test("rejects added and deleted files at file level and can restore them", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));

  const started = await api.startGitReview(cwd);
  fs.unlinkSync(path.join(cwd, "app.txt"));
  fs.writeFileSync(path.join(cwd, "new.txt"), "new\n");
  const review = await api.finishGitReview(started.reviewId);
  assert.deepEqual(review.files.map((file) => file.status).sort(), ["added", "deleted"]);

  const rejected = await api.decideGitReview(review.id, { decision: "rejected", revision: review.revision, all: true });
  assert.equal(fs.readFileSync(path.join(cwd, "app.txt"), "utf8"), "one\ntwo\nthree\n");
  assert.equal(fs.existsSync(path.join(cwd, "new.txt")), false);
  assert.ok(rejected.files.every((file) => file.decision === "rejected"));

  await api.decideGitReview(review.id, { decision: "accepted", revision: rejected.revision, all: true });
  assert.equal(fs.existsSync(path.join(cwd, "app.txt")), false);
  assert.equal(fs.readFileSync(path.join(cwd, "new.txt"), "utf8"), "new\n");
});

test("mode-bearing text patches are file-level and reversible as one operation", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));

  const started = await api.startGitReview(cwd, 7);
  fs.writeFileSync(path.join(cwd, "app.txt"), "ONE\ntwo\nthree\n");
  fs.chmodSync(path.join(cwd, "app.txt"), 0o755);
  const review = await api.finishGitReview(started.reviewId);
  assert.equal(review.runId, 7);
  assert.equal(review.files[0].granular, false);
  assert.match(review.files[0].reason, /mode changes/);

  const rejected = await api.decideGitReview(review.id, { decision: "rejected", revision: review.revision, fileId: review.files[0].id });
  assert.equal(fs.readFileSync(path.join(cwd, "app.txt"), "utf8"), "one\ntwo\nthree\n");
  assert.equal(fs.statSync(path.join(cwd, "app.txt")).mode & 0o777, 0o644);
  await api.decideGitReview(review.id, { decision: "accepted", revision: rejected.revision, fileId: review.files[0].id });
  assert.equal(fs.statSync(path.join(cwd, "app.txt")).mode & 0o777, 0o755);
});

test("multi-file stale decisions fail before any file is mutated", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));

  const started = await api.startGitReview(cwd, 8);
  fs.appendFileSync(path.join(cwd, "app.txt"), "ai\n");
  fs.writeFileSync(path.join(cwd, "second.txt"), "ai second\n");
  const review = await api.finishGitReview(started.reviewId);
  fs.appendFileSync(path.join(cwd, "app.txt"), "external\n");

  await assert.rejects(
    api.decideGitReview(review.id, { decision: "rejected", revision: review.revision, all: true }),
    (error) => error.status === 409,
  );
  assert.equal(fs.readFileSync(path.join(cwd, "second.txt"), "utf8"), "ai second\n");
  assert.match(fs.readFileSync(path.join(cwd, "app.txt"), "utf8"), /ai\nexternal/);
});

test("a losing deferred reservation cannot seal the review of the accepted prompt", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));

  const first = await api.startGitReview(cwd, 39, true);
  const competing = await api.startGitReview(cwd, 40, true);
  await api.activateGitReview(first.reviewId);
  await api.cancelGitReview(competing.reviewId);
  assert.equal((await api.finishGitReview(first.reviewId)).runId, 39);
});

test("server workspace generations seal older run ids without client cooperation", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));

  const first = await api.startGitReview(cwd, 41);
  const second = await api.startGitReview(cwd, 42);
  await assert.rejects(api.finishGitReview(first.reviewId), (error) => error.status === 409);
  const current = await api.finishGitReview(second.reviewId);
  assert.equal(current.runId, 42);
});

test("a newer subdirectory review seals an overlapping repository-root review", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));
  const subdir = path.join(cwd, "src");
  fs.mkdirSync(subdir);
  fs.writeFileSync(path.join(subdir, "nested.txt"), "base\n");
  git(cwd, "add", "src/nested.txt");
  git(cwd, "commit", "-qm", "nested file");

  const rootReview = await api.startGitReview(cwd, 50);
  const nestedReview = await api.startGitReview(subdir, 51);
  await assert.rejects(api.finishGitReview(rootReview.reviewId), (error) => error.status === 409);
  assert.equal((await api.finishGitReview(nestedReview.reviewId)).runId, 51);
});

test("symlink target changes are file-level and reversible", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));
  const linkPath = path.join(cwd, "current.txt");
  fs.symlinkSync("app.txt", linkPath);
  git(cwd, "add", "current.txt");
  git(cwd, "commit", "-qm", "symlink");

  const started = await api.startGitReview(cwd, 52);
  fs.unlinkSync(linkPath);
  fs.symlinkSync("other.txt", linkPath);
  const review = await api.finishGitReview(started.reviewId);
  const file = review.files.find((candidate) => candidate.path === "current.txt");
  assert.ok(file);
  assert.equal(file.granular, false);
  const rejected = await api.decideGitReview(review.id, { decision: "rejected", revision: review.revision, fileId: file.id });
  assert.equal(fs.readlinkSync(linkPath), "app.txt");
  await api.decideGitReview(review.id, { decision: "accepted", revision: rejected.revision, fileId: file.id });
  assert.equal(fs.readlinkSync(linkPath), "other.txt");
});

test("mixed hunk decisions carry revisions and reject stale mutations", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));
  fs.writeFileSync(path.join(cwd, "app.txt"), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
  git(cwd, "add", "app.txt");
  git(cwd, "commit", "-qm", "long file");

  const started = await api.startGitReview(cwd, 9);
  const lines = fs.readFileSync(path.join(cwd, "app.txt"), "utf8").split("\n");
  lines[1] = "AI TWO";
  lines[25] = "AI TWENTY SIX";
  fs.writeFileSync(path.join(cwd, "app.txt"), lines.join("\n"));
  const review = await api.finishGitReview(started.reviewId);
  assert.equal(review.files[0].hunks.length, 2);
  const next = await api.decideGitReview(review.id, {
    decision: "rejected", revision: review.revision, fileId: review.files[0].id, hunkId: review.files[0].hunks[0].id,
  });
  assert.equal(next.files[0].decision, "mixed");
  await assert.rejects(
    api.decideGitReview(review.id, { decision: "accepted", revision: review.revision, fileId: review.files[0].id }),
    (error) => error.status === 409,
  );
});

test("returns a conflict instead of overwriting concurrent edits and seals old reviews", async (t) => {
  const api = await subject();
  api.resetGitReviewsForTests();
  const cwd = repo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }));

  const started = await api.startGitReview(cwd);
  fs.writeFileSync(path.join(cwd, "app.txt"), "one\ntwo\nthree\nai\n");
  const review = await api.finishGitReview(started.reviewId);
  fs.appendFileSync(path.join(cwd, "app.txt"), "user edit\n");

  await assert.rejects(
    api.decideGitReview(review.id, { decision: "rejected", revision: review.revision, fileId: review.files[0].id }),
    (error) => error.status === 409,
  );
  assert.match(fs.readFileSync(path.join(cwd, "app.txt"), "utf8"), /user edit/);

  await api.startGitReview(cwd, 2);
  await assert.rejects(
    api.decideGitReview(review.id, { decision: "accepted", revision: review.revision, fileId: review.files[0].id }),
    (error) => error.status === 409,
  );
});
