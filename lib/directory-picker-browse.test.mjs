import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, interopDefault: true });
const {
  SHOW_HIDDEN_STORAGE_KEY,
  buildBrowseUrl,
  loadShowHiddenPreference,
  saveShowHiddenPreference,
  createBrowseController,
  createShowHiddenLifecycle,
  validateNewFileName,
  NEW_FILE_NAME_ISSUES,
  runCreateSubmission,
  createFolderInDirectory,
  createFileInDirectory,
} = await jiti.import("./directory-picker-browse.ts");

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

function browseBody(directory, names) {
  return {
    path: directory,
    parentPath: "/",
    directories: names.map((name) => ({ name, path: `${directory}/${name}` })),
  };
}

test("buildBrowseUrl emits exactly the literal showHidden=true, omitted when unchecked", () => {
  assert.equal(buildBrowseUrl(undefined, false), "/api/cwd/browse");
  assert.equal(buildBrowseUrl(undefined, undefined), "/api/cwd/browse");
  assert.equal(buildBrowseUrl("/home/alice", false), "/api/cwd/browse?path=%2Fhome%2Falice");
  assert.equal(buildBrowseUrl("/home/alice", true), "/api/cwd/browse?path=%2Fhome%2Falice&showHidden=true");
  // The wire format is the literal "true" — never "1".
  assert.ok(buildBrowseUrl("/x", true).endsWith("showHidden=true"));
  assert.ok(!buildBrowseUrl("/x", true).includes("showHidden=1"));
});

test("the show-hidden preference defaults to unchecked and round-trips through storage", () => {
  const fresh = memoryStorage();
  assert.equal(loadShowHiddenPreference(fresh), false, "fresh storage must read unchecked");
  assert.equal(SHOW_HIDDEN_STORAGE_KEY, "directoryPicker.showHidden");

  saveShowHiddenPreference(fresh, true);
  assert.equal(fresh.getItem(SHOW_HIDDEN_STORAGE_KEY), "true");
  assert.equal(loadShowHiddenPreference(fresh), true, "survives a close/reopen of the dialog");

  saveShowHiddenPreference(fresh, false);
  assert.equal(loadShowHiddenPreference(fresh), false);
});

test("composed show-hidden lifecycle: navigate away, toggle targets the CURRENT path, stale dropped, reopen restores", async () => {
  const storage = memoryStorage({ [SHOW_HIDDEN_STORAGE_KEY]: "false" });
  const state = { checked: false };
  const requests = [];
  const gates = [];
  const fetchFn = async (url) => {
    requests.push(url);
    const directory = new URL(url, "http://localhost").searchParams.get("path") ?? "/home";
    // The FIRST request hangs so its response arrives stale, after the
    // newer navigated-to one is applied.
    if (requests.length === 1) await new Promise((resolve) => gates.push(resolve));
    return jsonResponse(browseBody(directory, []));
  };
  const controller = createBrowseController({
    fetchFn,
    showHidden: () => state.checked,
    onResult: () => {},
  });
  const reloads = [];
  const lifecycle = createShowHiddenLifecycle({
    storage: () => storage,
    onPreference: (checked) => { state.checked = checked; },
    reload: () => { reloads.push(requests.length); void controller.refetchCurrent(); },
  });

  // Mount: initialize (persisted false → unchecked), then browse /initial.
  assert.equal(lifecycle.initialize(), false);
  const initialBrowse = controller.browse("/initial");
  await new Promise((resolve) => setImmediate(resolve));
  // Navigate away: /navigated is applied while the /initial response hangs.
  await controller.browse("/navigated");

  // Toggle ON: the reload targets the CURRENT directory (/navigated, not
  // /initial) and carries the literal showHidden=true.
  lifecycle.toggle(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.checked, true);
  assert.equal(storage.getItem(SHOW_HIDDEN_STORAGE_KEY), "true");
  const toggleUrl = requests[requests.length - 1];
  assert.ok(toggleUrl.includes("path=" + encodeURIComponent("/navigated")), `toggle reloads the current directory: ${toggleUrl}`);
  assert.ok(toggleUrl.includes("showHidden=true"), "the toggle refetch carries the literal true");

  // The stale /initial response lands LAST and is dropped (no error, no clobber).
  gates[0]();
  await initialBrowse;

  // Reopen (fresh lifecycle over the same storage): the checked preference
  // is restored without any extra interaction.
  const state2 = { checked: false };
  const lifecycle2 = createShowHiddenLifecycle({
    storage: () => storage,
    onPreference: (checked) => { state2.checked = checked; },
    reload: () => {},
  });
  assert.equal(lifecycle2.initialize(), true, "reopen restores the persisted checked preference");
});

