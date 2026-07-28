import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function createBrowserEnvironment() {
  const classes = new Set();
  const listeners = new Set();
  const writes = [];
  const mediaQuery = {
    matches: false,
    addEventListener(type, listener) {
      assert.equal(type, "change");
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      assert.equal(type, "change");
      listeners.delete(listener);
    },
  };

  globalThis.document = {
    documentElement: {
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          if (force) classes.add(name);
          else classes.delete(name);
          return force;
        },
      },
    },
  };
  globalThis.window = {
    matchMedia: () => mediaQuery,
    innerWidth: 1024,
    innerHeight: 768,
  };
  globalThis.localStorage = {
    getItem: () => null,
    setItem(key, value) { writes.push([key, value]); },
  };

  return {
    classes,
    listeners,
    writes,
    emitSystemChange(matches) {
      mediaQuery.matches = matches;
      for (const listener of listeners) listener({ matches });
    },
    setSystemMatchWithoutEvent(matches) {
      mediaQuery.matches = matches;
    },
    setMatchMedia(matchMedia) {
      globalThis.window.matchMedia = matchMedia;
    },
    setStartViewTransition(startViewTransition) {
      globalThis.document.startViewTransition = startViewTransition;
    },
  };
}

const browser = createBrowserEnvironment();
const subject = await import(`./useTheme.ts?test=${Date.now()}`);

async function loadLayoutThemeScript() {
  const hooksDirectory = path.dirname(fileURLToPath(import.meta.url));
  const layout = await readFile(path.join(hooksDirectory, "../app/layout.tsx"), "utf8");
  const match = layout.match(/__html: `([^`]+)`/);
  assert.ok(match, "Could not find the layout initial theme script");
  return match[1];
}

async function runLayoutThemeScript({ getItem, matchMedia }) {
  const script = await loadLayoutThemeScript();
  const classes = new Set();
  const document = {
    documentElement: {
      classList: {
        add(name) { classes.add(name); },
      },
    },
  };

  new Function("localStorage", "window", "document", script)(
    { getItem },
    { matchMedia },
    document,
  );
  return classes;
}

test("theme preference parses missing and invalid values as system", () => {
  assert.equal(subject.readThemePreference(null), "system");
  assert.equal(subject.readThemePreference("sepia"), "system");
  assert.equal(subject.readThemePreference("light"), "light");
  assert.equal(subject.readThemePreference("dark"), "dark");
  assert.equal(subject.readThemePreference("system"), "system");
});

test("system preference resolves to the current system theme", () => {
  assert.equal(subject.resolveTheme("system", true), "dark");
  assert.equal(subject.resolveTheme("system", false), "light");
  assert.equal(subject.resolveTheme("dark", false), "dark");
});

test("system preference watches the system theme only with subscribers and cleans up after the last unsubscribe", () => {
  assert.equal(browser.listeners.size, 0);

  const unsubscribe = subject.subscribeTheme(() => {});
  subject.setThemePreference("system");
  assert.equal(browser.listeners.size, 1);
  assert.deepEqual(browser.writes.at(-1), ["pi-theme", "system"]);

  browser.emitSystemChange(true);
  assert.equal(browser.classes.has("dark"), true);

  unsubscribe();
  assert.equal(browser.listeners.size, 0);

  const resubscribe = subject.subscribeTheme(() => {});
  assert.equal(browser.listeners.size, 1);
  resubscribe();
  assert.equal(browser.listeners.size, 0);

  const explicitSubscription = subject.subscribeTheme(() => {});
  subject.setThemePreference("light");
  assert.equal(browser.listeners.size, 0);
  assert.equal(browser.classes.has("dark"), false);
  assert.deepEqual(browser.writes.at(-1), ["pi-theme", "light"]);

  browser.emitSystemChange(true);
  assert.equal(browser.classes.has("dark"), false);
  explicitSubscription();
});

test("resubscribing to system preference immediately syncs system theme changes made while unsubscribed", () => {
  const initialSubscription = subject.subscribeTheme(() => {});
  subject.setThemePreference("system");
  browser.emitSystemChange(false);
  const writesBeforeResubscribe = browser.writes.length;

  initialSubscription();
  assert.equal(browser.listeners.size, 0);

  browser.setSystemMatchWithoutEvent(true);
  const resubscribe = subject.subscribeTheme(() => {});

  assert.equal(browser.classes.has("dark"), true);
  assert.equal(browser.listeners.size, 1);
  assert.equal(browser.writes.length, writesBeforeResubscribe);
  resubscribe();
});

test("theme is still applied and persisted when matchMedia throws during animation capability detection", () => {
  browser.setMatchMedia(() => { throw new Error("media unavailable"); });

  assert.doesNotThrow(() => subject.setThemePreference("dark"));
  assert.equal(browser.classes.has("dark"), true);
  assert.deepEqual(browser.writes.at(-1), ["pi-theme", "dark"]);
});

test("theme is still applied and persisted when startViewTransition throws synchronously", () => {
  browser.setMatchMedia(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  browser.setStartViewTransition(() => { throw new Error("transition unavailable"); });

  assert.doesNotThrow(() => subject.setThemePreference("light"));
  assert.equal(browser.classes.has("dark"), false);
  assert.deepEqual(browser.writes.at(-1), ["pi-theme", "light"]);
});

test("initial theme script still uses the system dark theme with system preference after storage access fails", async () => {
  const classes = await runLayoutThemeScript({
    getItem() { throw new Error("storage unavailable"); },
    matchMedia() { return { matches: true }; },
  });

  assert.equal(classes.has("dark"), true);
});

test("initial theme script falls back to the light theme when matchMedia is missing or fails", async () => {
  const missingMatchMedia = await runLayoutThemeScript({
    getItem() { return "system"; },
    matchMedia: undefined,
  });
  const throwingMatchMedia = await runLayoutThemeScript({
    getItem() { return "system"; },
    matchMedia() { throw new Error("media unavailable"); },
  });

  assert.equal(missingMatchMedia.has("dark"), false);
  assert.equal(throwingMatchMedia.has("dark"), false);
});
