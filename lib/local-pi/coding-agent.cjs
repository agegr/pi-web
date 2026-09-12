/* eslint-disable @typescript-eslint/no-require-imports -- Native loading keeps linked SDK code outside Next.js bundles. */
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
module.exports = createRequire(resolve(process.cwd(), "package.json"))("../pi/packages/coding-agent/dist/index.js");
