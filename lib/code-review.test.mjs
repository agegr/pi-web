import assert from "node:assert/strict";
import test from "node:test";

async function subject() {
  return import("./code-review.ts");
}

function fixture() {
  return {
    id: "review",
    repositoryRoot: "/repo",
    sealed: false,
    finished: true,
    files: [
      {
        id: "a",
        path: "a.ts",
        status: "modified",
        decision: "pending",
        actionable: true,
        granular: true,
        hunks: [
          { id: "0", header: "@@ -1 +1 @@", lines: ["-a", "+b"], decision: "accepted" },
          { id: "1", header: "@@ -9 +9 @@", lines: ["-x", "+y"], decision: "pending" },
        ],
      },
      {
        id: "b",
        path: "image.png",
        status: "modified",
        decision: "pending",
        actionable: true,
        granular: false,
        hunks: [],
      },
      {
        id: "c",
        path: "unsafe",
        status: "type-changed",
        decision: "pending",
        actionable: false,
        granular: false,
        hunks: [],
      },
    ],
  };
}

test("builds file/hunk navigation and advances to the next pending item", async () => {
  const { getReviewNavigationItems, nextReviewItemKey } = await subject();
  const review = fixture();
  assert.deepEqual(getReviewNavigationItems(review).map((item) => item.key), ["a:0", "a:1", "b", "c"]);
  assert.equal(nextReviewItemKey(review, "a:0", { pendingOnly: true }), "a:1");
  assert.equal(nextReviewItemKey(review, "a:1", { pendingOnly: true }), "b");
  assert.equal(nextReviewItemKey(review, "b", { pendingOnly: true }), "a:1");
  assert.equal(nextReviewItemKey(review, "b", { direction: -1 }), "a:1");
  review.files[0].hunks[1].decision = "accepted";
  assert.equal(nextReviewItemKey(review, "a:1", { pendingOnly: true }), "b", "advance uses original order after the current item is resolved");
});

test("counts actionable decisions without treating unsupported files as pending", async () => {
  const { reviewCounts } = await subject();
  assert.deepEqual(reviewCounts(fixture()), { total: 3, pending: 2, accepted: 1, rejected: 0 });
});
