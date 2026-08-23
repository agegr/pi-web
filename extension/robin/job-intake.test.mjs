import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DEFAULT_JOB_PROFILE } from "./jobs.ts";
import {
  absorb,
  admitPostings,
  compileAdmission,
  freshnessCutoff,
  mergePostings,
  pruneJobs,
} from "./job-intake.ts";
import { readJobs, writeJobs } from "./store.ts";

// `absorb` persists through ./store.ts, which resolves its directory per call
// from ROBIN_DATA_DIR. Without this the suite writes into the developer's own
// ~/.pi/robin — clobbering their job list every time they run `npm test`.
const dataDir = mkdtempSync(join(tmpdir(), "robin-intake-test-"));
process.env.ROBIN_DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));

const profile = (over = {}) => ({ ...DEFAULT_JOB_PROFILE, ...over });
const rules = (over = {}, undated = "keep") => ({ profile: profile(over), undated });

const posting = (over = {}) => ({
  title: "Senior AI Engineer",
  url: "https://boards.example.com/acme/jobs/1",
  company: "Acme",
  location: "Remote (US)",
  source: "greenhouse",
  ...over,
});

const days = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/* ── admission ── */

test("admission applies title, location, blacklist and freshness together", () => {
  const kept = admitPostings([
    posting({ title: "Senior AI Engineer" }),
    posting({ title: "Sales Development Rep", url: "https://x/2" }),
    posting({ title: "AI Engineer", location: "Pune, India", url: "https://x/3" }),
    posting({ title: "AI Engineer", company: "Ghostly Inc", url: "https://x/4" }),
    posting({ title: "AI Engineer", url: "https://x/5", postedAt: days(90) }),
    posting({ title: "AI Engineer", url: "https://x/6", postedAt: days(2) }),
  ], rules({
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

test("an undated posting is kept or dropped according to who is asking", () => {
  // The one rule the two discovery paths are allowed to disagree on, and the
  // reason it is a parameter: collapsing it either way breaks a caller, and
  // neither failure raises anything. "keep" is the forward scan, where a board
  // that omits dates omits them for every row and dropping them would switch
  // that employer off entirely. "drop" is the directory sweep, where the
  // question is "what appeared recently" and an undated backlog across twenty
  // thousand boards buries the answer.
  const undated = [posting({ postedAt: undefined })];
  assert.equal(admitPostings(undated, rules({ sinceDays: 1 }, "keep")).length, 1);
  assert.equal(admitPostings(undated, rules({ sinceDays: 1 }, "drop")).length, 0);
  // With no window at all there is nothing to be undated against.
  assert.equal(admitPostings(undated, rules({ sinceDays: 0 }, "drop")).length, 1);
});

test("sinceDays 0 turns the freshness window off", () => {
  assert.equal(freshnessCutoff(0), null);
  assert.equal(admitPostings([posting({ postedAt: "2019-01-01" })], rules({ sinceDays: 0 })).length, 1);
});

test("the cutoff is a UTC calendar date, to match what boards report", () => {
  const now = Date.parse("2026-08-23T02:00:00.000Z");
  assert.equal(freshnessCutoff(7, now), "2026-08-16");
});

test("the compiled predicate and the list helper agree", () => {
  const set = rules({ titles: ["engineer"], sinceDays: 0 });
  const admits = compileAdmission(set);
  const batch = [posting(), posting({ title: "Recruiter", url: "https://x/9" })];
  assert.deepEqual(admitPostings(batch, set), batch.filter(admits));
});

/* ── dedupe and retention ── */

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

test("one opening posted under several ids fills one slot, not four", () => {
  // Observed: an employer listed the same role under six Ashby posting ids and
  // four of them landed in a ten-job digest. The URLs genuinely differ, so
  // only company, title and location together can catch it.
  const { added } = mergePostings([], [
    posting({ url: "https://x/a", company: "Heliux", title: "SWE, Core Platform", location: "HQ (SF)" }),
    posting({ url: "https://x/b", company: "Heliux", title: "SWE, Core Platform", location: "HQ (SF)" }),
    posting({ url: "https://x/c", company: "heliux", title: "swe,  core   platform", location: "hq (sf)" }),
  ]);
  assert.equal(added, 1);
});

test("the same title at the same employer in two cities is two jobs", () => {
  const { added } = mergePostings([], [
    posting({ url: "https://x/sf", company: "Acme", title: "Backend Engineer", location: "San Francisco" }),
    posting({ url: "https://x/ny", company: "Acme", title: "Backend Engineer", location: "New York" }),
  ]);
  assert.equal(added, 2);
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

test("a years figure is read off the description once, at merge time", () => {
  const { jobs } = mergePostings([], [
    posting({ url: "https://x/1", description: "Requirements: 5+ years of professional experience." }),
    posting({ url: "https://x/2", title: "New Grad SWE", description: "A degree and a pulse." }),
    posting({ url: "https://x/3", title: "Other SWE" }),
  ]);
  assert.equal(jobs[0].yearsRequired, 5);
  assert.equal(jobs[1].yearsRequired, undefined, "a posting that states no figure carries none");
  assert.equal(jobs[2].yearsRequired, undefined);
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

/* ── the whole tail, through one interface ── */

test("absorb hydrates, dedupes and persists in one step", async () => {
  writeJobs([]);
  const ctx = {
    async fetchJson() { return { content: "<p>Requires 4+ years of industry experience.</p>" }; },
    async fetchText() { throw new Error("not this path"); },
  };
  const { added } = await absorb([
    { ...posting({ url: "https://job-boards.greenhouse.io/acme/jobs/42" }), source: "greenhouse", ref: { board: "acme", id: "42" } },
  ], rules(), ctx);

  assert.equal(added, 1);
  const [stored] = readJobs();
  assert.match(stored.description, /4\+ years of industry experience/);
  // Hydration feeds the years figure, so the order of the two matters.
  assert.equal(stored.yearsRequired, 4);
});

test("absorb on an empty batch touches neither the network nor the store", async () => {
  writeJobs([{ id: "keep", url: "https://x/1", company: "A", title: "T", location: "", source: "s", discoveredAt: "2026-08-01T00:00:00.000Z", status: "new" }]);
  const ctx = {
    async fetchJson() { throw new Error("should not be called"); },
    async fetchText() { throw new Error("should not be called"); },
  };
  assert.deepEqual(await absorb([], rules(), ctx), { added: 0 });
  assert.equal(readJobs().length, 1);
});
