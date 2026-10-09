"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");

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

module.exports = { openInBrowser };
