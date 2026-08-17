/**
 * Let the test runner import stylesheets.
 *
 * Modules such as lib/markdown.ts import their own CSS so that bundlers ship it
 * only with the routes that need it. Node's ESM loader has no idea what a .css
 * file is and throws ERR_UNKNOWN_FILE_EXTENSION, which takes down every test
 * that touches those modules.
 *
 * Resolving them to an empty module keeps the import a no-op under `node --test`
 * while leaving the bundler's behaviour untouched.
 */
import { registerHooks } from "node:module";

const STYLE_EXTENSIONS = [".css", ".scss", ".sass", ".less"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STYLE_EXTENSIONS.some((extension) => specifier.endsWith(extension))) {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
