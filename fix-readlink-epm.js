// Windows/Lenovo build workaround — loaded via `node --require` in the
// build/start scripts (see package.json).
//
// Lenovo apps (LeAppStore, LenovoTray, ...) create files under %LOCALAPPDATA%
// with ACLs that deny fs.readlink (EPERM). Next's @vercel/nft tracing calls
// readlink on them and hard-fails the build: next-trace-entrypoints-plugin
// only tolerates EINVAL/ENOENT/UNKNOWN, not EPERM. Those files are never real
// symlinks, so reporting "not a link" (empty string) is always correct.
//
// This must be a --require preload rather than a next.config.ts patch:
// webpack compilation runs in a worker where the config's fs patch is lost,
// while NODE_OPTIONS/--require preloads propagate to workers.

const fs = require("fs");

const origReadlink = fs.readlink;
const origReadlinkSync = fs.readlinkSync;

const patchedReadlink = function (path, ...args) {
  const callback = args.find((arg) => typeof arg === "function");
  if (callback) {
    return origReadlink(path, (err, link) => {
      if (err && err.code === "EPERM") return callback(null, "");
      return callback(err, link);
    });
  }
  try {
    return origReadlink(path, ...args);
  } catch (err) {
    if (err && err.code === "EPERM") return "";
    throw err;
  }
};

const patchedReadlinkSync = function (path, ...args) {
  try {
    return origReadlinkSync(path, ...args);
  } catch (err) {
    if (err && err.code === "EPERM") return "";
    throw err;
  }
};

fs.readlink = patchedReadlink;
fs.readlinkSync = patchedReadlinkSync;
