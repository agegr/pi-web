import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_JOB_PROFILE,
  LOCATION_PRESETS,
  TITLE_PRESETS,
  appliedJobs,
  buildLocationFilter,
  buildTitleFilter,
  cleanDescription,
  digestCandidates,
  extractYearsRequired,
  formatJobDigest,
  isBlacklisted,
  isPresetActive,
  jobKey,
  pendingJobs,
  sortJobs,
  togglePreset,
} from "./jobs.ts";

const job = (over = {}) => ({
  id: "j1",
  url: "https://example.com/jobs/1",
  company: "Acme",
  title: "Engineer",
  location: "Remote",
  source: "greenhouse",
  discoveredAt: "2026-08-18T00:00:00.000Z",
  status: "new",
  ...over,
});

/* ── title filter ── */

test("a short acronym matches on word boundaries, not inside other words", () => {
  const matches = buildTitleFilter(["coo"]);
  assert.equal(matches("Chief Operating Officer, COO"), "coo");
  assert.equal(matches("Program Coordinator"), null, "COO must not match Coordinator");

  const ai = buildTitleFilter(["ai"]);
  assert.equal(ai("AI Engineer"), "ai");
  assert.equal(ai("Claims Adjuster"), null, "'ai' inside 'Claims' is not a hit");
});

test("longer keywords and punctuated ones stay plain substrings", () => {
  const matches = buildTitleFilter(["engineer", ".net"]);
  assert.equal(matches("Senior Engineering Manager"), "engineer");
  assert.equal(matches("Backend .NET Developer"), ".net");
});

test("a ' + ' entry requires every term, in any order", () => {
  const matches = buildTitleFilter(["Director + Engineering"]);
  assert.equal(matches("Director of Engineering"), "Director + Engineering");
  assert.equal(matches("Director - Software Engineering"), "Director + Engineering");
  assert.equal(matches("Engineering Director, Platform"), "Director + Engineering");
  assert.equal(matches("Director of Marketing"), null);
});

test("exclusions win over a positive match", () => {
  const matches = buildTitleFilter(["engineer"], ["intern", "sales"]);
  assert.equal(matches("Software Engineer"), "engineer");
  assert.equal(matches("Software Engineer Intern"), null);
});

test("an empty keyword list accepts every title", () => {
  // An unconfigured profile should show you everything, not nothing — silence
  // would read as the scanner being broken.
  assert.equal(buildTitleFilter([])("Anything At All"), "");
  assert.equal(buildTitleFilter([], ["sales"])("Sales Lead"), null, "exclusions still apply");
});

/* ── location filter ── */

test("location rules resolve in the documented order", () => {
  const passes = buildLocationFilter({
    always: ["New York"],
    allow: ["Remote", "United States"],
    block: ["India", "Bengaluru"],
  });

  assert.equal(passes(""), true, "a missing location is not a reason to drop a job");
  assert.equal(passes("Remote, New York or Bengaluru"), true, "always-allow outranks block");
  assert.equal(passes("Remote, Bengaluru"), false);
  assert.equal(passes("Remote (US)"), true);
  assert.equal(passes("Berlin, Germany"), false, "not blocked, but not on the allow list either");
});

test("an empty allow list means anywhere that is not blocked", () => {
  const passes = buildLocationFilter({ always: [], allow: [], block: ["India"] });
  assert.equal(passes("Berlin, Germany"), true);
  assert.equal(passes("Pune, India"), false);
});

/* ── identity ── */

test("jobKey folds away casing and a trailing slash but keeps the query", () => {
  assert.equal(
    jobKey("https://BOARDS.example.com/Acme/Jobs/42/"),
    jobKey("https://boards.example.com/acme/jobs/42"),
  );
  assert.notEqual(
    jobKey("https://example.com/careers?gh_jid=1"),
    jobKey("https://example.com/careers?gh_jid=2"),
    "several boards carry the job id in the query — folding it merges real jobs",
  );
});

