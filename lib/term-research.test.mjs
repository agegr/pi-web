import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./term-research.ts");
}

test("trimContextAround keeps a window around the selected term", async () => {
  const { trimContextAround } = await loadSubject();
  const text = `${"a".repeat(900)} TARGET ${"b".repeat(900)}`;
  const trimmed = trimContextAround(text, "TARGET", 100);
  assert.ok(trimmed.startsWith("…"));
  assert.ok(trimmed.endsWith("…"));
  assert.ok(trimmed.includes("TARGET"));
  assert.ok(trimmed.length < 400);
});

test("trimContextAround falls back to head when the term cannot be located", async () => {
  const { trimContextAround } = await loadSubject();
  const text = "hello world ".repeat(400);
  const trimmed = trimContextAround(text, "missing term", 50);
  assert.ok(trimmed.length <= 101);
  assert.ok(trimmed.startsWith("hello"));
});

test("trimContextAround collapses whitespace before matching", async () => {
  const { trimContextAround } = await loadSubject();
  const text = "before\n  the   attention   mechanism\n  after";
  const trimmed = trimContextAround(text, "the attention mechanism", 10);
  assert.ok(trimmed.includes("before"));
  assert.ok(trimmed.includes("after"));
});

test("summarizeExplanation strips markdown and truncates", async () => {
  const { summarizeExplanation } = await loadSubject();
  assert.equal(summarizeExplanation("**Gradient descent** iterates over params."), "Gradient descent iterates over params.");
  assert.equal(summarizeExplanation("# Title\n\nBody line"), "Body line");
  assert.equal(summarizeExplanation("[link text](http://x) rest"), "link text rest");
  const long = "x".repeat(200);
  const summary = summarizeExplanation(long);
  assert.ok(summary.length <= 91);
  assert.ok(summary.endsWith("…"));
});

test("buildExplainMessages embeds context and ancestor path", async () => {
  const { buildExplainMessages } = await loadSubject();
  const { system, user } = buildExplainMessages({
    term: "KV cache",
    context: "Transformer inference uses a KV cache.",
    ancestors: [{ term: "Transformer", summary: "A neural architecture." }],
    depth: "deep",
    langName: "Simplified Chinese (简体中文)",
  });
  assert.ok(system.includes("Simplified Chinese"));
  assert.ok(system.includes("bold lead-in"));
  assert.ok(system.includes("Never use markdown headings"));
  assert.ok(user.includes("<reading-context>"));
  assert.ok(user.includes("1. Transformer — A neural architecture."));
  assert.ok(user.includes("Explain the term: KV cache"));
});

test("buildExplainMessages omits empty blocks", async () => {
  const { buildExplainMessages } = await loadSubject();
  const { user } = buildExplainMessages({ term: "entropy", depth: "brief", langName: "English" });
  assert.ok(!user.includes("<reading-context>"));
  assert.ok(!user.includes("<research-path>"));
  assert.equal(user, "Explain the term: entropy");
});

test("buildAncestorsForNode walks from parent to root", async () => {
  const { buildAncestorsForNode } = await loadSubject();
  const nodes = [
    { id: "a", parentId: null, term: "A", explanation: "root exp", status: "done" },
    { id: "b", parentId: "a", term: "B", explanation: "mid exp", status: "done" },
    { id: "c", parentId: "b", term: "C", explanation: "leaf", status: "done" },
  ];
  // The argument is the asking node's parentId; the chain includes the parent.
  const chain = buildAncestorsForNode(nodes, "b");
  assert.deepEqual(chain.map((n) => n.term), ["A", "B"]);
  const root = buildAncestorsForNode(nodes, null);
  assert.deepEqual(root, []);
});

