import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { prepareSvgForZoomPan } = await jiti.import("./ZoomPanViewer.tsx");

// Realistic mermaid v11 output: viewBox + width="100%" + max-width style,
// with <br> inside a foreignObject label (XML-invalid, HTML-valid).
const MERMAID_SVG = `<svg id="mermaid-x" width="100%" xmlns="http://www.w3.org/2000/svg" class="flowchart" style="max-width: 1027.65625px;" viewBox="0 0 1027.65625 350" role="graphics-document document"><style>.node rect{fill:#1f2020;}</style><g class="root"><g class="node"><g class="label"><foreignObject width="82"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel"><p>需求收集<br>访谈 + 问卷</p></span></div></foreignObject></g></g></g></svg>`;

test("regex fallback extracts viewBox size and strips fixed-size constraints", () => {
  const r = prepareSvgForZoomPan(MERMAID_SVG);

  assert.equal(r.width, 1027.65625);
  assert.equal(r.height, 350);
  assert.doesNotMatch(r.html, /max-width/);
  assert.doesNotMatch(r.html, /width="100%"/);
  assert.match(r.html, /viewBox="0 0 1027\.65625 350"/);
});

test("bare <br> is normalized to <br/> so the SVG is well-formed XML", () => {
  const r = prepareSvgForZoomPan(MERMAID_SVG);

  assert.doesNotMatch(r.html, /<br(?![\s/])/i);
  assert.match(r.html, /需求收集<br\/>访谈/);
});

test("regex fallback reads width/height attributes when viewBox is missing", () => {
  const svg = `<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>`;
  const r = prepareSvgForZoomPan(svg);

  assert.equal(r.width, 640);
  assert.equal(r.height, 480);
});

test("regex fallback returns 800x600 when no size info exists", () => {
  const r = prepareSvgForZoomPan("<svg></svg>");

  assert.equal(r.width, 800);
  assert.equal(r.height, 600);
});

test("DOMParser path parses with text/html (tolerates <br>) and cleans the svg", () => {
  class FakeEl {
    constructor(attrs) {
      this.attrs = { ...attrs };
      this.style = { maxWidth: attrs._styleMaxWidth ?? "" };
      delete this.attrs._styleMaxWidth;
    }
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null;
    }
    setAttribute(name, value) {
      this.attrs[name] = value;
    }
    removeAttribute(name) {
      delete this.attrs[name];
    }
    get outerHTML() {
      const attrs = Object.entries(this.attrs)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join("");
      const style = this.style.maxWidth ? ` style="max-width:${this.style.maxWidth}"` : "";
      return `<svg${attrs}${style}></svg>`;
    }
  }
  class FakeDOMParser {
    static lastMime = null;
    parseFromString(str, mime) {
      FakeDOMParser.lastMime = mime;
      const match = /<svg\s+([^>]*)>/.exec(str);
      if (!match) return { querySelector: () => null };
      const attrs = {};
      for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
        attrs[attr[1]] = attr[2];
      }
      const styleAttr = attrs.style ?? "";
      delete attrs.style;
      const maxWidth = /max-width:\s*([^;]+)/.exec(styleAttr);
      if (maxWidth) attrs._styleMaxWidth = maxWidth[1];
      return { querySelector: () => new FakeEl(attrs) };
    }
  }

  const prev = globalThis.DOMParser;
  globalThis.DOMParser = FakeDOMParser;
  try {
    const r = prepareSvgForZoomPan(MERMAID_SVG);

    // The whole point: HTML parsing mode, not strict XML.
    assert.equal(FakeDOMParser.lastMime, "text/html");
    assert.equal(r.width, 1027.65625);
    assert.equal(r.height, 350);
    assert.doesNotMatch(r.html, /width="100%"/);
    // The original max-width cap is gone ("none" is the browser-serialized form).
    assert.doesNotMatch(r.html, /max-width:\s*1027/);
    assert.match(r.html, /viewBox="0 0 1027\.65625 350"/);
  } finally {
    globalThis.DOMParser = prev;
  }
});

test("DOMParser path falls back to regex when no svg element is found", () => {
  class EmptyDOMParser {
    parseFromString() {
      return { querySelector: () => null };
    }
  }

  const prev = globalThis.DOMParser;
  globalThis.DOMParser = EmptyDOMParser;
  try {
    const r = prepareSvgForZoomPan(MERMAID_SVG);
    assert.equal(r.width, 1027.65625);
    assert.equal(r.height, 350);
  } finally {
    globalThis.DOMParser = prev;
  }
});
