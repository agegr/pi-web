import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.failWrites = false;
  }
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });

function useStorage(initial) {
  const storage = new MemoryStorage(initial);
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => storage });
  return storage;
}

const stored = (storage, key) => JSON.parse(storage.getItem(`pi-web:draft:${key}`) ?? "null");

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const store = await jiti.import("@/lib/draft-store");

/** A reload: a fresh copy of the module, with empty memory, over the same storage. */
async function reload() {
  return createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("@/lib/draft-store");
}

test("a session's draft text comes back after a reload, without its images", async () => {
  const storage = useStorage();
  store.setDraft("session-a", { value: "Hello", images: [{ data: "AAAA", mimeType: "image/png" }] });
  assert.equal(storage.getItem("pi-web:draft:session-a"), null, "the write waits for the delay");
  store.flushStoredDrafts();
  assert.equal(stored(storage, "session-a").text, "Hello");
  assert.equal(JSON.stringify(stored(storage, "session-a")).includes("AAAA"), false);

  const reloaded = await reload();
  assert.deepEqual(reloaded.getDraft("session-a"), { value: "Hello", images: [] });
});

test("the delayed write still lands, and leaving the page writes at once", async () => {
  const storage = useStorage();
  store.setDraft("session-delay", { value: "typed", images: [] });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(stored(storage, "session-delay").text, "typed");

  store.setDraft("session-pagehide", { value: "before reload", images: [] });
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(stored(storage, "session-pagehide").text, "before reload");

  store.setDraft("session-hidden", { value: "tab hidden", images: [] });
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  document.visibilityState = "visible";
  assert.equal(stored(storage, "session-hidden").text, "tab hidden");
});

test("clearing or emptying the text removes the stored copy at once", async () => {
  const storage = useStorage();
  store.setDraft("session-sent", { value: "send me", images: [] });
  store.flushStoredDrafts();
  store.clearDraft("session-sent");
  assert.equal(storage.getItem("pi-web:draft:session-sent"), null);

  // A pending write is dropped with the draft.
  store.setDraft("session-pending", { value: "x", images: [] });
  store.clearDraft("session-pending");
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-pending"), null);

  store.setDraft("session-images", { value: "caption", images: [] });
  store.flushStoredDrafts();
  store.setDraft("session-images", { value: "", images: [{ data: "AAAA", mimeType: "image/png" }] });
  assert.equal(storage.getItem("pi-web:draft:session-images"), null);
  assert.equal(store.getDraft("session-images").images.length, 1, "memory keeps the images");

  const reloaded = await reload();
  assert.equal(reloaded.getDraft("session-sent"), null);
  assert.equal(reloaded.getDraft("session-images"), null);
});

test("a fresh composer's keys stay in memory only; promotion stores the draft under the session id", () => {
  const storage = useStorage();
  store.setDraft("new:abc:/project", { value: "first prompt", images: [] });
  store.setDraft(store.parkedNewSessionDraftKey("/project"), { value: "parked", images: [] });
  store.flushStoredDrafts();
  assert.equal(storage.length, 0);

  store.rekeyDraft("new:abc:/project", "session-promoted");
  store.flushStoredDrafts();
  assert.equal(stored(storage, "session-promoted").text, "first prompt");
  store.clearDraft(store.parkedNewSessionDraftKey("/project"));
});

test("a failed send's text restored into a session's draft is stored, merged with the stored text", async () => {
  const storage = useStorage({ "pi-web:draft:session-restore": JSON.stringify({ text: "typed since", at: 1 }) });
  store.restoreDraftSubmission("session-restore", "sent text");
  store.flushStoredDrafts();
  assert.equal(stored(storage, "session-restore").text, "sent text\n\ntyped since");
});

test("text over the length cap stays in memory and its older stored copy is removed", () => {
  const storage = useStorage();
  store.setDraft("session-long", { value: "short", images: [] });
  store.flushStoredDrafts();
  const long = "x".repeat(store.MAX_STORED_DRAFT_LENGTH + 1);
  store.setDraft("session-long", { value: long, images: [] });
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-long"), null);
  assert.equal(store.getDraft("session-long").value, long);
});

