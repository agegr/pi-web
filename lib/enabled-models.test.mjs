import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  clearEnabledModels,
  computeEnabledModelsState,
  modelRefProvider,
  pruneStaleEnabledModels,
  constrainProviderEntries,
  renameModelPatterns,
  renameProviderPatterns,
  setModelsEnabled,
} = await jiti.import("./enabled-models.ts");

const AVAILABLE = [
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-opus-4-1",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5.5",
  "zen/x:exacto",
];

/** Stand-in for the SDK resolver: exact refs, `provider/*` globs and `*`. */
function resolve(pattern, availableRefs) {
  const colon = pattern.lastIndexOf(":");
  const levels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  const suffix = colon >= 0 ? pattern.slice(colon + 1) : "";
  const pin = levels.has(suffix) ? suffix : undefined;
  const body = pin ? pattern.slice(0, colon) : pattern;
  // Like minimatch: `*` stops at a slash, `**` crosses it.
  const matched = body === "*"
    ? availableRefs.filter((ref) => !ref.slice(ref.indexOf("/") + 1).includes("/"))
    : body === "**"
      ? [...availableRefs]
      : body.endsWith("/**")
        ? availableRefs.filter((ref) => modelRefProvider(ref) === body.slice(0, -3))
        : body.endsWith("/*")
          ? availableRefs.filter((ref) => (
            modelRefProvider(ref) === body.slice(0, -2)
              && !ref.slice(ref.indexOf("/") + 1).includes("/")
          ))
          : availableRefs.filter((ref) => ref === body);
  return { pattern, matched, ...(pin ? { pin } : {}) };
}

/** Mirror of `resolveProviderGlobs()`: keep a candidate only if it covers exactly. */
function providerGlobs(availableRefs) {
  const globs = {};
  for (const ref of availableRefs) {
    const provider = modelRefProvider(ref);
    if (globs[provider]) continue;
    const refs = availableRefs.filter((candidate) => modelRefProvider(candidate) === provider);
    for (const candidate of [`${provider}/*`, `${provider}/**`]) {
      const matched = resolve(candidate, availableRefs).matched;
      if (matched.length === refs.length && matched.every((r) => refs.includes(r))) {
        globs[provider] = candidate;
        break;
      }
    }
  }
  return globs;
}

function input(patterns, availableRefs = AVAILABLE) {
  return {
    patterns,
    availableRefs,
    resolutions: (patterns ?? []).map((pattern) => resolve(pattern, availableRefs)),
    providerGlobs: providerGlobs(availableRefs),
  };
}

test("state reports everything enabled when no pattern narrows the list", () => {
  assert.deepEqual(computeEnabledModelsState(input(undefined)), {
    allEnabled: true,
    enabled: AVAILABLE,
    pins: {},
    stalePatterns: [],
  });
});

test("state treats a fully stale list as unscoped and keeps the stale patterns", () => {
  const state = computeEnabledModelsState(input(["gone/*", "missing/model"]));
  assert.equal(state.allEnabled, true);
  assert.deepEqual(state.enabled, AVAILABLE);
  assert.deepEqual(state.stalePatterns, ["gone/*", "missing/model"]);
});

test("state resolves globs, pins and stale entries together", () => {
  const state = computeEnabledModelsState(input(["anthropic/*:high", "openai/gpt-5.5", "gone/*"]));
  assert.equal(state.allEnabled, false);
  assert.deepEqual(state.enabled, [
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-opus-4-1",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-5.5",
  ]);
  assert.equal(state.pins["anthropic/claude-opus-4-1"], "high");
  assert.deepEqual(state.stalePatterns, ["gone/*"]);
});

test("first disable materializes provider globs instead of the whole catalog", () => {
  const result = setModelsEnabled(input(undefined), ["anthropic/claude-opus-4-1"], false);
  assert.equal(result.ok, true);
  assert.deepEqual(result.patterns, [
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-haiku-4-5",
    "openai/*",
    "zen/*",
  ]);
  assert.equal(result.changed, true);
});

test("disable expands only the pattern that covers the model and keeps its pin", () => {
  const result = setModelsEnabled(
    input(["anthropic/*:high", "openai/gpt-5.5"]),
    ["anthropic/claude-opus-4-1"],
    false,
  );
  assert.deepEqual(result.patterns, [
    "anthropic/claude-sonnet-4-6:high",
    "anthropic/claude-haiku-4-5:high",
    "openai/gpt-5.5",
  ]);
});

