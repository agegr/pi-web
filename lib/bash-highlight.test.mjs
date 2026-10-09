import assert from "node:assert/strict";
import test from "node:test";

const { tokenizeBash } = await import("./bash-highlight.ts");

/** The tokens as `kind:text` pairs, so a whole line reads in one assertion. */
function kinds(command, limit) {
  return tokenizeBash(command, limit)
    .map((token) => `${token.kind}:${token.text}`)
    .join(" | ");
}

test("marks the command of a pipeline, not its arguments", () => {
  assert.equal(
    kinds("ls -la /tmp | grep -i foo && echo done"),
    "command:ls | plain:  | flag:-la | plain:  | plain:/tmp | plain:  | operator:| | plain:  "
      + "| command:grep | plain:  | flag:-i | plain:  | plain:foo | plain:  | operator:&& | plain:  "
      + "| command:echo | plain:  | plain:done",
  );
  assert.equal(kinds("(cd sub && ls)"), "operator:( | command:cd | plain:  | plain:sub | plain:  | operator:&& | plain:  | command:ls | operator:)");
});

test("keeps a redirection's target and descriptor out of command position", () => {
  assert.equal(
    kinds("npm test 2>&1 | tail -5"),
    "command:npm | plain:  | plain:test | plain:  | plain:2 | operator:>& | plain:1 | plain:  "
      + "| operator:| | plain:  | command:tail | plain:  | plain:-5",
  );
});

test("separates quoted spans from the expansions inside them", () => {
  assert.equal(
    kinds('grep -rn "TODO $HOME" --include="*.ts"'),
    "command:grep | plain:  | flag:-rn | plain:  | string:\"TODO  | variable:$HOME | string:\" | plain:  "
      + "| flag:--include= | string:\"*.ts\"",
  );
  assert.equal(
    kinds("awk '{print $1}' \"$(pwd)/a\".txt"),
    "command:awk | plain:  | string:'{print $1}' | plain:  | string:\" | variable:$(pwd) | string:/a\" | plain:.txt",
  );
  assert.equal(
    kinds('diff <(ls) "a b" `date`'),
    "command:diff | plain:  | operator:<( | command:ls | operator:) | plain:  | string:\"a b\" | plain:  | variable:`date`",
  );
});

test("reads a new line as a fresh command and a comment as one line", () => {
  assert.equal(kinds("# note\nls -la"), "comment:# note | plain:\n | command:ls | plain:  | flag:-la");
  assert.equal(kinds("echo done  # note"), "command:echo | plain:  | plain:done | plain:   | comment:# note");
  // A `#` inside a word is part of it, not a comment.
  assert.equal(kinds("echo a#b"), "command:echo | plain:  | plain:a#b");
});

test("keeps variable assignments out of the command slot", () => {
  assert.equal(
    kinds("FOO=1 BAR=two node scripts/run.js --flag"),
    "variable:FOO= | plain:1 | plain:  | variable:BAR= | plain:two | plain:  | command:node | plain:  | plain:scripts/run.js | plain:  | flag:--flag",
  );
  // Inside an argument the assignment still reads as a variable, not a command.
  assert.equal(kinds("echo FOO=bar"), "command:echo | plain:  | variable:FOO= | plain:bar");
  // Only the name takes a colour, so a path-valued assignment stays readable.
  assert.equal(kinds("PATH=/usr/bin/local node x.js"), "variable:PATH= | plain:/usr/bin/local | plain:  | command:node | plain:  | plain:x.js");
  // `--flag=value` is no assignment (a name cannot start with `-`): the flag keeps the whole word.
  assert.equal(kinds("grep --include=*.ts src"), "command:grep | plain:  | flag:--include=*.ts | plain:  | plain:src");
});

test("cuts a preview at the limit without changing the text it keeps", () => {
  const command = "echo one two three four five six seven eight nine ten";
  const tokens = tokenizeBash(command, 12);
  assert.equal(tokens.map((token) => token.text).join(""), command.slice(0, 12));
  assert.equal(kinds(command, 12), "command:echo | plain:  | plain:one | plain:  | plain:two");
  assert.deepEqual(tokenizeBash("", 10), []);
});

test("keeps unterminated quotes, variables and escapes intact", () => {
  assert.equal(kinds('echo "open ${X'), 'command:echo | plain:  | string:"open  | variable:${X');
  assert.equal(kinds("echo $(ls"), "command:echo | plain:  | variable:$(ls");
  // An escaped space stays inside the word that quotes it.
  assert.equal(kinds("echo a\\ b"), "command:echo | plain:  | plain:a | plain:\\  | plain:b");
  // An unexpanded `$` and a negative number are ordinary text.
  assert.equal(kinds("echo $ -5 --flag"), "command:echo | plain:  | plain:$ | plain:  | plain:-5 | plain:  | flag:--flag");
});