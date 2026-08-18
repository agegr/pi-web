import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DEFAULT_JOB_PROFILE } from "./jobs.ts";
import { filterPostings, mergePostings, pruneJobs, runJobScan } from "./job-scan.ts";

// runJobScan persists through ./store.ts, which resolves its directory per
// call from ROBIN_DATA_DIR. Without this the suite writes into the developer's
// own ~/.pi/robin — clobbering their scan state and pruning their job list
// every time they run `npm test`.
const dataDir = mkdtempSync(join(tmpdir(), "robin-jobs-test-"));
process.env.ROBIN_DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));

const profile = (over = {}) => ({ ...DEFAULT_JOB_PROFILE, ...over });

const posting = (over = {}) => ({
  title: "Senior AI Engineer",
  url: "https://boards.example.com/acme/jobs/1",
  company: "Acme",
  location: "Remote (US)",
  source: "greenhouse",
  ...over,
});

const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

test("filterPostings applies title, location, blacklist and freshness together", () => {
  const kept = filterPostings([
    posting({ title: "Senior AI Engineer" }),
    posting({ title: "Sales Development Rep", url: "https://x/2" }),
    posting({ title: "AI Engineer", location: "Pune, India", url: "https://x/3" }),
    posting({ title: "AI Engineer", company: "Ghostly Inc", url: "https://x/4" }),
    posting({ title: "AI Engineer", url: "https://x/5", postedAt: days(90) }),
    posting({ title: "AI Engineer", url: "https://x/6", postedAt: days(2) }),
  ], profile({
    titles: ["engineer"],
    locationBlock: ["India"],
    blacklist: ["Ghostly"],
    sinceDays: 14,
  }));

  assert.deepEqual(kept.map((entry) => entry.url), [
    "https://boards.example.com/acme/jobs/1",
    "https://x/6",
  ]);
});

test("a posting with no date survives the freshness window", () => {
  // Boards that omit the date omit it for every row, so dropping undated
  // postings would silently switch those sources off entirely.
  const kept = filterPostings([posting({ postedAt: undefined })], profile({ sinceDays: 1 }));
  assert.equal(kept.length, 1);
});

test("sinceDays 0 turns the freshness window off", () => {
  const kept = filterPostings([posting({ postedAt: "2019-01-01" })], profile({ sinceDays: 0 }));
  assert.equal(kept.length, 1);
});

test("merging never resurrects or overwrites a job you already acted on", () => {
  const existing = [{
    id: "old",
    url: "https://boards.example.com/acme/jobs/1",
    company: "Acme",
    title: "Senior AI Engineer",
    location: "Remote (US)",
    source: "greenhouse",
    discoveredAt: "2026-08-01T00:00:00.000Z",
    status: "dropped",
    score: 2.1,
    notifiedAt: "2026-08-01T08:00:00.000Z",
  }];

  const { jobs, added } = mergePostings(existing, [
    posting(),                                   // same URL, different casing below
    posting({ url: "https://BOARDS.example.com/acme/jobs/1/" }),
    posting({ url: "https://boards.example.com/acme/jobs/2", title: "Staff Engineer" }),
  ]);

  assert.equal(added, 1, "the two spellings of job 1 are one job, and it was already known");
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    { status: jobs[0].status, score: jobs[0].score, notifiedAt: jobs[0].notifiedAt },
    { status: "dropped", score: 2.1, notifiedAt: "2026-08-01T08:00:00.000Z" },
  );
  assert.equal(jobs[1].status, "new");
});

test("merging drops a posting whose URL is not safe to render", () => {
  const { jobs, added } = mergePostings([], [
    posting({ url: "javascript:alert(1)" }),
    posting({ url: "not a url" }),
    posting({ url: "https://ok.example/1" }),
  ]);
  assert.equal(added, 1);
  assert.equal(jobs[0].url, "https://ok.example/1");
});

test("pruning keeps anything you shortlisted or applied to, however old", () => {
  const now = Date.parse("2026-08-18T00:00:00.000Z");
  const stale = "2026-01-01T00:00:00.000Z";
  const kept = pruneJobs([
    { id: "old-new", status: "new", discoveredAt: stale },
    { id: "old-shortlist", status: "shortlist", discoveredAt: stale },
    { id: "old-applied", status: "applied", discoveredAt: stale },
    { id: "recent", status: "new", discoveredAt: "2026-08-17T00:00:00.000Z" },
  ], now);

  assert.deepEqual(kept.map((entry) => entry.id), ["old-shortlist", "old-applied", "recent"]);
});

test("a profile with no sources scans nothing and says so through its source list", async () => {
  // The failure mode this guards: zero sources finishes in milliseconds and
  // reports 0/0/0, which on screen is indistinguishable from "nothing new
  // today". An empty `sources` array is what lets the UI tell them apart.
  const result = await runJobScan({
    profile: profile({ companies: [], boards: [] }),
    fetchImpl: async () => { throw new Error("no source should have been fetched"); },
  });
  assert.deepEqual(result.sources, []);
  assert.equal(result.scanned, 0);
});

test("the shipped defaults come with sources, so the first scan is not a no-op", () => {
  assert.ok(DEFAULT_JOB_PROFILE.boards.length > 0);
});