test("only the most recently written drafts are kept", () => {
  const initial = {};
  for (let index = 0; index < store.MAX_STORED_DRAFTS; index++) {
    initial[`pi-web:draft:old-${index}`] = JSON.stringify({ text: `old ${index}`, at: index + 1 });
  }
  initial["pi-web:other-preference"] = "kept";
  const storage = useStorage(initial);
  store.setDraft("session-newest", { value: "newest", images: [] });
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:old-0"), null);
  assert.notEqual(storage.getItem("pi-web:draft:old-1"), null);
  assert.equal(stored(storage, "session-newest").text, "newest");
  assert.equal(storage.getItem("pi-web:other-preference"), "kept");
  assert.equal([...storage.values.keys()].filter((key) => key.startsWith("pi-web:draft:")).length, store.MAX_STORED_DRAFTS);
});

test("a refused write keeps the draft in memory and drops the stale stored copy", () => {
  const storage = useStorage({ "pi-web:draft:session-full": JSON.stringify({ text: "stale", at: 1 }) });
  assert.equal(store.getDraft("session-full").value, "stale");
  storage.failWrites = true;
  store.setDraft("session-full", { value: "current", images: [] });
  assert.doesNotThrow(() => store.flushStoredDrafts());
  assert.equal(storage.getItem("pi-web:draft:session-full"), null);
  assert.equal(store.getDraft("session-full").value, "current");
});

test("unavailable or corrupt storage falls back to memory", () => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => { throw new Error("SecurityError"); },
  });
  store.setDraft("session-private", { value: "private mode", images: [] });
  assert.doesNotThrow(() => store.flushStoredDrafts());
  assert.equal(store.getDraft("session-private").value, "private mode");
  assert.doesNotThrow(() => store.clearDraft("session-private"));

  useStorage({
    "pi-web:draft:session-corrupt": "{not json",
    "pi-web:draft:session-wrong": JSON.stringify({ text: 42 }),
  });
  assert.equal(store.getDraft("session-corrupt"), null);
  assert.equal(store.getDraft("session-wrong"), null);
});

test("typing that goes on is still written at the interval", async () => {
  const storage = useStorage();
  store.setDraft("session-typing", { value: "a", images: [] });
  await new Promise((resolve) => setTimeout(resolve, 200));
  store.setDraft("session-typing", { value: "ab", images: [] });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(stored(storage, "session-typing").text, "ab");
});

test("a held key stays out of storage until every hold is released", async () => {
  const storage = useStorage({ "pi-web:draft:session-held": JSON.stringify({ text: "/compact", at: 1 }) });
  assert.equal(store.getDraft("session-held").value, "/compact");
  const releaseEdit = store.holdStoredDraft("session-held");
  assert.equal(storage.getItem("pi-web:draft:session-held"), null, "the stored copy goes at once");
  const releaseCommand = store.holdStoredDraft("session-held");
  store.setDraft("session-held", { value: "rewritten", images: [] });
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-held"), null);

  releaseCommand();
  releaseCommand();
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-held"), null, "another hold remains");
  assert.equal((await reload()).getDraft("session-held"), null);

  releaseEdit();
  store.flushStoredDrafts();
  assert.equal(stored(storage, "session-held").text, "rewritten", "the release stores the draft again");

  const releaseCleared = store.holdStoredDraft("session-held");
  store.clearDraft("session-held");
  releaseCleared();
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-held"), null);
});

test("signing out removes every stored draft and nothing else", () => {
  const storage = useStorage({
    "pi-web:draft:one": JSON.stringify({ text: "one", at: 1 }),
    "pi-web:draft:two": JSON.stringify({ text: "two", at: 2 }),
    "pi-web:other-preference": "kept",
  });
  store.setDraft("session-pending-signout", { value: "pending", images: [] });
  store.clearStoredDrafts();
  store.flushStoredDrafts();
  assert.deepEqual([...storage.values.keys()], ["pi-web:other-preference"]);
});

test("the stored copy seeds a key once; the page's own changes win after that", () => {
  const storage = useStorage({ "pi-web:draft:session-once": JSON.stringify({ text: "from storage", at: 1 }) });
  assert.equal(store.getDraft("session-once").value, "from storage");
  store.clearDraft("session-once");
  storage.setItem("pi-web:draft:session-once", JSON.stringify({ text: "another tab", at: 2 }));
  assert.equal(store.getDraft("session-once"), null);
});