test("findExistingNode matches term, parent and depth case-insensitively", async () => {
  const { findExistingNode } = await loadSubject();
  const nodes = [{ id: "n1", parentId: null, term: " KV Cache ", depth: "standard", status: "done" }];
  assert.equal(findExistingNode(nodes, "kv cache", null, "standard")?.id, "n1");
  assert.equal(findExistingNode(nodes, "kv cache", null, "deep"), undefined);
  assert.equal(findExistingNode(nodes, "kv cache", "n1", "standard"), undefined);
  const loading = [{ id: "n2", parentId: null, term: "x", depth: "standard", status: "loading" }];
  assert.equal(findExistingNode(loading, "x", null, "standard"), undefined);
});

test("buildFollowupMessages embeds the parent explanation and question", async () => {
  const { buildFollowupMessages } = await loadSubject();
  const { system, user } = buildFollowupMessages({
    term: "KV cache",
    explanation: "A KV cache stores attention keys and values.".repeat(50),
    question: "为什么缓存会随序列长度线性增长？",
    ancestors: [{ term: "Transformer", summary: "A neural architecture." }],
    depth: "standard",
    langName: "Simplified Chinese (简体中文)",
  });
  assert.ok(system.includes("follow-up"));
  assert.ok(system.includes("Simplified Chinese"));
  assert.ok(user.includes("<term-explanation term=\"KV cache\">"));
  assert.ok(user.includes("Reader's follow-up question: 为什么缓存会随序列长度线性增长？"));
  assert.ok(user.includes("1. Transformer — A neural architecture."));
  // explanation clipped to the cap
  assert.ok(user.length < 6000);
});

test("buildChainMarkdown includes follow-up questions under their term", async () => {
  const { buildChainMarkdown } = await loadSubject();
  const nodes = [
    {
      id: "a", parentId: null, term: "A", explanation: "exp a", status: "done", createdAt: 1,
      followups: [{ id: "f1", question: "Why?", answer: "Because.", status: "done" }],
    },
  ];
  const md = buildChainMarkdown(nodes, new Date(0));
  assert.ok(md.includes("## A"));
  assert.ok(md.includes("**Q: Why?**"));
  assert.ok(md.includes("Because."));
});

test("buildWebContextBlock formats results for prompts", async () => {
  const { buildWebContextBlock } = await loadSubject();
  const block = buildWebContextBlock("nginx", [
    { title: "nginx", url: "https://nginx.org/", snippet: "High performance web server." },
    { title: "Empty snippet is fine", url: "https://example.com/", snippet: "" },
  ]);
  assert.ok(block.includes('<web-search-results query="nginx">'));
  assert.ok(block.includes("1. nginx — High performance web server."));
  assert.ok(block.includes("https://example.com/"));
  assert.equal(buildWebContextBlock("x", []), "");
});

test("buildChainFreeMind escapes XML and nests summaries and follow-ups", async () => {
  const { buildChainFreeMind } = await loadSubject();
  const nodes = [
    {
      id: "a", parentId: null, term: 'A & <B>', explanation: "Root **exp** line.", status: "done", createdAt: 1,
      followups: [{ id: "f1", question: "Why?", answer: "Because.", status: "done" }],
    },
    { id: "b", parentId: "a", term: "B", explanation: "Child exp with a very long line that will be summarized into the node text.", status: "done", createdAt: 2 },
  ];
  const xml = buildChainFreeMind(nodes, new Date(0));
  assert.ok(xml.includes('<map version="1.0.1">'));
  assert.ok(xml.includes('TEXT="A &amp; &lt;B&gt;"'));
  assert.ok(xml.includes("Q: Why?"));
  const childIdx = xml.indexOf("Child exp");
  const rootIdx = xml.indexOf("A &amp;");
  assert.ok(rootIdx !== -1 && childIdx > rootIdx);
});

