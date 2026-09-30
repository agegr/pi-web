import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeDisplayMath, splitAutolinkLiteralsAtCjkPunctuation } from "./markdown.ts";

describe("normalizeDisplayMath", () => {
  describe("single-line $$…$$", () => {
    it("splits a single-line block into three lines", () => {
      assert.equal(normalizeDisplayMath("$$a + b$$"), "$$\na + b\n$$");
    });

    it("preserves the indent of the surrounding list item", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  $$a + b$$\n- next"),
        "- item:\n  $$\n  a + b\n  $$\n- next",
      );
    });
  });

  describe("multi-line blocks with glued delimiters", () => {
    it("moves a glued opening delimiter to its own line", () => {
      const input = "$$\n\\frac{a}{b} = c\n<d$$\n\nafter";
      assert.equal(normalizeDisplayMath(input), "$$\n\\frac{a}{b} = c\n<d\n$$\n\nafter");
    });

    it("moves a glued closing delimiter to its own line", () => {
      const input = "$$\nx = y\nz = w$$\n\nafter";
      assert.equal(normalizeDisplayMath(input), "$$\nx = y\nz = w\n$$\n\nafter");
    });
  });

  describe("blocks nested in GFM list items", () => {
    it("re-indents lazy content lines of an indented bare-fence block", () => {
      const input = "- item:\n  $$\nx = y\n  $$\n- next";
      assert.equal(normalizeDisplayMath(input), "- item:\n  $$\n  x = y\n  $$\n- next");
    });

    it("re-indents partially indented content lines", () => {
      const input = "- item:\n  $$\n x = y\n  $$\n- next";
      assert.equal(normalizeDisplayMath(input), "- item:\n  $$\n  x = y\n  $$\n- next");
    });

    it("does not use a sibling list item's formula as a closing fence", () => {
      const input = "- first\n  $$x = y\n- second\n  $$z = w$$\n- third";
      assert.equal(
        normalizeDisplayMath(input),
        "- first\n  $$x = y\n- second\n  $$\n  z = w\n  $$\n- third",
      );
    });

    it("does not scan a bare fence past a sibling list item", () => {
      const input = "- first\n  $$\nx = y\n- second\n  $$z = w$$\n- third";
      assert.equal(
        normalizeDisplayMath(input),
        "- first\n  $$\nx = y\n- second\n  $$\n  z = w\n  $$\n- third",
      );
    });
  });

  describe("blocks that must stay untouched", () => {
    it("leaves a top-level block with detached delimiters untouched", () => {
      const input = "$$\n\\frac{a}{b}\n$$\n\nend";
      assert.equal(normalizeDisplayMath(input), input);
    });

    it("leaves content inside fenced code blocks untouched", () => {
      const input = "```\n$$ not math $$\n$$\n```\n\nreal $$x = 1$$ end";
      const normalized = normalizeDisplayMath(input);
      assert.ok(normalized.includes("```\n$$ not math $$\n$$\n```"));
      // every `$$` is preserved: 3 inside the fence + 2 in inline math
      assert.equal(normalized.match(/\$\$/g)?.length, 5);
    });

    it("leaves inline math and plain prose untouched", () => {
      const input = "text $x = 1$ and $$a + b$$ more";
      assert.equal(normalizeDisplayMath(input), input);
    });

    it("does not treat a glued opener with mid-line $$ as a block", () => {
      const input = "$$x$$ and text";
      assert.equal(normalizeDisplayMath(input), input);
    });
  });

  describe("\\[ … \\] blocks", () => {
    it("normalizes single-line brackets", () => {
      assert.equal(normalizeDisplayMath("\\[a + b\\]"), "$$\na + b\n$$");
    });

    it("keeps content indented when nested in a list item", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  \\[a + b\\]\n- next"),
        "- item:\n  $$\n  a + b\n  $$\n- next",
      );
    });

    it("normalizes multi-line brackets without double-indenting", () => {
      assert.equal(
        normalizeDisplayMath("- item:\n  \\[\n  x = y\n  \\]\n- next"),
        "- item:\n  $$\n  x = y\n  $$\n- next",
      );
    });
  });

  describe("loose [ … ] formula blocks", () => {
    it("normalizes model-emitted bracket-only formula lines", () => {
      assert.equal(
        normalizeDisplayMath("[ C(x) = \\frac{2}{T(T-1)} \\sum_{i<j} S(\\hat{y}^{(i)}, \\hat{y}^{(j)}) ]"),
        "$$\nC(x) = \\frac{2}{T(T-1)} \\sum_{i<j} S(\\hat{y}^{(i)}, \\hat{y}^{(j)})\n$$",
      );
    });

    it("leaves ambiguous bracket-only Markdown untouched", () => {
      for (const input of [
        "[普通说明文字]",
        "[See note (important)]",
        "[status=ready]",
        "[yes/no]",
        "[API_v2]\n\n[API_v2]: https://example.com/docs",
        "[C:\\Users\\alex]",
        "[\\\\server\\share]",
        "[https://example.com/\\alpha]",
      ]) {
        assert.equal(normalizeDisplayMath(input), input);
      }
    });
  });
});

