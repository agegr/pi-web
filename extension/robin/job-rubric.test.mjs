import assert from "node:assert/strict";
import { test } from "node:test";
import { ARCHETYPES, scoringPrompt, scoringRubric } from "./job-rubric.ts";

test("the rubric carries the rules that actually change a score", () => {
  for (const locale of ["en", "zh"]) {
    const text = scoringRubric(locale);
    // The three that showed up working in a live run: a hard cap on level
    // mismatch, a cap on unclearable blockers, and the no-fabrication rule.
    assert.match(text, /2\.5/, locale);
    assert.match(text, /2\.0/, locale);
    assert.match(text, /untrusted-posting/, locale);
    assert.match(text, /3\.5/, locale);
  }
});

test("the scoring prompt asks for every job, because a skipped job is invisible", () => {
  assert.match(scoringPrompt(40, "en"), /job_pending \(limit 40\)/);
  assert.match(scoringPrompt(40, "en"), /EVERY job/);
  assert.match(scoringPrompt(25, "zh"), /limit 25/);
  assert.match(scoringPrompt(25, "zh"), /一个都不要跳过/);
});

test("archetypes cover the shipped title presets' territory", () => {
  assert.ok(ARCHETYPES.some((a) => /LLMOps/.test(a)));
  assert.ok(ARCHETYPES.some((a) => /Forward Deployed/.test(a)));
  assert.ok(ARCHETYPES.some((a) => /Backend/.test(a)));
});