test("the blacklist matches loosely and ignores blank entries", () => {
  assert.equal(isBlacklisted("Acme Corporation", ["acme"]), true);
  assert.equal(isBlacklisted("Acme Corporation", ["  "]), false);
  assert.equal(isBlacklisted("Beta Inc", ["acme"]), false);
});

/* ── ordering ── */

test("scored jobs sort above unscored ones rather than below a bad score", () => {
  const sorted = sortJobs([
    job({ id: "unscored", discoveredAt: "2026-08-01T00:00:00.000Z" }),
    job({ id: "low", score: 1.2 }),
    job({ id: "high", score: 4.6 }),
  ]);
  assert.deepEqual(sorted.map((entry) => entry.id), ["high", "low", "unscored"]);
});

test("pendingJobs skips dropped jobs and returns the oldest first", () => {
  const waiting = pendingJobs([
    job({ id: "b", discoveredAt: "2026-08-02T00:00:00.000Z" }),
    job({ id: "a", discoveredAt: "2026-08-01T00:00:00.000Z" }),
    job({ id: "gone", status: "dropped" }),
    job({ id: "done", score: 3 }),
  ]);
  assert.deepEqual(waiting.map((entry) => entry.id), ["a", "b"]);
});

/* ── digest ── */

test("only new, unsent jobs at or above the floor are pushed", () => {
  const profile = { ...DEFAULT_JOB_PROFILE, minScore: 3.5 };
  const batch = digestCandidates([
    job({ id: "good", score: 4.0 }),
    job({ id: "exactly-floor", score: 3.5 }),
    job({ id: "below", score: 3.4 }),
    job({ id: "unscored" }),
    job({ id: "already-sent", score: 5, notifiedAt: "2026-08-18T08:00:00.000Z" }),
    job({ id: "dropped", score: 5, status: "dropped" }),
  ], profile);

  assert.deepEqual(batch.map((entry) => entry.id), ["good", "exactly-floor"]);
});

test("the digest carries every apply link verbatim", () => {
  const text = formatJobDigest([
    job({ id: "a", score: 4.6, reason: "Direct match on your agent work", url: "https://a.example/1" }),
    job({ id: "b", score: 3.9, company: "Beta", title: "Staff PM", url: "https://b.example/2" }),
  ], { locale: "en", scanned: 1847 });

  assert.match(text, /1847/);
  assert.match(text, /4\.6\s+Acme — Engineer/);
  assert.ok(text.includes("https://a.example/1"));
  assert.ok(text.includes("https://b.example/2"));
});

test("an empty digest says so instead of sending a bare header", () => {
  assert.match(formatJobDigest([], { locale: "en", scanned: 12 }), /No new matches\. \(12 postings checked\)/);
  assert.match(formatJobDigest([], { locale: "zh", scanned: 12 }), /没有新匹配/);
});

/* ── descriptions ── */

test("cleanDescription flattens markup and caps the length", () => {
  assert.equal(cleanDescription("<p>Hello   <b>world</b></p>"), "Hello world");
  assert.equal(cleanDescription("&lt;script&gt; &amp; co"), "<script> & co");
  const long = cleanDescription("x".repeat(2000), 100);
  assert.equal(long.length, 101, "100 characters plus the ellipsis");
  assert.ok(long.endsWith("…"));
});

/* ── presets ── */

test("a preset is only active once every one of its terms is present", () => {
  const [aiml] = TITLE_PRESETS;
  const empty = { ...DEFAULT_JOB_PROFILE, titles: [] };
  assert.equal(isPresetActive(aiml, empty), false);
  assert.equal(isPresetActive(aiml, { ...empty, titles: ["AI Engineer"] }), false, "partial is not active");
  assert.equal(isPresetActive(aiml, { ...empty, titles: [...aiml.titles] }), true);
  assert.equal(
    isPresetActive(aiml, { ...empty, titles: aiml.titles.map((entry) => entry.toUpperCase()) }),
    true,
    "matching is case-insensitive",
  );
});

