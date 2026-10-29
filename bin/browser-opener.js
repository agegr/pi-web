"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getOpenUrl } = require("./run-records");

// Next.js prints "Ready" before it has loaded its request handlers, and the
// first request then also waits out the pi SDK import that instrumentation
// starts (#964): half a second on macOS, seconds on a slow disk, and a first
// navigation that outlasts the service worker's 8 s timeout shows
// offline.html (#1358). Past this limit the browser opens anyway.
const FIRST_PAGE_TIMEOUT_MS = 30_000;
const FIRST_PAGE_RETRY_MS = 250;

function openInBrowser(url, platform = process.platform) {
  // Avoid `shell: true` to suppress Node.js DEP0190 deprecation
  // ("Passing args to a child process with shell option true can lead to
  // security vulnerabilities, as the arguments are not escaped").
  // Pass a structured argv so Node.js handles escaping instead of
  // concatenating the args into a shell command string.
  let opener;
  if (platform === "win32") {
    // `start` is a cmd.exe built-in, so invoke cmd directly. The empty
    // title argument is required by `start` before the target URL.
    opener = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], {
      stdio: "ignore",
      detached: true,
    });
  } else {
    opener = spawn(platform === "darwin" ? "open" : "xdg-open", [url], {
      stdio: "ignore",
      detached: true,
    });
  }

  opener.on("error", (error) => {
    console.warn(`Could not open browser automatically: ${error.message}`);
  });

  opener.unref();
}

// Resolves true once url has answered a GET with any HTTP status and the whole
// body has arrived, or false when nothing answered within timeoutMs. Never
// rejects. Redirects are followed: with PI_WEB_PASSWORD, / redirects to /login,
// the page the browser lands on, and the proxy sends that redirect while the
// pi SDK import is still running.
async function waitForFirstPage(url, {
  fetchImpl = fetch,
  timeoutMs = FIRST_PAGE_TIMEOUT_MS,
  retryMs = FIRST_PAGE_RETRY_MS,
} = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  while (!deadline.aborted) {
    try {
      const response = await fetchImpl(url, { signal: deadline });
      // The page has rendered once its body has arrived, not its headers.
      await response.arrayBuffer();
      return true;
    } catch {
      if (!deadline.aborted) await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  return false;
}

// Opens the browser once the server has served its first page, so the
// browser's own first navigation finds the page route loaded. A wildcard bind
// is asked on loopback. Port 0 leaves the real port unknown, so that browser
// opens at once. The launcher exits with Next.js, which ends the wait too.
function openWhenServing({ hostname, port, url, open = openInBrowser, wait = waitForFirstPage }) {
  const served = port === "0" ? Promise.resolve() : wait(`${getOpenUrl(hostname, port)}/`);
  return served.then(() => open(url));
}

module.exports = { openInBrowser, openWhenServing, waitForFirstPage };