test("disable drops a pattern that matched only the removed model", () => {
  const result = setModelsEnabled(
    input(["anthropic/claude-opus-4-1", "openai/gpt-5.5"]),
    ["anthropic/claude-opus-4-1"],
    false,
  );
  assert.deepEqual(result.patterns, ["openai/gpt-5.5"]);
});

test("disable removes the model from every pattern that covers it", () => {
  const result = setModelsEnabled(
    input(["anthropic/*", "anthropic/claude-opus-4-1"]),
    ["anthropic/claude-opus-4-1"],
    false,
  );
  assert.deepEqual(result.patterns, ["anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5"]);
});

test("disabling a whole provider leaves the other providers untouched", () => {
  const result = setModelsEnabled(
    input(["anthropic/*", "openai/gpt-5.5", "gone/*"]),
    ["anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-1", "anthropic/claude-haiku-4-5"],
    false,
  );
  assert.deepEqual(result.patterns, ["openai/gpt-5.5", "gone/*"]);
});

test("disabling the last enabled model is refused", () => {
  const result = setModelsEnabled(input(["openai/gpt-5.5"]), ["openai/gpt-5.5"], false);
  assert.deepEqual(result, { ok: false, reason: "last-model" });
});

test("stale patterns alone do not count as an enabled model", () => {
  const result = setModelsEnabled(input(["openai/gpt-5.5", "gone/*"]), ["openai/gpt-5.5"], false);
  assert.deepEqual(result, { ok: false, reason: "last-model" });
});

test("enable appends the model and preserves entry order", () => {
  const result = setModelsEnabled(
    input(["openai/gpt-5.5", "anthropic/claude-opus-4-1"]),
    ["anthropic/claude-sonnet-4-6"],
    true,
  );
  assert.deepEqual(result.patterns, [
    "openai/gpt-5.5",
    "anthropic/claude-opus-4-1",
    "anthropic/claude-sonnet-4-6",
  ]);
});

test("enable collapses a fully enabled provider into one glob at its first slot", () => {
  const result = setModelsEnabled(
    input(["anthropic/claude-sonnet-4-6", "openai/gpt-5.5", "anthropic/claude-opus-4-1"]),
    ["anthropic/claude-haiku-4-5"],
    true,
  );
  assert.deepEqual(result.patterns, ["anthropic/*", "openai/gpt-5.5"]);
});

test("enable keeps explicit entries when the provider carries a thinking pin", () => {
  const result = setModelsEnabled(
    input(["anthropic/claude-sonnet-4-6:high", "anthropic/claude-opus-4-1"]),
    ["anthropic/claude-haiku-4-5"],
    true,
  );
  assert.deepEqual(result.patterns, [
    "anthropic/claude-sonnet-4-6:high",
    "anthropic/claude-opus-4-1",
    "anthropic/claude-haiku-4-5",
  ]);
});

test("enable is a no-op when the model is already covered", () => {
  const before = input(["anthropic/*", "openai/gpt-5.5"]);
  const result = setModelsEnabled(before, ["anthropic/claude-opus-4-1"], true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.patterns, before.patterns);
});

test("enabling the last missing provider drops the setting", () => {
  const result = setModelsEnabled(
    input(["anthropic/*", "openai/*"]),
    ["zen/x:exacto"],
    true,
  );
  assert.equal(result.patterns, undefined);
  assert.equal(result.changed, true);
});

test("a stale pattern keeps the setting alive even when everything is enabled", () => {
  const result = setModelsEnabled(
    input(["anthropic/*", "openai/*", "gone/*"]),
    ["zen/x:exacto"],
    true,
  );
  assert.deepEqual(result.patterns, ["anthropic/*", "openai/*", "gone/*", "zen/x:exacto"]);
});

test("a thinking pin keeps the setting alive even when everything is enabled", () => {
  const result = setModelsEnabled(
    input(["anthropic/*:high", "openai/*"]),
    ["zen/x:exacto"],
    true,
  );
  assert.deepEqual(result.patterns, ["anthropic/*:high", "openai/*", "zen/x:exacto"]);
});