test("a throwing localStorage acquisition degrades to unchecked and never aborts the reload", () => {
  const applied = [];
  let reloaded = 0;
  const lifecycle = createShowHiddenLifecycle({
    // Browser storage policy can deny access at PROPERTY-GET time; the
    // lifecycle catches the acquisition itself.
    storage: () => { throw new Error("SecurityError: storage denied"); },
    onPreference: (checked) => applied.push(checked),
    reload: () => { reloaded += 1; },
  });
  assert.equal(lifecycle.initialize(), false, "denied storage defaults to unchecked");
  assert.deepEqual(applied, [false], "the preference is still applied so the browse can follow");
  lifecycle.toggle(true);
  assert.deepEqual(applied, [false, true]);
  assert.equal(reloaded, 1, "the reload still runs when storage is unavailable");
});

test("the controller applies results in request order and drops stale responses", async () => {
  const seen = [];
  const deferred = [];
  const fetchFn = async (url) => {
    seen.push(url);
    const directory = new URL(url, "http://localhost").searchParams.get("path");
    // The FIRST request of each pair hangs until the test releases it, so
    // the OLDER response physically arrives AFTER the newer one is applied.
    if (seen.length % 2 === 1) {
      await new Promise((resolve) => deferred.push(resolve));
    }
    return jsonResponse(browseBody(directory ?? "/start", [`dir-${seen.length}`]));
  };
  const results = [];
  let loadingEvents = [];
  const controller = createBrowseController({
    fetchFn,
    showHidden: () => false,
    onLoading: (loading) => loadingEvents.push(loading),
    onResult: (result) => results.push(result),
    onError: (message) => { throw new Error(`unexpected error: ${message}`); },
  });

  const first = controller.browse("/start");
  const second = controller.browse("/start");
  assert.deepEqual(loadingEvents, [true, true]);
  // The newer response lands even though the older request is still pending.
  await second;
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].directories.map((entry) => entry.name), ["dir-2"]);
  // Now the OLDER response arrives — after the newer one — and must NOT
  // clobber the applied listing.
  deferred[0]();
  await first;
  assert.equal(results.length, 1, "a late stale response never wins");
  assert.deepEqual(results[0].directories.map((entry) => entry.name), ["dir-2"]);
  // Loading cleared by the current request only.
  assert.deepEqual(loadingEvents, [true, true, false]);
});

test("refetchCurrent targets the CURRENT browsed directory, not the initial path", async () => {
  const requested = [];
  const fetchFn = async (url) => {
    const directory = new URL(url, "http://localhost").searchParams.get("path");
    requested.push(directory);
    return jsonResponse(browseBody(directory, []));
  };
  const controller = createBrowseController({ fetchFn, onResult: () => {} });
  await controller.browse("/initial");
  await controller.browse("/initial/navigated");
  requested.length = 0;
  await controller.refetchCurrent();
  assert.deepEqual(requested, ["/initial/navigated"], "the toggle reload re-fetches the navigated-to directory");
});

test("the controller consults showHidden at request time and reports errors", async () => {
  let showHidden = false;
  const urls = [];
  const fetchFn = async (url) => {
    urls.push(url);
    if (urls.length === 1) return jsonResponse({ error: "Directory does not exist" }, { status: 404 });
    return jsonResponse(browseBody("/x", []));
  };
  const errors = [];
  const results = [];
  const controller = createBrowseController({
    fetchFn,
    showHidden: () => showHidden,
    onResult: (result) => results.push(result),
    onError: (message) => errors.push(message),
  });
  await controller.browse("/missing");
  assert.deepEqual(errors, ["Directory does not exist"]);
  showHidden = true;
  await controller.refetchCurrent();
  assert.ok(urls[1].includes("showHidden=true"), "a refetch after toggling carries the new value");
});