describe("splitAutolinkLiteralsAtCjkPunctuation", () => {
  /** 构造一个 autolink literal：raw 源码就等于它的文字 */
  function autolink(text, url = text) {
    return {
      type: "link",
      url,
      title: null,
      children: [{ type: "text", value: text }],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1 + text.length, offset: text.length },
      },
    };
  }

  function treeWith(node) {
    return { type: "root", children: [{ type: "paragraph", children: [node] }] };
  }

  function run(source, node) {
    const tree = treeWith(node);
    splitAutolinkLiteralsAtCjkPunctuation(tree, source);
    return tree.children[0].children;
  }

  it("splits the literal at the first CJK punctuation and fixes the url", () => {
    const source = "https://a.com，见这里";
    const [link, text] = run(source, autolink(source));

    assert.equal(link.url, "https://a.com");
    assert.equal(link.children[0].value, "https://a.com");
    assert.equal(text.type, "text");
    assert.equal(text.value, "，见这里");
  });

  it("keeps the url prefix for www. and mailto: literals", () => {
    const www = run("www.example.com，后面", autolink("www.example.com，后面", "http://www.example.com，后面"));
    assert.equal(www[0].url, "http://www.example.com");
    assert.equal(www[1].value, "，后面");

    const mail = run("me@example.com：说明", autolink("me@example.com：说明", "mailto:me@example.com：说明"));
    assert.equal(mail[0].url, "mailto:me@example.com");
    assert.equal(mail[1].value, "：说明");
  });

  it("strips a trailing CJK full stop", () => {
    const [link, text] = run("https://a.com/x。", autolink("https://a.com/x。"));
    assert.equal(link.url, "https://a.com/x");
    assert.equal(text.value, "。");
  });

  it("leaves genuine CJK paths alone (ideographs are not boundaries)", () => {
    const source = "https://zh.wikipedia.org/wiki/中文条目";
    const [link, ...rest] = run(source, autolink(source));

    assert.equal(link.url, source);
    assert.equal(link.children[0].value, source);
    assert.equal(rest.length, 0);
  });

  it("leaves query strings and ASCII punctuation handling untouched", () => {
    for (const source of [
      "https://a.com/p?a=1&b=2",
      "https://a.com/a%20b?q=x+y",
      "https://a.com/~user/",
    ]) {
      const [link, ...rest] = run(source, autolink(source));
      assert.equal(link.url, source);
      assert.equal(rest.length, 0);
    }
  });

  it("does not touch an explicit [text](url) link whose text equals its url", () => {
    const url = "https://a.com，见这里";
    const node = autolink(url);
    // 显式链接的 raw 源码是 [text](url)，不是 text 本身
    node.position.end = { line: 1, column: 1 + url.length + 2 + 2, offset: url.length + 4 };
    const [link, ...rest] = run(`[${url}](${url})`, node);

    assert.equal(link.url, url);
    assert.equal(link.children[0].value, url);
    assert.equal(rest.length, 0);
  });

  it("ignores a literal that starts with punctuation, and one with no position", () => {
    const leading = run("，后面", autolink("，后面"));
    assert.equal(leading.length, 1);
    assert.equal(leading[0].url, "，后面");

    const bare = autolink("https://a.com，后面");
    delete bare.position;
    const noPosition = run("https://a.com，后面", bare);
    assert.equal(noPosition.length, 1);
  });

  it("splits links nested inside other blocks", () => {
    const source = "https://a.com，后面";
    const tree = {
      type: "root",
      children: [
        {
          type: "listItem",
          children: [{ type: "paragraph", children: [autolink(source)] }],
        },
      ],
    };
    splitAutolinkLiteralsAtCjkPunctuation(tree, source);

    const paragraph = tree.children[0].children[0];
    assert.equal(paragraph.children[0].url, "https://a.com");
    assert.equal(paragraph.children[1].value, "，后面");
  });
});