test("buildChainHtmlMindmap produces a self-contained interactive page", async () => {
  const { buildChainHtmlMindmap } = await loadSubject();
  const nodes = [
    {
      id: "a", parentId: null, term: "A & B", explanation: "Root exp.", status: "done", createdAt: 1,
      followups: [{ id: "f1", question: "Why?", answer: "Because.", status: "done" }],
    },
    { id: "b", parentId: "a", term: "B", explanation: "Child exp.", status: "done", createdAt: 2 },
  ];
  const html = buildChainHtmlMindmap(nodes, new Date(0));
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('<span class="node term">A &amp; B</span>'));
  assert.ok(html.includes('<span class="node q">Q: Why?</span>'));
  assert.ok(html.includes('id="mm-data"'));
  // the embedded FreeMind XML must not break out of its script tag
  assert.ok(!html.includes("</scr" + "ipt></map>"));
  assert.ok(html.includes("collapse-all"));
});

test("markdownToBasicHtml converts the prompt-governed shapes", async () => {
  const { markdownToBasicHtml } = await loadSubject();
  const html = markdownToBasicHtml("**nginx**: a web server.\n\n- point one with `code`\n- point two\n\nClosing line.");
  assert.ok(html.includes("<p><strong>nginx</strong>: a web server.</p>"));
  assert.ok(html.includes("<ul><li>point one with <code>code</code></li><li>point two</li></ul>"));
  assert.ok(html.includes("<p>Closing line.</p>"));
  assert.ok(!html.includes("**"));
});

test("buildAnkiCsv emits directives, escaping and tags", async () => {
  const { buildAnkiCsv } = await loadSubject();
  const nodes = [
    {
      id: "a", parentId: null, term: "A", explanation: "**A** explanation.", status: "done", createdAt: 1,
      followups: [{ id: "f1", question: "Why <now>?", answer: "Because.", status: "done" }],
    },
    { id: "b", parentId: "a", term: "B", explanation: "Child exp.", status: "done", createdAt: 2 },
    { id: "c", parentId: null, term: "Loading", explanation: "", status: "loading", createdAt: 3 },
  ];
  const csv = buildAnkiCsv(nodes);
  assert.ok(csv.startsWith("\uFEFF#separator:Comma"));
  assert.ok(csv.includes("#html:true"));
  assert.ok(csv.includes('"A","<div><p><strong>A</strong> explanation.</p></div><hr><div><strong>Q: Why &lt;now&gt;?</strong></div><div><p>Because.</p></div>"'));
  assert.ok(csv.includes("research-lens A"));
  // loading nodes are skipped; child B tags to its chain root A
  assert.ok(!csv.includes("Loading"));
  assert.ok(csv.includes('"B","'));
  assert.ok(csv.includes("research-lens A") || csv.includes("research-lens B") === false);
  // quotes inside fields are doubled
  const nodesWithQuote = [{ id: "q", parentId: null, term: 'say "hi"', explanation: "x", status: "done", createdAt: 1 }];
  assert.ok(buildAnkiCsv(nodesWithQuote).includes('""hi""'));
});

test("buildChainMarkdown renders a forest with heading depth", async () => {
  const { buildChainMarkdown } = await loadSubject();
  const nodes = [
    { id: "a", parentId: null, term: "A", explanation: "exp a", status: "done", createdAt: 1 },
    { id: "b", parentId: "a", term: "B", explanation: "exp b", status: "done", createdAt: 2 },
    { id: "c", parentId: "missing-parent", term: "C", explanation: "exp c", status: "done", createdAt: 3 },
  ];
  const md = buildChainMarkdown(nodes, new Date(0));
  assert.ok(md.startsWith("# Concept chain"));
  assert.ok(md.includes("## A"));
  assert.ok(md.includes("### B"));
  assert.ok(md.includes("## C"));
  assert.ok(md.includes("exp a"));
  // Heading level caps at h6
  const deep = [];
  let parent = null;
  for (let i = 0; i < 9; i++) {
    const id = `n${i}`;
    deep.push({ id, parentId: parent, term: `T${i}`, explanation: `e${i}`, status: "done", createdAt: i });
    parent = id;
  }
  const deepMd = buildChainMarkdown(deep, new Date(0));
  assert.ok(deepMd.includes("###### T5"));
  assert.ok(deepMd.includes("###### T8"));
});
