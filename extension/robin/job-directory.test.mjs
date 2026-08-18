import assert from "node:assert/strict";
import { test } from "node:test";
import { DIRECTORIES, directoryById, prettifySlug, withinWindow } from "./job-directory.ts";

test("dataset slugs are refused unless they are safe to put in a URL", () => {
  // The board list is third-party crowd-sourced input that ends up
  // interpolated into a request URL. This is the guard that makes that safe.
  const greenhouse = directoryById("greenhouse");
  assert.ok(greenhouse.toCompany("acme-corp"));
  assert.ok(greenhouse.toCompany("0x"));
  assert.equal(greenhouse.toCompany("../../etc/passwd"), null);
  assert.equal(greenhouse.toCompany("acme/../evil"), null);
  assert.equal(greenhouse.toCompany("acme?x=1"), null);
  assert.equal(greenhouse.toCompany("acme#frag"), null);
  assert.equal(greenhouse.toCompany("evil.com/acme"), null);
  assert.equal(greenhouse.toCompany(""), null);
});

test("a constructed board URL always lands on that ATS's own host", () => {
  for (const directory of DIRECTORIES) {
    const company = directory.toCompany("acme");
    assert.ok(company, directory.id);
    const { hostname, protocol } = new URL(company.url);
    assert.equal(protocol, "https:", directory.id);
    assert.match(hostname, /greenhouse\.io$|lever\.co$|ashbyhq\.com$/, directory.id);
  }
});

test("a reverse sweep drops undated postings, unlike the forward scan", () => {
  // The forward scan keeps them — a board that omits dates omits them for
  // every row. Here the whole question is "what appeared recently", so an
  // undated backlog across 15,000 boards would bury the answer.
  assert.equal(withinWindow({ postedAt: "2026-08-17" }, "2026-08-11"), true);
  assert.equal(withinWindow({ postedAt: "2026-08-01" }, "2026-08-11"), false);
  assert.equal(withinWindow({ postedAt: undefined }, "2026-08-11"), false);
  assert.equal(withinWindow({ postedAt: undefined }, null), true, "no window means no date gate");
});

test("board slugs are tidied for display without pretending to be real names", () => {
  assert.equal(prettifySlug("acme-corp"), "Acme Corp");
  assert.equal(prettifySlug("scale_ai"), "Scale Ai");
  assert.equal(prettifySlug("openai"), "Openai");
  // Nothing recovers a name from a run-together slug, and inventing one would
  // be worse than showing what the directory actually said.
  assert.equal(prettifySlug("8thlightrebuild"), "8thlightrebuild");
});
