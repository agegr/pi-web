import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  expandChainedCommands,
  splitChainedCommands,
  parseCommandArgs,
  substituteArgs,
} = await createJiti(import.meta.url).import("./chained-commands.ts");

const templates = [
  { name: "ref", content: "REF body\ninput=$@\narg1=$1" },
  { name: "fuse", content: "FUSE body\ninput=$@" },
];

test("a single command that opens the prompt is expanded here", () => {
  const text = "/ref http://localhost:30141/?session=abc";
  const out = expandChainedCommands(text, templates);
  assert.match(out, /REF body/);
  assert.match(out, /input=http:\/\/localhost:30141\/\?session=abc/);
  assert.match(out, /一次性指令，仅对本次回复生效/);
});

test("plain text is untouched", () => {
  const text = "please /ref this";
  assert.equal(expandChainedCommands(text, templates), text);
});

test("two commands are expanded with their own arguments", () => {
  const out = expandChainedCommands(
    "/ref http://localhost:30141/?session=abc /fuse 重新分析商业模式",
    templates,
  );
  assert.match(out, /命令 1：\/ref/);
  assert.match(out, /命令 2：\/fuse/);
  assert.match(out, /REF body\ninput=http:\/\/localhost:30141\/\?session=abc\narg1=http:\/\/localhost:30141\/\?session=abc/);
  assert.match(out, /FUSE body\ninput=重新分析商业模式/);
  // The fuse command must not leak into ref's arguments.
  assert.doesNotMatch(out, /input=http:\/\/localhost:30141\/\?session=abc \/fuse/);
});

test("URL slashes and query strings never split a command", () => {
  const segments = splitChainedCommands(
    "/ref http://127.0.0.1:30142/?session=01a0f662-bad4-769f-a9e3-5eeb46de4b37 /fuse go",
    new Set(["ref", "fuse"]),
  );
  assert.equal(segments.length, 2);
  assert.equal(segments[0].args, "http://127.0.0.1:30142/?session=01a0f662-bad4-769f-a9e3-5eeb46de4b37");
  assert.equal(segments[1].args, "go");
});

test("newline-separated commands chain too", () => {
  const segments = splitChainedCommands("/ref id-123\n/fuse task", new Set(["ref", "fuse"]));
  assert.equal(segments.length, 2);
  assert.equal(segments[0].args, "id-123");
  assert.equal(segments[1].args, "task");
});

test("unknown slash tokens stay inside arguments", () => {
  const segments = splitChainedCommands("/ref /notacommand x", new Set(["ref", "fuse"]));
  assert.equal(segments, null);
});

test("a leading non-command token is not chained", () => {
  const segments = splitChainedCommands("x /ref a /fuse b", new Set(["ref", "fuse"]));
  assert.equal(segments, null);
});

test("three commands chain in order", () => {
  const segments = splitChainedCommands("/a 1 /b 2 /c 3", new Set(["a", "b", "c"]));
  assert.deepEqual(segments, [
    { name: "a", args: "1" },
    { name: "b", args: "2" },
    { name: "c", args: "3" },
  ]);
});

test("quoted arguments with slashes survive parsing", () => {
  assert.deepEqual(parseCommandArgs('one "two three" /four'), ["one", "two three", "/four"]);
});

test("a leading @file reference before a command still runs it", () => {
  const out = expandChainedCommands(
    '@"本地工作/Home App/"\n\n/fuse 双模型分析\n\n请读取项目当前的商业模式',
    templates,
  );
  assert.match(out, /FUSE body/);
  assert.match(out, /input=@本地工作\/Home App\/ 双模型分析 请读取项目当前的商业模式/);
  assert.doesNotMatch(out, /命令 1/);
});

test("a leading @file reference plus two commands chains them", () => {
  const out = expandChainedCommands(
    '@"本地工作/Home App/" /ref abc /fuse go',
    templates,
  );
  assert.match(out, /命令 1：\/ref/);
  assert.match(out, /命令 2：\/fuse/);
  assert.match(out, /input=@本地工作\/Home App\/ abc/);
});

test("a lone leading command is expanded here, with the one-shot scope rule", () => {
  const out = expandChainedCommands("/fuse task", templates);
  assert.match(out, /FUSE body/);
  assert.match(out, /一次性指令，仅对本次回复生效/);
  assert.doesNotMatch(out, /命令 1/);
});

test("every expansion carries the one-shot scope rule", () => {
  const cases = [
    "/fuse a",
    '@"dir/" /fuse a',
    "/ref x /fuse a",
    '@"dir/" /ref x /fuse a',
  ];
  for (const text of cases) {
    const out = expandChainedCommands(text, templates);
    assert.match(out, /一次性指令，仅对本次回复生效/, `missing scope rule for: ${text}`);
    assert.match(out, /后续对话默认按普通单模型对话处理/);
  }
});

test("a lone leading command is expanded, not left to the SDK", () => {
  const text = "/fuse task";
  assert.notEqual(expandChainedCommands(text, templates), text);
});

test("a leading @file without a following command is untouched", () => {
  const text = '@"本地工作/Home App/"\n\n请分析这个项目';
  assert.equal(expandChainedCommands(text, templates), text);
});

test("substituteArgs handles $@, $1, defaults and slices", () => {
  assert.equal(substituteArgs("a=$1 b=$2 all=$@", ["x", "y"]), "a=x b=y all=x y");
  assert.equal(substituteArgs("d=${1:-fallback}", []), "d=fallback");
  assert.equal(substituteArgs("s=${@:2}", ["a", "b", "c"]), "s=b c");
  assert.equal(substituteArgs("t=${@:1:2}", ["a", "b", "c"]), "t=a b");
});

