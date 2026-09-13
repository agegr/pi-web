import { Schema, type Node as DocumentNode, type NodeSpec, type Mark } from "prosemirror-model";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import type { Root } from "mdast";
import { diffIndices } from "node-diff3";

const blockAttrs = { leading: { default: "\n\n" } };
const block = (tag: string, content: string): NodeSpec => ({
  group: "block", content, attrs: blockAttrs,
  parseDOM: [{ tag }], toDOM: () => [tag, 0],
});

export const markdownSchema = new Schema({
  nodes: {
    doc: { content: "block+", attrs: { trailing: { default: "\n" } } },
    paragraph: block("p", "inline*"),
    heading: {
      ...block("h1", "inline*"), defining: true,
      attrs: { ...blockAttrs, level: { default: 1 } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    blockquote: { ...block("blockquote", "block+"), defining: true },
    bullet_list: block("ul", "list_item+"),
    ordered_list: {
      ...block("ol", "list_item+"), attrs: { ...blockAttrs, order: { default: 1 } },
      parseDOM: [{ tag: "ol", getAttrs: (dom) => ({ order: Number(dom.getAttribute("start") || 1) }) }],
      toDOM: (node) => ["ol", { start: node.attrs.order === 1 ? null : node.attrs.order }, 0],
    },
    list_item: { ...block("li", "paragraph block*"), defining: true },
    horizontal_rule: { group: "block", attrs: blockAttrs, parseDOM: [{ tag: "hr" }], toDOM: () => ["hr"] },
    // Complex syntax remains Markdown text, displayed by the existing renderer.
    // It can be edited in place without converting it through a reduced schema.
    raw_block: {
      group: "block", content: "text*", marks: "", code: true, defining: true, isolating: true,
      attrs: blockAttrs, toDOM: () => ["pre", { "data-markdown-raw": "true" }, ["code", 0]],
      parseDOM: [{ tag: "pre[data-markdown-raw]", preserveWhitespace: "full" }],
    },
    text: { group: "inline" },
    image: {
      inline: true, group: "inline", draggable: true,
      attrs: { src: {}, alt: { default: "" }, title: { default: null } },
      parseDOM: [{ tag: "img[src]", getAttrs: (dom) => ({ src: dom.getAttribute("src"), alt: dom.getAttribute("alt"), title: dom.getAttribute("title") }) }],
      toDOM: (node) => ["img", node.attrs],
    },
    hard_break: { inline: true, group: "inline", selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
  },
  marks: {
    strong: { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
    strike: { parseDOM: [{ tag: "del" }, { tag: "s" }], toDOM: () => ["del", 0] },
    code: { code: true, excludes: "_", parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    link: {
      attrs: { href: {}, title: { default: null } }, inclusive: false,
      parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: dom.getAttribute("href"), title: dom.getAttribute("title") }) }],
      toDOM: (mark) => ["a", { href: safeUrl(mark.attrs.href), title: mark.attrs.title }, 0],
    },
  },
});

export function safeUrl(url: string): string {
  return /^(?:javascript|vbscript|data):/i.test(url.replace(/[\s\u0000-\u001f]/g, "")) ? "" : url;
}

interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  url?: string;
  title?: string | null;
  alt?: string | null;
  position?: { start: { offset?: number; line?: number }; end: { offset?: number; line?: number } };
}

const processor = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm, { singleTilde: false }).use(remarkMath).use(remarkStringify);
const supported = new Set(["paragraph", "heading", "blockquote", "list", "listItem", "thematicBreak", "text", "strong", "emphasis", "delete", "inlineCode", "link", "image", "break"]);
function canEdit(node: MdNode): boolean {
  return supported.has(node.type) && node.checked == null && (node.children?.every(canEdit) ?? true);
}

/** Maps a ProseMirror top-level block range back to the current Markdown source.
 * Rich-text inline marks do not share character offsets with Markdown markers,
 * so the top-level block is the smallest stable source range while editing. */