test("validateNewFileName returns typed issue CODES (never user-facing English)", () => {
  assert.equal(validateNewFileName("notes.md"), null);
  assert.equal(validateNewFileName("a.b.c"), null);
  assert.equal(validateNewFileName("folder name with spaces"), null);
  assert.equal(validateNewFileName(""), "required");
  assert.equal(validateNewFileName("a/b"), "pathSeparator");
  assert.equal(validateNewFileName("a\\b"), "pathSeparator");
  assert.equal(validateNewFileName("."), "dotSegment");
  assert.equal(validateNewFileName(".."), "dotSegment");
  assert.equal(validateNewFileName("a\0b"), "invalid");
  assert.equal(validateNewFileName("n".repeat(256)), "tooLong");
  // Every code the UI must translate exists in the closed set, so the
  // i18n catalogs can be checked key-complete against it.
  assert.deepEqual([...NEW_FILE_NAME_ISSUES], ["required", "invalid", "dotSegment", "pathSeparator", "tooLong"]);
});

test("a FAILED navigation never becomes the refetch target: the toggle keeps refreshing the displayed directory", async () => {
  const requested = [];
  let failNext = false;
  const fetchFn = async (url) => {
    const directory = new URL(url, "http://localhost").searchParams.get("path");
    requested.push(directory);
    if (failNext) return jsonResponse({ error: "Directory does not exist" }, { status: 404 });
    return jsonResponse(browseBody(directory, ["alpha"]));
  };
  const errors = [];
  const controller = createBrowseController({ fetchFn, onResult: () => {}, onError: (m) => errors.push(m) });
  await controller.browse("/data");
  failNext = true;
  await controller.browse("/missing");
  assert.deepEqual(errors, ["Directory does not exist"], "the failed navigation surfaces its error");
  requested.length = 0;
  await controller.refetchCurrent();
  assert.deepEqual(requested, ["/data"], "refetchCurrent targets the still-DISPLAYED directory, never the failed target");
});

test("runCreateSubmission drives the real create flows: zero-request rejection, typed failures, success transitions", async () => {
  const events = [];
  const base = {
    kind: "file",
    rawName: "notes.md",
    currentPath: "/work",
    translateIssue: (issue) => `i18n:${issue}`,
    conflictMessage: "i18n:conflict",
    onBusy: (busy) => events.push(`busy:${busy}`),
    onFormError: (message) => events.push(`error:${message}`),
    onFolderCreated: (joined) => events.push(`folder:${joined}`),
    onFileCreated: () => events.push("file-created"),
    onListingRefresh: () => events.push("refresh"),
  };

  // Unsafe names: rejected LOCALLY — zero fetches, zero state churn, the
  // typed issue is translated by the UI boundary.
  {
    const { fetchFn, calls } = recordingFetch([]);
    await runCreateSubmission({ ...base, rawName: "a/b", fetchFn });
    assert.equal(calls.length, 0, "no request is issued for an unsafe name");
    assert.deepEqual(events, ["error:i18n:pathSeparator"], "the translated code is surfaced");
  }
  events.length = 0;

  // HTTP 207 with an errors array: a typed failure — the form error shows
  // and NOTHING else happens (the listing and current directory stay).
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ cwd: "/work" }),
      jsonResponse({ errors: [{ error: "write refused" }] }, { status: 207 }),
    ]);
    await runCreateSubmission({ ...base, fetchFn });
    assert.deepEqual(events, ["busy:true", "busy:false", "error:write refused"], "a 207 is a failure, never a success");
  }
  events.length = 0;

  // 409: the conflict message for the kind.
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ cwd: "/work" }),
      jsonResponse({ error: "exists" }, { status: 409 }),
    ]);
    await runCreateSubmission({ ...base, fetchFn });
    assert.deepEqual(events, ["busy:true", "busy:false", "error:i18n:conflict"]);
  }
  events.length = 0;

  // File success: notice + listing refresh, never navigation.
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ cwd: "/work" }),
      jsonResponse({ ok: true }),
    ]);
    await runCreateSubmission({ ...base, fetchFn });
    assert.deepEqual(events, ["busy:true", "busy:false", "file-created", "refresh"]);
  }
  events.length = 0;

  // Folder success: navigates INTO the created folder (joined with the
  // production joinDirectoryPath).
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ cwd: "/work" }),
      jsonResponse({ ok: true }),
    ]);
    await runCreateSubmission({ ...base, kind: "folder", rawName: " new-dir ", fetchFn });
    assert.deepEqual(events, ["busy:true", "busy:false", "folder:/work/new-dir"], "names are trimmed; the created folder is entered");
  }
});