test("a model id containing a colon round-trips through an expansion", () => {
  const result = setModelsEnabled(input(["*:low"]), ["openai/gpt-5.5"], false);
  assert.deepEqual(result.patterns, [
    "anthropic/claude-sonnet-4-6:low",
    "anthropic/claude-opus-4-1:low",
    "anthropic/claude-haiku-4-5:low",
    "zen/x:exacto:low",
  ]);
});

test("unknown references are ignored instead of being written out", () => {
  const before = input(["anthropic/*"]);
  const result = setModelsEnabled(before, ["ghost/model"], true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.patterns, before.patterns);
});

test("clearing the scope drops every pattern, stale ones included", () => {
  assert.deepEqual(clearEnabledModels(input(["anthropic/*", "gone/*"])), {
    ok: true,
    patterns: undefined,
    changed: true,
  });
  assert.equal(clearEnabledModels(input(undefined)).changed, false);
});

// ── Model ids containing slashes (extension providers, OpenRouter, …) ─────────

const NESTED = [
  "commandcode/gpt-5.5",
  "commandcode/sakana/fugu-ultra",
  "commandcode/moonshotai/kimi-k2.6",
  "openai/gpt-5.5",
  "openai/gpt-5.4",
];

test("a provider with nested model ids collapses to a glob that covers them", () => {
  const result = setModelsEnabled(
    input(["commandcode/gpt-5.5", "openai/gpt-5.5"], NESTED),
    ["commandcode/sakana/fugu-ultra", "commandcode/moonshotai/kimi-k2.6"],
    true,
  );
  // `commandcode/*` here would silently drop both nested ids again (15/71 bug).
  assert.deepEqual(result.patterns, ["commandcode/**", "openai/gpt-5.5"]);
});

test("enabling a provider whose stored glob under-matches repairs the entry", () => {
  const result = setModelsEnabled(
    input(["commandcode/*", "openai/gpt-5.5"], NESTED),
    NESTED.filter((ref) => ref.startsWith("commandcode/")),
    true,
  );
  assert.deepEqual(result.patterns, ["commandcode/**", "openai/gpt-5.5"]);
});

test("nested ids materialize through a covering glob, not provider/*", () => {
  const result = setModelsEnabled(input(undefined, NESTED), ["openai/gpt-5.5"], false);
  assert.deepEqual(result.patterns, ["commandcode/**", "openai/gpt-5.4"]);
});

test("a provider with no covering glob is written model by model", () => {
  const noGlob = { ...input(undefined, NESTED), providerGlobs: {} };
  const result = setModelsEnabled(noGlob, ["openai/gpt-5.5"], false);
  assert.deepEqual(result.patterns, [
    "commandcode/gpt-5.5",
    "commandcode/sakana/fugu-ultra",
    "commandcode/moonshotai/kimi-k2.6",
    "openai/gpt-5.4",
  ]);
});

test("without a covering glob, a full provider keeps its explicit entries", () => {
  const stored = ["commandcode/gpt-5.5", "commandcode/sakana/fugu-ultra"];
  const noGlob = { ...input(stored, NESTED), providerGlobs: {} };
  const result = setModelsEnabled(noGlob, ["commandcode/moonshotai/kimi-k2.6"], true);
  assert.deepEqual(result.patterns, [...stored, "commandcode/moonshotai/kimi-k2.6"]);
});

// ── Normalizing a fully enabled provider on every write ──────────────────────

test("an untouched provider that is fully enabled is normalized to its glob", () => {
  // pi renamed deepseek's models in a catalog refresh, leaving an explicit list
  // that is complete today but would not pick up the next rename. Editing an
  // unrelated provider heals it.
  const result = setModelsEnabled(
    input(["anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-1", "anthropic/claude-haiku-4-5"]),
    ["openai/gpt-5.5"],
    true,
  );
  assert.deepEqual(result.patterns, ["anthropic/*", "openai/gpt-5.5"]);
});

test("a single exact reference is left alone, even when it covers its provider", () => {
  const result = setModelsEnabled(
    input(["openai/gpt-5.5", "anthropic/claude-sonnet-4-6"]),
    ["anthropic/claude-opus-4-1"],
    true,
  );
  assert.deepEqual(result.patterns, [
    "openai/gpt-5.5",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-opus-4-1",
  ]);
});

test("a redundant entry beside a glob is merged away", () => {
  const result = setModelsEnabled(
    input(["anthropic/*", "anthropic/claude-opus-4-1"]),
    ["openai/gpt-5.5"],
    true,
  );
  assert.deepEqual(result.patterns, ["anthropic/*", "openai/gpt-5.5"]);
});

