import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DEFAULT_JOB_PROFILE } from "./jobs.ts";
import { absorb, admitPostings, compileAdmission, freshnessCutoff } from "./job-intake.ts";
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

/** A ctx that fails loudly, for the paths that must not touch the network. */
const offline = {
  async fetchJson() { throw new Error("no request should have been made"); },
  async fetchText() { throw new Error("no request should have been made"); },
};

/** Seed the store, run one intake, and hand back what is in there afterwards. */
async function intake(existing, postings, ctx = offline, set = rules()) {
  writeJobs(existing);
  const { added } = await absorb(postings, set, ctx);
  return { added, jobs: readJobs() };
}

const stored = (over = {}) => ({
  id: "seeded",
  url: "https://boards.example.com/acme/jobs/1",
  company: "Acme",
  title: "Senior AI Engineer",
  location: "Remote (US)",
  source: "greenhouse",
  discoveredAt: "2026-08-01T00:00:00.000Z",
  status: "new",
  ...over,
});

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

/* ── dedupe, retention and persistence, through the only way in ── */

test("a job you already acted on is never resurrected or overwritten", async () => {
  const { jobs, added } = await intake(
    [stored({ id: "old", status: "dropped", score: 2.1, notifiedAt: "2026-08-01T08:00:00.000Z" })],
    [
      posting(),                                   // the same URL, already known
      posting({ url: "https://BOARDS.example.com/acme/jobs/1/" }),   // and again, spelled differently
      posting({ url: "https://boards.example.com/acme/jobs/2", title: "Staff Engineer" }),
    ],
  );

  assert.equal(added, 1, "the two spellings of job 1 are one job, and it was already known");
  assert.equal(jobs.length, 2);
  assert.deepEqual(
    { status: jobs[0].status, score: jobs[0].score, notifiedAt: jobs[0].notifiedAt },
    { status: "dropped", score: 2.1, notifiedAt: "2026-08-01T08:00:00.000Z" },
  );
  assert.equal(jobs[1].status, "new");
});

test("one opening posted under several ids fills one slot, not four", async () => {
  // Observed: an employer listed the same role under six Ashby posting ids and
  // four of them landed in a ten-job digest. The URLs genuinely differ, so
  // only company, title and location together can catch it.
  const { added } = await intake([], [
    posting({ url: "https://x/a", company: "Heliux", title: "SWE, Core Platform", location: "HQ (SF)" }),
    posting({ url: "https://x/b", company: "Heliux", title: "SWE, Core Platform", location: "HQ (SF)" }),
    posting({ url: "https://x/c", company: "heliux", title: "swe,  core   platform", location: "hq (sf)" }),
  ]);
  assert.equal(added, 1);
});

test("the same title at the same employer in two cities is two jobs", async () => {
  const { added } = await intake([], [
    posting({ url: "https://x/sf", company: "Acme", title: "Backend Engineer", location: "San Francisco" }),
    posting({ url: "https://x/ny", company: "Acme", title: "Backend Engineer", location: "New York" }),
  ]);
  assert.equal(added, 2);
});

test("a posting whose URL is not safe to render never reaches the store", async () => {
  const { jobs, added } = await intake([], [
    posting({ url: "javascript:alert(1)" }),
    posting({ url: "not a url" }),
    posting({ url: "https://ok.example/1" }),
  ]);
  assert.equal(added, 1);
  assert.equal(jobs[0].url, "https://ok.example/1");
});

test("taking anything in also expires what you never acted on", async () => {
  // Retention runs as part of intake or it does not run at all. Asserting it
  // here rather than against the pruning function is the difference between a
  // test that proves the policy is implemented and one that proves it is
  // applied — a mutant that dropped the call from intake passed the latter.
  const ancient = "2020-01-01T00:00:00.000Z";
  const { jobs } = await intake([
    stored({ id: "old-new", status: "new", discoveredAt: ancient }),
    stored({ id: "old-shortlist", status: "shortlist", discoveredAt: ancient, url: "https://x/s" }),
    stored({ id: "old-applied", status: "applied", discoveredAt: ancient, url: "https://x/a" }),
  ], [posting({ url: "https://x/fresh", title: "New Grad Engineer" })]);

  assert.deepEqual(
    jobs.map((job) => job.id).filter((id) => id.startsWith("old-")),
    ["old-shortlist", "old-applied"],
    "an untouched row past the retention window goes; anything you acted on stays",
  );
  assert.equal(jobs.length, 3);
});

test("descriptions are fetched before the years figure is read off them", async () => {
  const ctx = {
    async fetchJson() { return { content: "<p>Requires 4+ years of industry experience.</p>" }; },
    async fetchText() { throw new Error("not this path"); },
  };
  const { added, jobs } = await intake([], [
    { ...posting({ url: "https://job-boards.greenhouse.io/acme/jobs/42" }), ref: { board: "acme", id: "42" } },
  ], ctx);

  assert.equal(added, 1);
  assert.match(jobs[0].description, /4\+ years of industry experience/);
  // Ordering is the point: a years figure read before hydration is always null.
  assert.equal(jobs[0].yearsRequired, 4);
});

test("a posting that states no years requirement carries none", async () => {
  const { jobs } = await intake([], [
    posting({ url: "https://x/1", title: "New Grad SWE", description: "A degree and a pulse." }),
    posting({ url: "https://x/2", title: "Other SWE" }),
  ]);
  assert.equal(jobs[0].yearsRequired, undefined);
  assert.equal(jobs[1].yearsRequired, undefined);
});

test("an empty batch touches neither the network nor the store", async () => {
  const seeded = [stored({ id: "keep" })];
  writeJobs(seeded);
  assert.deepEqual(await absorb([], rules(), offline), { added: 0 });
  assert.equal(readJobs().length, 1);
  assert.equal(readJobs()[0].id, "keep", "not even a retention pass runs on nothing");
});