test("switching a preset on adds only what is missing and keeps what you typed", () => {
  const [aiml] = TITLE_PRESETS;
  const profile = { ...DEFAULT_JOB_PROFILE, titles: ["Prompt Engineer", "ai engineer"] };
  const { titles } = togglePreset(aiml, profile, TITLE_PRESETS);

  assert.equal(titles[0], "Prompt Engineer", "your own keyword stays, and stays first");
  assert.equal(titles.filter((entry) => entry.toLowerCase() === "ai engineer").length, 1, "no duplicate");
  assert.ok(titles.includes("LLM Engineer"));
});

test("switching one off leaves the terms another active preset also claims", () => {
  // "Product Engineer" belongs to both fullstack and (by default) the profile.
  const fullstack = TITLE_PRESETS.find((preset) => preset.id === "fullstack");
  const product = TITLE_PRESETS.find((preset) => preset.id === "product");
  const profile = {
    ...DEFAULT_JOB_PROFILE,
    titles: [...new Set([...fullstack.titles, ...product.titles])],
  };

  const { titles } = togglePreset(fullstack, profile, TITLE_PRESETS);
  assert.equal(titles.includes("React Developer"), false, "fullstack-only terms go");
  assert.equal(titles.includes("Product Manager"), true, "product is still on, so its terms stay");
});

test("location presets write into the location lists, not the titles", () => {
  const sfbay = LOCATION_PRESETS.find((preset) => preset.id === "sfbay");
  const usonly = LOCATION_PRESETS.find((preset) => preset.id === "usonly");
  const empty = { ...DEFAULT_JOB_PROFILE, titles: [], locationAllow: [], locationBlock: [] };

  const allow = togglePreset(sfbay, empty, LOCATION_PRESETS);
  assert.ok(allow.locationAllow.includes("Palo Alto"));
  assert.equal(allow.titles, undefined, "a preset only returns the fields it touches");

  const block = togglePreset(usonly, empty, LOCATION_PRESETS);
  assert.ok(block.locationBlock.includes("Bengaluru"));
  assert.equal(block.locationAllow, undefined);
});

test("the shipped defaults are a working filter, not an empty one", () => {
  // An empty profile matches every title, so a first scan would return
  // thousands of rows and read as broken.
  assert.ok(DEFAULT_JOB_PROFILE.titles.length > 0);
  assert.ok(DEFAULT_JOB_PROFILE.locationAllow.length > 0);
  assert.equal(buildTitleFilter(DEFAULT_JOB_PROFILE.titles)("Senior AI Engineer"), "AI Engineer");
  assert.equal(buildTitleFilter(DEFAULT_JOB_PROFILE.titles)("Regional Sales Director"), null);
});

/* ── applied log ── */

test("the applied list reads newest-sent first, and undated rows sink", () => {
  const list = appliedJobs([
    job({ id: "old", status: "applied", appliedAt: "2026-08-01T00:00:00.000Z" }),
    job({ id: "new", status: "applied", appliedAt: "2026-08-17T00:00:00.000Z" }),
    job({ id: "legacy", status: "applied" }),
    job({ id: "not-applied", status: "shortlist", appliedAt: "2026-08-18T00:00:00.000Z" }),
  ]);
  assert.deepEqual(list.map((entry) => entry.id), ["new", "old", "legacy"]);
});

test("scoring throughput is configured apart from push size", () => {
  // Tying them together is what made a 200-job sweep take ten days to surface.
  assert.notEqual(DEFAULT_JOB_PROFILE.scoreBatch, DEFAULT_JOB_PROFILE.digestSize);
  assert.ok(DEFAULT_JOB_PROFILE.scoreBatch >= DEFAULT_JOB_PROFILE.digestSize);
});

