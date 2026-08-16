import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appShell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const indexRoute = await readFile(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

test("AppShell uses TanStack navigation instead of next/navigation", () => {
  assert.doesNotMatch(appShell, /next\/navigation|useSearchParams|router\.replace/);
  assert.match(appShell, /useNavigate/);
  assert.match(appShell, /replace:\s*true/);
  assert.match(appShell, /resetScroll:\s*false/);
});

test("the migrated shell preserves the integrated project workspace", () => {
  assert.match(appShell, /import \{ CodexSidebar \} from "\.\/CodexSidebar"/);
  assert.match(appShell, /const SettingsPage = lazy\(\(\) => import\("\.\/SettingsPage"\)/);
  assert.match(appShell, /<CodexSidebar/);
  assert.match(appShell, /<SettingsPage/);
});

test("the index route validates optional session and cwd search strings", () => {
  assert.match(indexRoute, /validateSearch/);
  assert.match(indexRoute, /typeof search\.session === ["']string["']/);
  assert.match(indexRoute, /typeof search\.cwd === ["']string["']/);
  assert.match(indexRoute, /<AppShell/);
  assert.match(indexRoute, /<I18nProvider>/);
});

test("AppShell uses the typed root search hook", () => {
  assert.match(appShell, /useSearch\(\{ from: "\/" \}\)/);
});

test("AppShell keeps exactly three root clears and four session replacements", () => {
  const sessionReplacements = appShell.match(/navigate\(\{[\s\S]*?search: \{ session: (s\.id|session\.id|newSessionId),/g) || [];
  const rootClears = appShell.match(/navigate\(\{[\s\S]*?search: \{ session: undefined, cwd: undefined \},/g) || [];
  assert.equal(sessionReplacements.length, 4, "four session URL replacements expected");
  assert.equal(rootClears.length, 3, "three root URL clears expected");
});
