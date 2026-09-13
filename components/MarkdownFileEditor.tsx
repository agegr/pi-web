"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView, type NodeView } from "prosemirror-view";
import { baseKeymap, chainCommands, exitCode, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, undo, redo, closeHistory } from "prosemirror-history";
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { MarkdownCodec, markdownSchema, markdownBlockLineRange, markdownChanges, safeUrl } from "@/lib/markdown-editor";
import { getFileDirectory, getFileName, encodeFilePathForApi } from "@/lib/file-paths";
import { resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { useMarkdownFile } from "@/hooks/useMarkdownFile";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownFilePreview, type MarkdownFileContext } from "./MarkdownFilePreview";
import { clearLocationTextHighlight, LOCATION_HIGHLIGHT_CLASS, setLocationTextHighlight } from "@/lib/location-highlight";
import "./markdown-editor.css";

export interface MarkdownEditorSelection {
  text: string;
  startLine: number;
  endLine: number;
  top: number;
  left: number;
}

export interface MarkdownEditorLocationTarget {
  text: string;
  startLine?: number;
  endLine?: number;
}

export interface MarkdownEditorLocationApi {
  revealLocation: (target: MarkdownEditorLocationTarget) => HTMLElement[];
  clearLocation: () => void;
}

interface Props extends MarkdownFileContext {
  content: string;
  watchEnabled?: boolean;
  onSelectionChange?: (selection: MarkdownEditorSelection | null) => void;
  onLocationReady?: (api: MarkdownEditorLocationApi | null) => void;
}
interface PreviewBlock { id: number; target: HTMLElement; content: string }

const locationHighlightKey = new PluginKey<DecorationSet>("markdown-location-highlight");

interface LocationDecorationRange {
  from: number;
  to: number;
}

interface LocationTextPoint {
  node: Text;
  offset: number;
}

function normalizeLocationText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function findLocationTextRangeInRoots(roots: readonly Node[], text: string): Range | null {
  const target = normalizeLocationText(text);
  if (!target) return null;

  const points: LocationTextPoint[] = [];
  let normalized = "";
  let hasContent = false;
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest("[hidden]")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes: Text[] = [];
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (node.nodeValue) textNodes.push(node);
      node = walker.nextNode() as Text | null;
    }
    if (textNodes.length === 0) continue;

    if (hasContent && normalized && normalized.at(-1) !== " ") {
      normalized += " ";
      points.push({ node: textNodes[0], offset: 0 });
    }
    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? "";
      for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset];
        if (/\s/.test(character)) {
          if (normalized && normalized.at(-1) !== " ") {
            normalized += " ";
            points.push({ node: textNode, offset });
          }
        } else {
          normalized += character;
          points.push({ node: textNode, offset });
        }
      }
    }
    hasContent = true;
  }

  const match = normalized.indexOf(target);
  if (match < 0) return null;
  const start = points[match];
  const end = points[match + target.length - 1];
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

function scrollLocationRangeIntoView(scroller: HTMLElement, range: Range) {
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return false;

  const scrollerRect = scroller.getBoundingClientRect();
  const padding = Math.min(48, Math.max(16, scroller.clientHeight * 0.2));
  const visibleTop = scrollerRect.top + padding;
  const visibleBottom = scrollerRect.bottom - padding;
  if (rect.top >= visibleTop && rect.bottom <= visibleBottom) return true;

  scroller.scrollBy({
    top: (rect.top + rect.bottom) / 2 - (scrollerRect.top + scrollerRect.bottom) / 2,
    behavior: "auto",
  });
  return true;
}

function scrollLocationElementIntoView(scroller: HTMLElement, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return false;

  const scrollerRect = scroller.getBoundingClientRect();
  const padding = Math.min(48, Math.max(16, scroller.clientHeight * 0.2));
  const visibleTop = scrollerRect.top + padding;
  const visibleBottom = scrollerRect.bottom - padding;
  if (rect.top >= visibleTop && rect.bottom <= visibleBottom) return true;

  scroller.scrollBy({
    top: (rect.top + rect.bottom) / 2 - (scrollerRect.top + scrollerRect.bottom) / 2,
    behavior: "auto",
  });
  return true;
}

