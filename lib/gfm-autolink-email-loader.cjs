// Bundler loader for mdast-util-gfm-autolink-literal, which remark-gfm uses to
// find bare URLs and emails. Since 2.0.1 its email regex starts with a
// lookbehind, which Safari only parses from 16.4. A regex literal Safari cannot
// parse is a SyntaxError for the whole chunk, and this one ships in the first
// load of `/`, so iOS 16.2 showed a blank page (#753). Upstream declined to
// change it (syntax-tree/mdast-util-gfm-autolink-literal#10).
//
// The loader builds the same regex at runtime instead and falls back to the
// one upstream shipped in 2.0.0 where lookbehind is missing. Both find the same
// emails: the lookbehind only skips start positions that `findEmail` rejects
// anyway, and `findAndReplace` retries a rejected match one character later.
// The fallback is only slower, quadratically so on long runs of word characters.
"use strict";

const LOOKBEHIND_LITERAL = String.raw`/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu`;
const LOOKBEHIND_SOURCE = LOOKBEHIND_LITERAL.slice(1, LOOKBEHIND_LITERAL.lastIndexOf("/"));
const FALLBACK_LITERAL = String.raw`/([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g`;

function rewriteGfmAutolinkEmailRegex(source) {
  const index = source.indexOf(LOOKBEHIND_LITERAL);
  if (index === -1) {
    throw new Error(
      "mdast-util-gfm-autolink-literal no longer contains the email regex that " +
        "lib/gfm-autolink-email-loader.cjs rewrites. Check whether its new code still " +
        "uses RegExp lookbehind (unparseable before Safari 16.4, #753), then update or remove the loader.",
    );
  }
  const expression =
    `(function () { try { return new RegExp(${JSON.stringify(LOOKBEHIND_SOURCE)}, "gu"); } ` +
    `catch (_) { return ${FALLBACK_LITERAL}; } })()`;
  return source.slice(0, index) + expression + source.slice(index + LOOKBEHIND_LITERAL.length);
}

module.exports = function gfmAutolinkEmailLoader(source) {
  return rewriteGfmAutolinkEmailRegex(source);
};
module.exports.rewriteGfmAutolinkEmailRegex = rewriteGfmAutolinkEmailRegex;