test("normalizing leaves partly enabled providers and stale entries alone", () => {
  const result = setModelsEnabled(
    input(["anthropic/claude-sonnet-4-6", "openai/gpt-5.5", "gone/*"]),
    ["anthropic/claude-opus-4-1"],
    true,
  );
  assert.deepEqual(result.patterns, [
    "anthropic/claude-sonnet-4-6",
    "openai/gpt-5.5",
    "gone/*",
    "anthropic/claude-opus-4-1",
  ]);
});

test("normalizing keeps a provider whose entries pin a thinking level", () => {
  const result = setModelsEnabled(
    input([
      "anthropic/claude-sonnet-4-6:high",
      "anthropic/claude-opus-4-1:high",
      "anthropic/claude-haiku-4-5:high",
    ]),
    ["openai/gpt-5.5"],
    true,
  );
  assert.deepEqual(result.patterns, [
    "anthropic/claude-sonnet-4-6:high",
    "anthropic/claude-opus-4-1:high",
    "anthropic/claude-haiku-4-5:high",
    "openai/gpt-5.5",
  ]);
});


// ── Pruning entries that match nothing ───────────────────────────────────────

test("pruning drops only the unmatched entries", () => {
  const result = pruneStaleEnabledModels(
    input(["deepseek/v4-flash", "anthropic/*", "gone/*", "openai/gpt-5.5"]),
  );
  assert.deepEqual(result.patterns, ["anthropic/*", "openai/gpt-5.5"]);
  assert.equal(result.changed, true);
});

test("pruning is a no-op when every entry matches", () => {
  const before = input(["anthropic/*", "openai/gpt-5.5"]);
  const result = pruneStaleEnabledModels(before);
  assert.equal(result.changed, false);
  assert.deepEqual(result.patterns, before.patterns);
});

test("pruning a list that is only stale removes the setting", () => {
  const result = pruneStaleEnabledModels(input(["gone/*", "missing/model"]));
  assert.equal(result.patterns, undefined);
  assert.equal(result.changed, true);
});

test("pruning keeps the scope when the survivors still narrow it", () => {
  const result = pruneStaleEnabledModels(input(["anthropic/*", "gone/*"]));
  assert.deepEqual(result.patterns, ["anthropic/*"]);
});

test("a wider pattern already covering a provider is not rewritten", () => {
  // `*` covers both openai models here (it stops at the nested commandcode ids),
  // so openai's own entries are redundant and stay exactly as written.
  const before = input(["*", "openai/gpt-5.5", "openai/gpt-5.4"], NESTED);
  const result = setModelsEnabled(before, ["openai/gpt-5.5"], true);
  assert.equal(result.changed, false);
  assert.deepEqual(result.patterns, before.patterns);
});

// ── Following a custom provider that was renamed in models.json ─────────────

test("renaming rewrites the entries of that provider and keeps the rest", () => {
  assert.deepEqual(
    renameProviderPatterns(
      ["my-gateway/alpha:high", "my-gateway/*", "anthropic/*", "my-gateway-old/x"],
      [{ from: "my-gateway", to: "house" }],
    ),
    ["house/alpha:high", "house/*", "anthropic/*", "my-gateway-old/x"],
  );
});

test("renaming several providers at once is one rewrite", () => {
  assert.deepEqual(
    renameProviderPatterns(["a/one", "b/two", "c/three"], [{ from: "a", to: "x" }, { from: "b", to: "y" }]),
    ["x/one", "y/two", "c/three"],
  );
});

test("renaming is a no-op without patterns or without a real rename", () => {
  assert.equal(renameProviderPatterns(undefined, [{ from: "a", to: "b" }]), undefined);
  const before = ["anthropic/*"];
  assert.equal(renameProviderPatterns(before, []), before);
  assert.equal(renameProviderPatterns(before, [{ from: "a", to: "a" }]), before);
  assert.deepEqual(renameProviderPatterns(before, [{ from: "x", to: "y" }]), before);
});

// ── Entries whose provider prefix stopped scoping them ──────────────────────

const OVERMATCH = [
  "stepfun/aaa",
  "stepfun/ddd",
  "commandcode/stepfun/Step-5-Preview",
  "commandcode/gpt-5.5",
];

