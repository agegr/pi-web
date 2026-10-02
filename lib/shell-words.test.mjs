import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { formatShellCommand, literalWord, shellAssignment, splitShellWords } = await jiti.import("./shell-words.ts");

/** The words' texts, or the error code. */
function words(input) {
  const result = splitShellWords(input);
  return result.ok ? result.words.map((word) => word.text) : result.error;
}

test("splits on whitespace and removes quotes the way a POSIX shell does", () => {
  const cases = [
    ["npx -y @modelcontextprotocol/server-filesystem .", ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."]],
    ["  a \t b  ", ["a", "b"]],
    [`a "b c" 'd e' f\\ g`, ["a", "b c", "d e", "f g"]],
    [`a"b"'c'd`, ["abcd"]],
    [`"it's" 'say "hi"'`, ["it's", 'say "hi"']],
    [`"a\\"b" "c\\\\d" "e\\$f" "g\\h"`, ['a"b', "c\\d", "e$f", "g\\h"]],
    [`'' ""`, ["", ""]],
    [`$'a\\tb\\x41\\u00e9\\'c'`, ["a\tbAé'c"]],
    [`$'\\U0001F600'`, ["\u{1F600}"]],
    // No such character: past U+10FFFF, or a lone surrogate. bash prints the escape as text.
    [`$'\\U110000' $'\\UFFFFFFFF' $'\\uD800x'`, ["\\U110000", "\\UFFFFFFFF", "\\uD800x"]],
    [`$"translated"`, ["translated"]],
    ["a=b --x=y", ["a=b", "--x=y"]],
    ["~/bin/server *.js {a,b} !x", ["~/bin/server", "*.js", "{a,b}", "!x"]],
    ["", []],
    ["   \n  ", []],
  ];
  for (const [input, expected] of cases) assert.deepEqual(words(input), expected, input);
});

test("joins lines continued with a backslash, a caret (cmd) or a backtick (PowerShell)", () => {
  assert.deepEqual(words("npx -y pkg \\\n  --flag"), ["npx", "-y", "pkg", "--flag"]);
  assert.deepEqual(words("npx -y pkg \\   \r\n  --flag"), ["npx", "-y", "pkg", "--flag"]);
  assert.deepEqual(words("npx ^\n  pkg"), ["npx", "pkg"]);
  assert.deepEqual(words("npx `\n  pkg"), ["npx", "pkg"]);
  assert.deepEqual(words("ab\\\ncd"), ["abcd"]);
  assert.deepEqual(words('"multi\\\nline"'), ["multiline"]);
});

test("skips comments and blank lines but refuses a second command", () => {
  assert.deepEqual(words("# install it\n\nnpx pkg # the server\n\n"), ["npx", "pkg"]);
  assert.deepEqual(words("npx a#b"), ["npx", "a#b"]);
  assert.deepEqual(words("npx a\nnpx b"), { code: "multiple-commands" });
});

test("refuses what needs a shell: operators, substitutions, special parameters", () => {
  const cases = [
    ["npx a | tee log", { code: "shell-operator", operator: "|" }],
    ["npx a && npx b", { code: "shell-operator", operator: "&&" }],
    ["npx a; npx b", { code: "shell-operator", operator: ";" }],
    ["npx a > log", { code: "shell-operator", operator: ">" }],
    ["npx a 2>&1", { code: "shell-operator", operator: ">&" }],
    ["npx a < in", { code: "shell-operator", operator: "<" }],
    ["npx a &", { code: "shell-operator", operator: "&" }],
    ["npx https://x/mcp?a=1&b=2", { code: "shell-operator", operator: "&" }],
    ["(npx a)", { code: "shell-operator", operator: "(" }],
    ["npx $(cat key)", { code: "command-substitution", syntax: "$(" }],
    ['npx "$(cat key)"', { code: "command-substitution", syntax: "$(" }],
    ["npx $((1+2))", { code: "command-substitution", syntax: "$((" }],
    ["npx `cat key`", { code: "command-substitution", syntax: "`" }],
    ["npx $1", { code: "shell-parameter", parameter: "$1" }],
    ["npx ${@}", { code: "shell-parameter", parameter: "${@}" }],
    ["npx ${#X}", { code: "unsupported-expansion", expansion: "${#X}" }],
    ["npx ${X/a/b}", { code: "unsupported-expansion", expansion: "${X/a/b}" }],
    ["npx 'open", { code: "unterminated-quote", quote: "'" }],
    ['npx "open', { code: "unterminated-quote", quote: '"' }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(words(input), expected, input);
});

test("quoted operators and substitutions are plain text", () => {
  assert.deepEqual(words(`npx 'a | b' "c && d" '$(x)' "https://x/mcp?a=1&b=2"`), ["npx", "a | b", "c && d", "$(x)", "https://x/mcp?a=1&b=2"]);
});

test("returns variables as their own parts instead of expanding them", () => {
  const [word] = splitShellWords('"Bearer $TOKEN-${SUFFIX}"').words;
  assert.deepEqual(word.parts, [
    { type: "text", value: "Bearer ", quote: "double" },
    { type: "variable", name: "TOKEN", raw: "$TOKEN", quote: "double" },
    { type: "text", value: "-", quote: "double" },
    { type: "variable", name: "SUFFIX", raw: "${SUFFIX}", quote: "double" },
  ]);
  assert.equal(word.text, "Bearer $TOKEN-${SUFFIX}");
  assert.equal(literalWord(word), undefined);

  const [fallback] = splitShellWords("${BASE:-https://x.example}").words;
  assert.deepEqual(fallback.parts, [{ type: "variable", name: "BASE", raw: "${BASE:-https://x.example}", quote: "none", fallback: "https://x.example" }]);

  const [single] = splitShellWords("'$TOKEN'").words;
  assert.equal(literalWord(single), "$TOKEN");
  // A `$` before a space or at the end is literal.
  assert.deepEqual(words("price $ 5$"), ["price", "$", "5$"]);
});

test("keeps the backslashes of Windows paths", () => {
  assert.deepEqual(words(String.raw`npx -y @modelcontextprotocol/server-filesystem C:\Users\me\Desktop D:\data`), [
    "npx", "-y", "@modelcontextprotocol/server-filesystem", String.raw`C:\Users\me\Desktop`, String.raw`D:\data`,
  ]);
  assert.deepEqual(words(String.raw`"C:\Program Files\nodejs\node.exe" server.js`), [String.raw`C:\Program Files\nodejs\node.exe`, "server.js"]);
  assert.deepEqual(words(String.raw`\\fileserver\share\mcp.exe "\\host\c$\dir"`), [String.raw`\\fileserver\share\mcp.exe`, String.raw`\\host\c$\dir`]);
  assert.deepEqual(words(String.raw`.\server.exe --root .\data`), [String.raw`.\server.exe`, "--root", String.raw`.\data`]);
  // POSIX escapes still work outside Windows paths.
  assert.deepEqual(words(String.raw`a\ b a\\b a\"b a\$b`), ["a b", "a\\b", 'a"b', "a$b"]);
});

test("reads `NAME=value` assignments only when the name and `=` are unquoted", () => {
  const [assigned, quotedName, plain] = splitShellWords(`API_KEY="a b$X" 'B=c' --flag=x`).words;
  assert.deepEqual(shellAssignment(assigned), {
    name: "API_KEY",
    value: [{ type: "text", value: "a b", quote: "double" }, { type: "variable", name: "X", raw: "$X", quote: "double" }],
  });
  assert.equal(shellAssignment(quotedName), undefined);
  assert.equal(shellAssignment(plain), undefined);
  const [empty] = splitShellWords("A=").words;
  assert.deepEqual(shellAssignment(empty), { name: "A", value: [] });
});

test("formats words so that splitting them again gives the same words", () => {
  const original = ["npx", "a b", "it's", "", String.raw`C:\x`, "$HOME", "x|y", "--flag=1", "~/p", "#tag", "!bang"];
  const line = formatShellCommand(original);
  assert.equal(line, String.raw`npx 'a b' 'it'\''s' '' 'C:\x' '$HOME' 'x|y' --flag=1 ~/p '#tag' '!bang'`);
  assert.deepEqual(words(line), original);
});