export function markdownBlockLineRange(
  source: string,
  startBlock: number,
  endBlock: number,
): { startLine: number; endLine: number } | null {
  const children = ((processor.parse(source) as unknown as MdNode).children ?? []);
  const first = children[Math.max(0, startBlock)];
  const last = children[Math.max(0, Math.min(endBlock, children.length - 1))];
  const startLine = first?.position?.start.line;
  const endLine = last?.position?.end.line;
  return typeof startLine === "number" && typeof endLine === "number"
    && Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0 && endLine >= startLine
    ? { startLine, endLine }
    : null;
}

function fromMarkdown(node: MdNode, marks: readonly Mark[] = []): DocumentNode[] {
  const schema = markdownSchema;
  if (node.type === "text") return node.value ? [schema.text(node.value.replace(/\r?\n/g, " "), marks)] : [];
  if (node.type === "inlineCode") return node.value ? [schema.text(node.value, [...marks, schema.marks.code.create()])] : [];
  const markName = { strong: "strong", emphasis: "em", delete: "strike", link: "link" }[node.type];
  if (markName) {
    const mark = schema.marks[markName].create(node.type === "link" ? { href: node.url, title: node.title } : undefined);
    return (node.children ?? []).flatMap((child) => fromMarkdown(child, [...marks, mark]));
  }
  if (node.type === "image") return [schema.nodes.image.create({ src: node.url, alt: node.alt, title: node.title }, null, marks)];
  if (node.type === "break") return [schema.nodes.hard_break.create(null, null, marks)];
  const name = { paragraph: "paragraph", heading: "heading", blockquote: "blockquote", listItem: "list_item", thematicBreak: "horizontal_rule" }[node.type]
    ?? (node.ordered ? "ordered_list" : "bullet_list");
  return [schema.nodes[name].create({ level: node.depth, order: node.start ?? 1 }, (node.children ?? []).flatMap((child) => fromMarkdown(child)))];
}

function toMarkdown(node: DocumentNode): MdNode {
  const children: MdNode[] = [];
  node.forEach((child) => children.push(toMarkdown(child)));
  let result: MdNode;
  switch (node.type.name) {
    case "text": result = { type: "text", value: node.text }; break;
    case "paragraph": result = { type: "paragraph", children }; break;
    case "heading": result = { type: "heading", depth: node.attrs.level, children }; break;
    case "blockquote": result = { type: "blockquote", children }; break;
    case "bullet_list": case "ordered_list":
      result = { type: "list", ordered: node.type.name === "ordered_list", start: node.attrs.order ?? null, children }; break;
    case "list_item": result = { type: "listItem", children }; break;
    case "horizontal_rule": result = { type: "thematicBreak" }; break;
    case "image": result = { type: "image", url: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }; break;
    case "hard_break": result = { type: "break" }; break;
    default: throw new Error(`Unsupported Markdown node: ${node.type.name}`);
  }
  for (const mark of [...node.marks].reverse()) {
    if (mark.type.name === "code") result = { type: "inlineCode", value: node.text ?? "" };
    else if (mark.type.name === "link") result = { type: "link", url: mark.attrs.href, title: mark.attrs.title, children: [result] };
    else result = { type: ({ strong: "strong", em: "emphasis", strike: "delete" } as Record<string, string>)[mark.type.name], children: [result] };
  }
  return result;
}

/** Preserve untouched top-level blocks byte-for-byte, including syntax the
 * rich text schema does not understand. Only edited basic blocks are serialized. */
export class MarkdownCodec {
  private originals = new WeakMap<DocumentNode, string>();
  private newline = "\n";

  parse(source: string): DocumentNode {
    this.newline = source.includes("\r\n") ? "\r\n" : "\n";
    const ast = processor.parse(source) as unknown as MdNode;
    let offset = 0;
    const children = (ast.children ?? []).map((child) => {
      const start = child.position!.start.offset!;
      const end = child.position!.end.offset!;
      const raw = source.slice(start, end);
      const leading = source.slice(offset, start);
      const parsed = canEdit(child) ? fromMarkdown(child)[0]
        : markdownSchema.nodes.raw_block.create(null, raw ? markdownSchema.text(raw.replace(/\r\n/g, "\n")) : null);
      const node = parsed.type.create({ ...parsed.attrs, leading }, parsed.content, parsed.marks);
      this.originals.set(node, raw);
      offset = end;
      return node;
    });
    const doc = markdownSchema.nodes.doc.create({ trailing: source.slice(offset) }, children.length ? children : [markdownSchema.nodes.paragraph.create({ leading: "" })]);
    this.originals.set(doc, source);
    return doc;
  }

