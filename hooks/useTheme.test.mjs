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
  assert.ok(match, "未找到 layout 的首屏主题脚本");
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

test("主题偏好将缺失和无效值解析为 system", () => {
  assert.equal(subject.readThemePreference(null), "system");
  assert.equal(subject.readThemePreference("sepia"), "system");
  assert.equal(subject.readThemePreference("light"), "light");
  assert.equal(subject.readThemePreference("dark"), "dark");
  assert.equal(subject.readThemePreference("system"), "system");
});

test("system 偏好解析为当前系统有效主题", () => {
  assert.equal(subject.resolveTheme("system", true), "dark");
  assert.equal(subject.resolveTheme("system", false), "light");
  assert.equal(subject.resolveTheme("dark", false), "dark");
});

test("system 偏好仅在存在订阅者时监听系统主题，并在最后取消订阅后清理", () => {
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

test("重新订阅 system 偏好时立即同步无订阅期间变化的系统主题", () => {
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

test("动画能力检测的 matchMedia 抛错时仍应用并持久化主题", () => {
  browser.setMatchMedia(() => { throw new Error("media unavailable"); });

  assert.doesNotThrow(() => subject.setThemePreference("dark"));
  assert.equal(browser.classes.has("dark"), true);
  assert.deepEqual(browser.writes.at(-1), ["pi-theme", "dark"]);
});

test("startViewTransition 同步抛错时仍应用并持久化主题", () => {
  browser.setMatchMedia(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  browser.setStartViewTransition(() => { throw new Error("transition unavailable"); });

  assert.doesNotThrow(() => subject.setThemePreference("light"));
  assert.equal(browser.classes.has("dark"), false);
  assert.deepEqual(browser.writes.at(-1), ["pi-theme", "light"]);
});

test("首屏脚本在存储读取失败后仍以 system 偏好使用系统深色主题", async () => {
  const classes = await runLayoutThemeScript({
    getItem() { throw new Error("storage unavailable"); },
    matchMedia() { return { matches: true }; },
  });

  assert.equal(classes.has("dark"), true);
});

test("首屏脚本在 matchMedia 缺失或失败时回退到浅色主题", async () => {
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
