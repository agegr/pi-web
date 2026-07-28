"use strict";

const MIN_NODE_VERSION = "22.19.0";

function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function isNodeVersionSupported(version) {
  const current = parseNodeVersion(version);
  const minimum = parseNodeVersion(MIN_NODE_VERSION);
  if (!current || !minimum) return false;

  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

function getUnsupportedNodeVersionMessage(version) {
  return [
    `Pi Web requires Node.js ${MIN_NODE_VERSION} or newer.`,
    `Current Node.js version: ${version}.`,
    "Upgrade Node.js and try again: https://nodejs.org/",
  ].join("\n");
}

module.exports = {
  MIN_NODE_VERSION,
  getUnsupportedNodeVersionMessage,
  isNodeVersionSupported,
};