  serialize(doc: DocumentNode): string {
    const original = this.originals.get(doc);
    if (original !== undefined) return original;
    const blocks: string[] = [];
    doc.forEach((node, _offset, index) => {
      const raw = this.originals.get(node) ?? (node.type.name === "raw_block" ? node.textContent
        : processor.stringify({ type: "root", children: [toMarkdown(node)] } as unknown as Root).replace(/\n$/, "")).replace(/\r?\n/g, this.newline);
      const leading = index === 0 ? node.attrs.leading.replace(/[^\uFEFF\s]/g, "")
        : node.attrs.leading || `${this.newline}${this.newline}`;
      blocks.push(leading + raw);
    });
    return blocks.join("") + doc.attrs.trailing;
  }

  // A minimal editor transaction may reuse old nodes. Transfer incoming source
  // provenance to those nodes, even when only Markdown marker spelling changed.
  adopt(current: DocumentNode, parsed: DocumentNode) {
    if (!current.eq(parsed)) return;
    const raw = this.originals.get(parsed);
    if (raw !== undefined) this.originals.set(current, raw);
    current.forEach((child, _offset, index) => {
      const raw = this.originals.get(parsed.child(index));
      if (raw !== undefined) this.originals.set(child, raw);
    });
  }
}

/** Produce disjoint changes, so two remote edits surrounding the cursor do not
 * replace the untouched paragraph between them. Positions are in the old doc. */
export function markdownChanges(old: DocumentNode, next: DocumentNode) {
  const changes: { from: number; to: number; start: number; end: number }[] = [];
  const children = (node: DocumentNode) => { const result: DocumentNode[] = []; node.forEach((child) => result.push(child)); return result; };
  const offsets = (nodes: DocumentNode[], from: number) => {
    const result = [from];
    for (const node of nodes) result.push(result[result.length - 1] + node.nodeSize);
    return result;
  };
  const inlineTokens = (node: DocumentNode) => children(node).flatMap((child) => child.isText
    ? child.text!.split("").map((char) => JSON.stringify([char, child.marks.map((mark) => mark.toJSON())]))
    : [JSON.stringify(child.toJSON())]);
  const walk = (a: DocumentNode, b: DocumentNode, aPos: number, bPos: number) => {
    if (a.eq(b)) return;
    if (!a.isTextblock || !b.isTextblock || !a.sameMarkup(b)) {
      if (a.type !== a.type.schema.topNodeType && (!a.sameMarkup(b) || a.isLeaf || b.isLeaf)) {
        changes.push({ from: aPos, to: aPos + a.nodeSize, start: bPos, end: bPos + b.nodeSize });
        return;
      }
      const aa = children(a), bb = children(b);
      const ap = offsets(aa, aPos + 1), bp = offsets(bb, bPos + 1);
      for (const diff of diffIndices(aa.map((node) => JSON.stringify(node.toJSON())), bb.map((node) => JSON.stringify(node.toJSON())))) {
        const [ai, al] = diff.buffer1, [bi, bl] = diff.buffer2;
        if (al === bl) for (let i = 0; i < al; i++) walk(aa[ai + i], bb[bi + i], ap[ai + i], bp[bi + i]);
        else changes.push({ from: ap[ai], to: ap[ai + al], start: bp[bi], end: bp[bi + bl] });
      }
    } else {
      for (const diff of diffIndices(inlineTokens(a), inlineTokens(b))) {
        const [ai, al] = diff.buffer1, [bi, bl] = diff.buffer2;
        changes.push({ from: aPos + 1 + ai, to: aPos + 1 + ai + al, start: bPos + 1 + bi, end: bPos + 1 + bi + bl });
      }
    }
  };
  walk(old, next, -1, -1);
  return changes.sort((a, b) => b.from - a.from);
}