/** Hand-built resolution: pi matches a pattern against the bare model id too. */
function overmatchInput(patterns, resolutions) {
  return { patterns, availableRefs: OVERMATCH, resolutions, providerGlobs: {} };
}

test("a glob reaching into another provider is cut back to its own", () => {
  const result = constrainProviderEntries(overmatchInput(
    ["commandcode/gpt-5.5", "stepfun/*"],
    [
      { pattern: "commandcode/gpt-5.5", matched: ["commandcode/gpt-5.5"] },
      {
        pattern: "stepfun/*",
        matched: ["stepfun/aaa", "stepfun/ddd", "commandcode/stepfun/Step-5-Preview"],
      },
    ],
  ));
  assert.deepEqual(result.patterns, ["commandcode/gpt-5.5", "stepfun/aaa", "stepfun/ddd"]);
  assert.equal(result.changed, true);
});

test("cutting an entry back keeps its thinking pin", () => {
  const result = constrainProviderEntries(overmatchInput(
    ["stepfun/*:high"],
    [{
      pattern: "stepfun/*:high",
      matched: ["stepfun/aaa", "commandcode/stepfun/Step-5-Preview"],
      pin: "high",
    }],
  ));
  assert.deepEqual(result.patterns, ["stepfun/aaa:high"]);
});

test("an entry that stays inside its provider is left alone", () => {
  const before = overmatchInput(
    ["stepfun/aaa", "commandcode/**"],
    [
      { pattern: "stepfun/aaa", matched: ["stepfun/aaa"] },
      { pattern: "commandcode/**", matched: ["commandcode/stepfun/Step-5-Preview", "commandcode/gpt-5.5"] },
    ],
  );
  const result = constrainProviderEntries(before);
  assert.equal(result.changed, false);
  assert.deepEqual(result.patterns, before.patterns);
});

test("a bare model id that only looks like a prefix is left alone", () => {
  // `stepfun/Step-5-Preview` is commandcode's model id, not a stepfun scope.
  const before = overmatchInput(
    ["stepfun/Step-5-Preview"],
    [{ pattern: "stepfun/Step-5-Preview", matched: ["commandcode/stepfun/Step-5-Preview"] }],
  );
  const result = constrainProviderEntries(before);
  assert.equal(result.changed, false);
  assert.deepEqual(result.patterns, before.patterns);
});

test("a catch-all pattern names no provider and is never cut back", () => {
  const before = overmatchInput(
    ["**"],
    [{ pattern: "**", matched: [...OVERMATCH] }],
  );
  assert.equal(constrainProviderEntries(before).changed, false);
});

// ── Following a model that was renamed in models.json ───────────────────────

test("renaming a model rewrites its entry and keeps the pin", () => {
  assert.deepEqual(
    renameModelPatterns(
      ["stepfun/aaa", "stepfun/ddd", "stepfun/ddd:high", "stepfun/*"],
      [{ from: "stepfun/ddd", to: "stepfun/ddd1" }],
    ),
    ["stepfun/aaa", "stepfun/ddd1", "stepfun/ddd1:high", "stepfun/*"],
  );
});

test("a colon inside a model id is not mistaken for a thinking pin", () => {
  assert.deepEqual(
    renameModelPatterns(["zen/x:exacto"], [{ from: "zen/x", to: "zen/y" }]),
    ["zen/x:exacto"],
  );
  assert.deepEqual(
    renameModelPatterns(["zen/x:exacto:high"], [{ from: "zen/x:exacto", to: "zen/y" }]),
    ["zen/y:high"],
  );
});

test("renaming a model is a no-op without patterns or without a real rename", () => {
  assert.equal(renameModelPatterns(undefined, [{ from: "a/b", to: "a/c" }]), undefined);
  const before = ["stepfun/aaa"];
  assert.equal(renameModelPatterns(before, []), before);
  assert.deepEqual(renameModelPatterns(before, [{ from: "stepfun/zzz", to: "stepfun/yyy" }]), before);
});

test("a model rename spells the provider id the settings file still uses", () => {
  // Applied before the provider rewrite, so both moves land in one pass.
  const afterModels = renameModelPatterns(
    ["old/ddd", "old/*"],
    [{ from: "old/ddd", to: "new/ddd1" }],
  );
  assert.deepEqual(renameProviderPatterns(afterModels, [{ from: "old", to: "new" }]), [
    "new/ddd1",
    "new/*",
  ]);
});