function recordingFetch(responses) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const handler = responses.shift();
    if (typeof handler === "function") return handler(url);
    return handler;
  };
  return { fetchFn, calls };
}

test("createFolderInDirectory validates the parent first, then mkdir; failures are typed", async () => {
  // Success: validate → mkdir, in order.
  {
    const { fetchFn, calls } = recordingFetch([
      jsonResponse({ success: true, cwd: "/parent" }),
      jsonResponse({ path: "/parent/new-folder" }),
    ]);
    const result = await createFolderInDirectory(fetchFn, "/parent", "new-folder");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls[0].url, "/api/cwd/validate");
    assert.equal(calls[1].url, "/api/files/parent?type=mkdir");
    assert.equal(calls[1].init.method, "POST");
    assert.equal(JSON.parse(calls[1].init.body).name, "new-folder");
  }
  // Parent validate fails: no mkdir request, typed error, nothing lost.
  {
    const { fetchFn, calls } = recordingFetch([
      jsonResponse({ error: "Directory does not exist" }, { status: 400 }),
    ]);
    const result = await createFolderInDirectory(fetchFn, "/parent", "new-folder");
    assert.deepEqual(result, { ok: false, status: 400, error: "Directory does not exist" });
    assert.equal(calls.length, 1, "no write is attempted after a failed parent validation");
  }
  // Conflict: typed 409 status so the dialog can localize it.
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ success: true }),
      jsonResponse({ error: "Folder already exists", conflict: true }, { status: 409 }),
    ]);
    const result = await createFolderInDirectory(fetchFn, "/parent", "new-folder");
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  }
  // Network failure on the mkdir request itself.
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ success: true }),
      () => { throw new Error("offline"); },
    ]);
    const result = await createFolderInDirectory(fetchFn, "/parent", "new-folder");
    assert.deepEqual(result, { ok: false, status: 0, error: "offline" });
  }
});

test("creation at the POSIX filesystem root reaches the handler (root encodes as %2F)", async () => {
  const { fetchFn, calls } = recordingFetch([
    jsonResponse({ cwd: "/" }),
    jsonResponse({ ok: true }),
    jsonResponse({ cwd: "/" }),
    jsonResponse({ ok: true }),
  ]);
  assert.deepEqual(await createFolderInDirectory(fetchFn, "/", "projects"), { ok: true });
  assert.deepEqual(await createFileInDirectory(fetchFn, "/", "notes.md"), { ok: true });
  // The parent validate ran on "/" for both flows…
  assert.equal(calls[0].url, "/api/cwd/validate");
  assert.equal(JSON.parse(calls[0].init.body).cwd, "/");
  assert.equal(calls[2].url, "/api/cwd/validate");
  // …and the write requests carry a NON-EMPTY root segment that the
  // catch-all route matches and filePathFromApiSegments resolves back to
  // "/" — not the empty path a bare root used to produce.
  assert.equal(calls[1].url, "/api/files/%2F?type=mkdir");
  assert.equal(calls[3].url, "/api/files/%2F?type=create-file");
});