test("the scoring model is unset by default, so nothing is pinned behind your back", () => {
  assert.equal(DEFAULT_JOB_PROFILE.scoreModel, null);
});

/* ── years of experience ── */

test("the years extractor reads the bar a posting actually sets", () => {
  assert.equal(extractYearsRequired("5+ years of professional software engineering experience"), 5);
  assert.equal(extractYearsRequired("Minimum of 4 years of relevant industry experience"), 4);
  assert.equal(extractYearsRequired("At least 1 year of hands-on experience with Python"), 1);
  // A range screens on its lower bound — that is the number the recruiter uses.
  assert.equal(extractYearsRequired("You have 3-5 years of experience building distributed systems"), 3);
  assert.equal(extractYearsRequired("2 to 4 years of professional experience"), 2);
});

test("a candidate must clear every bar, so the binding requirement is the largest", () => {
  // Two separate requirements: engineering seniority AND domain depth.
  assert.equal(
    extractYearsRequired("Have at least 5 years of software engineering experience, and 2 years experience in fraud analysis"),
    5,
  );
});

test("a nested sub-requirement is part of the bar, not a second one", () => {
  // The 2 is already inside the 8 — reporting it would wave through exactly
  // the applications this number exists to stop.
  assert.equal(
    extractYearsRequired("Bring 8+ years of engineering experience, including 2+ years managing engineers"),
    8,
  );
  assert.equal(
    extractYearsRequired("Have 5+ years of experience in engineering, of which 3+ years in infrastructure"),
    5,
  );
});

test("a preferred figure is not a requirement, and only governs its own clause", () => {
  assert.equal(extractYearsRequired("2+ years of experience required; 5+ years preferred"), 2);
  assert.equal(extractYearsRequired("Preferred qualifications: 7+ years of industry experience"), null);
  // A heading that reopens the hard requirements has to win over the one above it.
  assert.equal(
    extractYearsRequired("Preferred qualifications: strong Go. Requirements: 3+ years of professional experience"),
    3,
  );
});

test("years counted in a company's story are not years asked of the candidate", () => {
  for (const text of [
    "Founded in the last 3 years, we have grown fast",
    "Revenue doubled over the past 5 years",
    "We shipped this 2 years ago and never looked back",
    "In the first 2 years you will own the platform end to end",
    "Our team has 30 years of combined history as a company",
  ]) {
    assert.equal(extractYearsRequired(text), null, text);
  }
});

test("a number with no experience wording nearby is not a requirement", () => {
  assert.equal(extractYearsRequired("The lease runs 5 years"), null);
  assert.equal(extractYearsRequired(""), null);
  // Out of range: 0 is not a bar and 30 is a company's age, not a career.
  assert.equal(extractYearsRequired("0 years of experience required"), null);
  assert.equal(extractYearsRequired("30 years of engineering experience"), null);
});

test("the push gate drops postings asking for more years than the profile allows", () => {
  const profile = { ...DEFAULT_JOB_PROFILE, minScore: 4, maxYears: 3 };
  const base = { status: "new", score: 4.5, url: "https://x/1", company: "A", title: "T", location: "", source: "s", discoveredAt: "2026-01-01" };
  const jobs = [
    { ...base, id: "fits", yearsRequired: 3 },
    { ...base, id: "over", yearsRequired: 5 },
    // Silent postings stay in: not saying is not the same as asking for seven.
    { ...base, id: "silent" },
  ];
  assert.deepEqual(digestCandidates(jobs, profile).map((job) => job.id).sort(), ["fits", "silent"]);
  // Zero is the off switch, not a ceiling of zero.
  assert.equal(digestCandidates(jobs, { ...profile, maxYears: 0 }).length, 3);
});

test("the shipped push floor sits above the band a scorer lands on when unsure", () => {
  // The rubric calls 3.5-3.9 "plausible, but only with a specific reason".
  assert.ok(DEFAULT_JOB_PROFILE.minScore >= 4);
});