const locationHighlightPlugin = new Plugin<DecorationSet>({
  key: locationHighlightKey,
  state: {
    init: () => DecorationSet.empty,
    apply(transaction, decorations) {
      const ranges = transaction.getMeta(locationHighlightKey) as LocationDecorationRange[] | null | undefined;
      if (ranges !== undefined) {
        return ranges === null
          ? DecorationSet.empty
          : DecorationSet.create(transaction.doc, ranges.map(({ from, to }) =>
            Decoration.node(from, to, { class: LOCATION_HIGHLIGHT_CLASS }),
          ));
      }
      return transaction.docChanged ? DecorationSet.empty : decorations.map(transaction.mapping, transaction.doc);
    },
  },
  props: {
    decorations(state) {
      return locationHighlightKey.getState(state) ?? DecorationSet.empty;
    },
  },
});

function clearLocationHighlight(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(locationHighlightKey, null));
  clearLocationTextHighlight();
}

export default function MarkdownFileEditor({ content, watchEnabled = true, ...context }: Props) {
  const { t } = useI18n();
  const { sync, state } = useMarkdownFile(context.filePath, content, context.sourceSessionId, watchEnabled);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const codec = useRef(new MarkdownCodec());
  const contextRef = useRef(context);
  contextRef.current = context;
  const onSelectionChangeRef = useRef<Props["onSelectionChange"]>(undefined);
  onSelectionChangeRef.current = context.onSelectionChange;
  const onLocationReadyRef = useRef<Props["onLocationReady"]>(undefined);
  onLocationReadyRef.current = context.onLocationReady;
  const [blocks, setBlocks] = useState<PreviewBlock[]>([]);

  useEffect(() => {
    if (!host.current || !sync) return;
    let disposed = false;
    let nextId = 0;
    const previews = new Map<number, PreviewBlock>();
    const rawSelections = new Set<() => void>();
    const notifyPreviews = () => queueMicrotask(() => { if (!disposed) setBlocks([...previews.values()]); });
    const notifySelection = () => {
      const selection = view.state.selection;
      if (selection.empty) {
        onSelectionChangeRef.current?.(null);
        return;
      }
      const source = codec.current.serialize(view.state.doc);
      const startBlock = selection.$from.index(0);
      const endBlock = Math.max(startBlock, selection.$to.index(0));
      const lines = markdownBlockLineRange(source, startBlock, endBlock);
      const text = view.state.doc.textBetween(selection.from, selection.to, "\n").trim();
      if (!lines || !text) {
        onSelectionChangeRef.current?.(null);
        return;
      }
      const start = view.coordsAtPos(selection.from);
      const end = view.coordsAtPos(selection.to);
      onSelectionChangeRef.current?.({
        ...lines,
        text,
        top: Math.min(window.innerHeight - 44, end.bottom + 8),
        left: Math.max(8, Math.min(window.innerWidth - 8, (start.left + end.right) / 2)),
      });
    };
    const updateSourceLineAttributes = (editorView: EditorView) => {
      const source = codec.current.serialize(editorView.state.doc);
      editorView.state.doc.forEach((_node, _offset, index) => {
        const element = editorView.dom.children[index];
        if (!(element instanceof HTMLElement)) return;
        const lines = markdownBlockLineRange(source, index, index);
        if (!lines) {
          delete element.dataset.sourceStartLine;
          delete element.dataset.sourceEndLine;
          return;
        }
        element.dataset.sourceStartLine = String(lines.startLine);
        element.dataset.sourceEndLine = String(lines.endLine);
      });
    };
    const nodes = markdownSchema.nodes;
    const markRule = (pattern: RegExp, name: string) => new InputRule(pattern, (state, match, start, end) =>
      state.tr.insertText(match[1], start, end).addMark(start, start + match[1].length, markdownSchema.marks[name].create()).removeStoredMark(markdownSchema.marks[name]));
    const view = new EditorView(host.current, {
      state: EditorState.create({
        doc: codec.current.parse(sync.state.content),
        plugins: [
          history(),
          inputRules({ rules: [
            textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (match) => ({ level: match[1].length })),
            wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
            wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list),
            wrappingInputRule(/^(\d+)\.\s$/, nodes.ordered_list, (match) => ({ order: Number(match[1]) })),
            markRule(/\*\*([^*]+)\*\*$/, "strong"),
            markRule(/__([^_]+)__$/, "strong"),
            markRule(/(?<!\*)\*([^*]+)\*$/, "em"),
            markRule(/~~([^~]+)~~$/, "strike"),
            markRule(/`([^`]+)`$/, "code"),
          ] }),
          keymap({
            "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo,
            "Mod-b": toggleMark(markdownSchema.marks.strong), "Mod-i": toggleMark(markdownSchema.marks.em),
            "Mod-s": () => { void sync.save(); return true; },
            "Mod-Enter": exitCode,
            Enter: chainCommands(splitListItem(nodes.list_item), baseKeymap.Enter),
            Tab: sinkListItem(nodes.list_item), "Shift-Tab": liftListItem(nodes.list_item),
            "Shift-Enter": (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(nodes.hard_break.create()).scrollIntoView()); return true; },
          }),
          keymap(baseKeymap),
          locationHighlightPlugin,
        ],
      }),
      attributes: { class: "markdown-body markdown-file-preview markdown-editable markdown-readable-column", role: "textbox", "aria-multiline": "true", "aria-label": getFileName(contextRef.current.filePath) },
      dispatchTransaction(transaction) {
        view.updateState(view.state.apply(transaction));
        if (transaction.docChanged) {
          clearLocationTextHighlight();
          updateSourceLineAttributes(view);
        }
        rawSelections.forEach((update) => update());
        notifySelection();
        if (transaction.docChanged && !transaction.getMeta("external")) sync.edit(codec.current.serialize(view.state.doc));
      },
      handleDOMEvents: {
        compositionstart: () => { sync.setComposing(true); return false; },
        compositionend: () => {
          // Let the editor's DOM observer commit the final IME characters first.
          setTimeout(() => { if (!disposed) sync.setComposing(false); }, 0);
          return false;
        },
        click: (_view, event) => {
          const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
          if (!link || !shouldOpenLocalFileInApp(event)) return false;
          const ctx = contextRef.current;
          const directory = getFileDirectory(ctx.filePath);
          const file = resolveLocalFileHref(link.getAttribute("href") ?? undefined, directory, ctx.cwd ?? directory);
          if (file && ctx.onOpenFile) { event.preventDefault(); ctx.onOpenFile(file); return true; }
          return false;
        },
      },
      nodeViews: {
        image(node) {
          const dom = document.createElement("img");
          const update = (next: typeof node) => {
            if (next.type !== nodes.image) return false;
            const ctx = contextRef.current;
            const directory = getFileDirectory(ctx.filePath);
            const file = resolveLocalFileHref(next.attrs.src, directory, ctx.cwd ?? directory);
            const query = ctx.sourceSessionId ? `&sessionId=${encodeURIComponent(ctx.sourceSessionId)}` : "";
            dom.src = file ? `/api/files/${encodeFilePathForApi(file)}?type=read${query}` : safeUrl(next.attrs.src);
            dom.alt = next.attrs.alt ?? "";
            if (next.attrs.title) dom.title = next.attrs.title;
            else dom.removeAttribute("title");
            return true;
          };
          update(node);
          return { dom, update };
        },
        raw_block(initialNode, editor, getPos): NodeView {
          let node = initialNode;
          const id = nextId++;
          const dom = document.createElement("div");
          dom.className = "markdown-complex-block";
          const preview = document.createElement("div");
          preview.contentEditable = "false";
          const pre = document.createElement("pre");
          pre.className = "markdown-complex-source";
          const contentDOM = document.createElement("code");
          pre.append(contentDOM);
          pre.hidden = true;
          dom.append(preview, pre);
          previews.set(id, { id, target: preview, content: node.textContent });
          notifyPreviews();
          const selectionChanged = () => {
            const active = editor.hasFocus() && editor.state.selection.$from.parent === node;
            pre.hidden = !active;
            preview.hidden = active;
          };
          rawSelections.add(selectionChanged);
          preview.addEventListener("dblclick", (event) => {
            if ((event.target as Element).closest("button,a,input")) return;
            const pos = getPos();
            if (pos === undefined) return;
            event.preventDefault();
            pre.hidden = false;
            preview.hidden = true;
            editor.focus();
            editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1)));
          });
          return {
            dom, contentDOM,
            update(next) {
              if (next.type !== nodes.raw_block) return false;
              if (next.textContent !== node.textContent) {
                previews.set(id, { id, target: preview, content: next.textContent });
                notifyPreviews();
              }
              node = next;
              return true;
            },
            stopEvent: (event) => preview.contains(event.target as Node),
            ignoreMutation: (mutation) => mutation.type !== "selection" && !contentDOM.contains(mutation.target),
            destroy() { previews.delete(id); rawSelections.delete(selectionChanged); notifyPreviews(); },
          };
        },
      },
    });
    viewRef.current = view;
    updateSourceLineAttributes(view);
    // ProseMirror can finish its first DOM flush after the EditorView
    // constructor returns. Refresh the block metadata on the next frame so
    // location requests never see an editor with unannotated blocks.
    const lineAttributeFrame = window.requestAnimationFrame(() => {
      if (!disposed) updateSourceLineAttributes(view);
    });
    let textHighlightFrame: number | null = null;
    const clearEditorLocation = () => {
      if (textHighlightFrame !== null) {
        window.cancelAnimationFrame(textHighlightFrame);
        textHighlightFrame = null;
      }
      clearLocationHighlight(view);
    };
    const scheduleTextHighlight = (text: string) => {
      if (textHighlightFrame !== null) window.cancelAnimationFrame(textHighlightFrame);
      textHighlightFrame = window.requestAnimationFrame(() => {
        textHighlightFrame = null;
        if (disposed) return;
        const currentElements = Array.from(view.dom.children).filter((element): element is HTMLElement =>
          element instanceof HTMLElement && element.classList.contains(LOCATION_HIGHLIGHT_CLASS),
        );
        const range = findLocationTextRangeInRoots(currentElements, text);
        setLocationTextHighlight(range);
        const scroller = view.dom.closest<HTMLElement>(".file-viewer-content");
        const firstElement = currentElements[0];
        if (scroller && range) {
          scrollLocationRangeIntoView(scroller, range);
        } else if (scroller && firstElement) {
          scrollLocationElementIntoView(scroller, firstElement);
        }
      });
    };

    const locationApi: MarkdownEditorLocationApi = {
      revealLocation(target) {
        const source = codec.current.serialize(view.state.doc);
        const requestedStart = Number.isInteger(target.startLine) ? target.startLine! : 0;
        const requestedEnd = Number.isInteger(target.endLine) ? target.endLine! : requestedStart;
        const snapshot = target.text.trim();
        const normalizedSnapshot = snapshot.replace(/\s+/g, " ").trim();
        const blocksForLines: HTMLElement[] = [];
        const blockRanges = new Map<HTMLElement, LocationDecorationRange>();

        view.state.doc.forEach((node, offset, index) => {
          const element = view.dom.children[index];
          if (!(element instanceof HTMLElement)) return;
          blockRanges.set(element, { from: offset, to: offset + node.nodeSize });
          const startLine = Number(element.dataset.sourceStartLine);
          const endLine = Number(element.dataset.sourceEndLine);
          const lines = Number.isInteger(startLine) && Number.isInteger(endLine)
            ? { startLine, endLine }
            : markdownBlockLineRange(source, index, index);
          if (!lines) return;
          if (requestedStart > 0 && requestedEnd >= requestedStart
            && (lines.endLine < requestedStart || lines.startLine > requestedEnd)) return;
          blocksForLines.push(element);
        });

        const textMatches = (element: HTMLElement) => {
          if (!normalizedSnapshot) return true;
          const content = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
          return content.includes(normalizedSnapshot);
        };
        const candidates = blocksForLines.length > 0
          ? blocksForLines
          : Array.from(view.dom.children).filter((element): element is HTMLElement =>
            element instanceof HTMLElement && textMatches(element),
          );
        const matched = candidates.filter(textMatches);
        const elements = matched.length > 0 ? matched : candidates;
        if (elements.length === 0) return [];
        const ranges = elements.map((element) => blockRanges.get(element)).filter((range): range is LocationDecorationRange => Boolean(range));
        if (ranges.length === 0) return [];
        view.dispatch(view.state.tr.setMeta(locationHighlightKey, ranges));
        const highlightedElements = Array.from(view.dom.children).filter((element): element is HTMLElement =>
          element instanceof HTMLElement && element.classList.contains(LOCATION_HIGHLIGHT_CLASS),
        );
        scheduleTextHighlight(snapshot);
        return highlightedElements;
      },
      clearLocation() {
        clearEditorLocation();
      },
    };
    onLocationReadyRef.current?.(locationApi);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(lineAttributeFrame);
      clearEditorLocation();
      onLocationReadyRef.current?.(null);
      onSelectionChangeRef.current?.(null);
      viewRef.current = null;
      view.destroy();
    };
  }, [sync]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.composing || codec.current.serialize(view.state.doc) === state.content) return;
    const parsed = codec.current.parse(state.content);
    const old = view.state.doc;
    let transaction = closeHistory(view.state.tr).setMeta("external", true).setMeta("addToHistory", false);
    for (const change of markdownChanges(old, parsed)) transaction = transaction.replace(change.from, change.to, parsed.slice(change.start, change.end));
    transaction = transaction.setDocAttribute("trailing", parsed.attrs.trailing);
    // Transactions map the current selection through just the changed range.
    // Preserve the visible text's position when preceding content changes height.
    const scroller = view.dom.closest<HTMLElement>(".file-viewer-content");
    const anchor = view.hasFocus() ? view.state.selection.head : view.posAtCoords({ left: view.dom.getBoundingClientRect().left + 4, top: (scroller?.getBoundingClientRect().top ?? 0) + 12 })?.pos;
    const before = anchor === undefined ? null : view.coordsAtPos(anchor).top;
    view.dispatch(transaction);
    codec.current.adopt(view.state.doc, parsed);
    if (scroller && anchor !== undefined && before !== null) scroller.scrollTop += view.coordsAtPos(transaction.mapping.map(anchor)).top - before;
  }, [state.content, sync]);

  return <>
    {state.error && <div className="markdown-sync-notice" role="alert">
      <span>{t("files.markdownSaveFailed")} {state.error}</span>
      <button type="button" onClick={() => sync?.retry()}>{t("files.markdownRetry")}</button>
    </div>}
    {state.conflicts.length > 0 && <details className="markdown-sync-notice">
      <summary>{t("files.markdownConflict")}</summary>
      {state.conflicts.map((conflict) => <div className="markdown-conflict" key={conflict.key}>
        <pre>{conflict.local}</pre><button type="button" onClick={() => sync?.resolve(conflict.key, "local")}>{t("files.markdownKeepLocal")}</button>
        <pre>{conflict.external}</pre><button type="button" onClick={() => sync?.resolve(conflict.key, "external")}>{t("files.markdownUseExternal")}</button>
      </div>)}
    </details>}
    <div ref={host} style={{ minHeight: "100%", display: "flex", flexDirection: "column" }} />
    {!sync && <div className="markdown-body markdown-file-preview markdown-readable-column" style={{ padding: "24px 32px" }}><MarkdownFilePreview {...context} content={content} /></div>}
    {blocks.map((block) => createPortal(<MarkdownFilePreview {...context} content={block.content} />, block.target, String(block.id)))}
  </>;
}