test("createFileInDirectory posts type=create-file and surfaces every failure shape", async () => {
  // Success.
  {
    const { fetchFn, calls } = recordingFetch([
      jsonResponse({ success: true, cwd: "/parent" }),
      jsonResponse({ path: "/parent/notes.md" }),
    ]);
    const result = await createFileInDirectory(fetchFn, "/parent", "notes.md");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls[0].url, "/api/cwd/validate");
    assert.equal(calls[1].url, "/api/files/parent?type=create-file");
    assert.equal(JSON.parse(calls[1].init.body).name, "notes.md");
  }
  // Plain 400 error body.
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ success: true }),
      jsonResponse({ error: "File names must not contain a path: a/b" }, { status: 400 }),
    ]);
    const result = await createFileInDirectory(fetchFn, "/parent", "a/b");
    assert.deepEqual(result, { ok: false, status: 400, error: "File names must not contain a path: a/b" });
  }
  // Typed 409 conflict.
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ success: true }),
      jsonResponse({ error: "File already exists", conflict: true }, { status: 409 }),
    ]);
    const result = await createFileInDirectory(fetchFn, "/parent", "notes.md");
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  }
  // HTTP 207 multi-status body carrying an `errors` array.
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ success: true }),
      jsonResponse({ uploaded: [], errors: [{ name: "notes.md", error: "Cannot replace a directory" }] }, { status: 207 }),
    ]);
    const result = await createFileInDirectory(fetchFn, "/parent", "notes.md");
    assert.deepEqual(result, { ok: false, status: 207, error: "Cannot replace a directory" });
  }
  // Non-JSON body falls back to the HTTP status.
  {
    const { fetchFn } = recordingFetch([
      jsonResponse({ success: true }),
      new Response("Server Error", { status: 500 }),
    ]);
    const result = await createFileInDirectory(fetchFn, "/parent", "notes.md");
    assert.deepEqual(result, { ok: false, status: 500, error: "HTTP 500" });
  }
  // Network failure.
  {
    const { fetchFn } = recordingFetch([() => { throw new Error("connection refused"); }]);
    const result = await createFileInDirectory(fetchFn, "/parent", "notes.md");
    assert.deepEqual(result, { ok: false, status: 0, error: "connection refused" });
  }
});

// ---------------------------------------------------------------------------
// wi pi#49 R3: the row-scoped create engine surface and the footer-mounted
// show-hidden toggle.
// ---------------------------------------------------------------------------

test("runCreateSubmission targets the ROW's currentPath, joining the created folder under it", async () => {
  const events = [];
  const { fetchFn, calls } = recordingFetch([
    jsonResponse({ cwd: "/work/row" }),
    jsonResponse({ ok: true }),
  ]);
  await runCreateSubmission({
    kind: "folder",
    rawName: " made-in-row ",
    currentPath: "/work/row", // the row's directory, not the browsed one
    translateIssue: (issue) => `i18n:${issue}`,
    conflictMessage: "i18n:conflict",
    onBusy: () => {},
    onFormError: (message) => events.push(`error:${message}`),
    onFolderCreated: (joined) => events.push(`folder:${joined}`),
    onFileCreated: () => events.push("file-created"),
    onListingRefresh: () => events.push("refresh"),
    fetchFn,
  });
  // The write posted against the row's directory.
  assert.equal(calls[1].url, "/api/files/work/row?type=mkdir");
  // The completion callback receives the row-rooted joined path — what the
  // row flow turns into a listing refresh (never a navigation).
  assert.deepEqual(events, ["folder:/work/row/made-in-row"]);
});

test("toggling show-hidden live reveals a .git entry and the preference persists", async () => {
  const storage = memoryStorage();
  const state = { checked: false };
  const applied = [];
  const fetchFn = async (url) => {
    const params = new URL(url, "http://localhost").searchParams;
    const directory = params.get("path") ?? "/work";
    const hidden = params.get("showHidden") === "true";
    const names = hidden ? ["normal", ".git"] : ["normal"];
    return jsonResponse(browseBody(directory, names));
  };
  const controller = createBrowseController({
    fetchFn,
    showHidden: () => state.checked,
    onResult: (result) => applied.push(result),
  });
  const lifecycle = createShowHiddenLifecycle({
    storage: () => storage,
    onPreference: (checked) => { state.checked = checked; },
    reload: () => void controller.refetchCurrent(),
  });

  // Mount + first browse: hidden dot-directories are omitted.
  assert.equal(lifecycle.initialize(), false);
  await controller.browse("/work");
  assert.deepEqual(applied.at(-1).directories.map((entry) => entry.name), ["normal"]);

  // Toggle ON: the CURRENT directory reloads with showHidden=true and the
  // .git entry appears in the applied listing.
  lifecycle.toggle(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(applied.at(-1).directories.map((entry) => entry.name), ["normal", ".git"],
    "the live toggle reveals the .git entry");

  // The preference persists: a fresh mount reads it back checked.
  assert.equal(storage.getItem(SHOW_HIDDEN_STORAGE_KEY), "true");
  assert.equal(
    loadShowHiddenPreference(storage),
    true,
    "the checkbox state survives a close/reopen of the dialog",
  );
});
