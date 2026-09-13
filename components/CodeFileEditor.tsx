"use client";

import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Annotation, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { getFileExt } from "@/lib/file-types";
import { getFileName } from "@/lib/file-paths";
import { useI18n } from "@/hooks/useI18n";
import { useTextFile } from "@/hooks/useMarkdownFile";
import { LOCATION_HIGHLIGHT_CLASS } from "@/lib/location-highlight";
import type {
  MarkdownEditorLocationApi,
  MarkdownEditorLocationTarget,
  MarkdownEditorSelection,
} from "./MarkdownFileEditor";

interface Props {
  filePath: string;
  content: string;
  sourceSessionId?: string | null;
  watchEnabled?: boolean;
  initialScrollTop?: number;
  initialScrollLeft?: number;
  hasPendingLocation?: boolean;
  onScrollPositionChange?: (position: { scrollTop: number; scrollLeft: number }) => void;
  onSelectionChange?: (selection: MarkdownEditorSelection | null) => void;
  onLocationReady?: (api: MarkdownEditorLocationApi | null) => void;
}

const externalChange = Annotation.define<boolean>();
const setLocation = StateEffect.define<{ from: number; to: number; textFrom?: number; textTo?: number } | null>();
const locationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    const effect = transaction.effects.find((item) => item.is(setLocation));
    if (effect) {
      if (!effect.value) return Decoration.none;
      const ranges = [];
      let position = effect.value.from;
      while (position <= effect.value.to && position <= transaction.state.doc.length) {
        const line = transaction.state.doc.lineAt(position);
        ranges.push(Decoration.line({ class: LOCATION_HIGHLIGHT_CLASS }).range(line.from));
        if (line.to >= effect.value.to || line.to === transaction.state.doc.length) break;
        position = line.to + 1;
      }
      if (effect.value.textFrom !== undefined && effect.value.textTo !== undefined
        && effect.value.textTo > effect.value.textFrom) {
        ranges.push(Decoration.mark({ class: "file-location-text-highlight" }).range(
          effect.value.textFrom,
          effect.value.textTo,
        ));
      }
      return Decoration.set(ranges, true);
    }
    return transaction.docChanged ? Decoration.none : value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function languageExtension(filePath: string): Extension {
  switch (getFileExt(filePath)) {
    case "ts":
    case "tsx":
      return javascript({ typescript: true, jsx: getFileExt(filePath) === "tsx" });
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: getFileExt(filePath) === "jsx" });
    case "json":
    case "jsonl":
      return json();
    case "css":
    case "scss":
    case "less":
      return css();
    case "html":
    case "htm":
      return html();
    default:
      // Unsupported text formats still get a fully editable plain-text
      // surface, so editing and saving do not depend on a language package.
      return [];
  }
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "100%",
    color: "var(--text)",
    backgroundColor: "var(--bg)",
    fontSize: "13px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "16px 0 48px",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    color: "var(--text-dim)",
    backgroundColor: "var(--bg-panel)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--bg-selected)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--bg-selected) 42%, transparent)",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent) !important",
  },
});

export default function CodeFileEditor({
  content,
  filePath,
  sourceSessionId,
  watchEnabled = true,
  initialScrollTop = 0,
  initialScrollLeft = 0,
  hasPendingLocation = false,
  onScrollPositionChange,
  onSelectionChange,
  onLocationReady,
}: Props) {
  const { t } = useI18n();
  const { sync, state } = useTextFile(filePath, content, sourceSessionId, watchEnabled);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const editorPathRef = useRef(filePath);
  const initialScrollTopRef = useRef(initialScrollTop);
  const initialScrollLeftRef = useRef(initialScrollLeft);
  const hasPendingLocationRef = useRef(hasPendingLocation);
  const onScrollPositionChangeRef = useRef(onScrollPositionChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onLocationReadyRef = useRef(onLocationReady);
  onScrollPositionChangeRef.current = onScrollPositionChange;
  onSelectionChangeRef.current = onSelectionChange;
  onLocationReadyRef.current = onLocationReady;
  if (editorPathRef.current !== filePath) {
    editorPathRef.current = filePath;
    initialScrollTopRef.current = initialScrollTop;
    initialScrollLeftRef.current = initialScrollLeft;
    hasPendingLocationRef.current = hasPendingLocation;
  }

  useEffect(() => {
    if (!host.current || !sync) return;
    let disposed = false;
    const notifySelection = (view: EditorView) => {
      const selection = view.state.selection.main;
      if (selection.empty) {
        onSelectionChangeRef.current?.(null);
        return;
      }
      const from = Math.min(selection.from, selection.to);
      const to = Math.max(selection.from, selection.to);
      const startLine = view.state.doc.lineAt(from).number;
      let endLine = view.state.doc.lineAt(to).number;
      // Match the existing source-view behavior: a selection ending at the
      // start of a line does not claim that empty line.
      if (endLine > startLine && to === view.state.doc.line(endLine).from) endLine -= 1;
      const fromRect = view.coordsAtPos(from);
      const toRect = view.coordsAtPos(to);
      const fallback = view.dom.getBoundingClientRect();
      const text = view.state.doc.sliceString(from, to).trim();
      if (!text) {
        onSelectionChangeRef.current?.(null);
        return;
      }
      const top = Math.min(window.innerHeight - 44, Math.max(fromRect?.bottom ?? fallback.top + 24, toRect?.bottom ?? fallback.top + 24) + 8);
      const left = Math.max(8, Math.min(window.innerWidth - 8, ((fromRect?.left ?? fallback.left) + (toRect?.right ?? fromRect?.right ?? fallback.right)) / 2));
      onSelectionChangeRef.current?.({
        text,
        startLine,
        endLine,
        top,
        left,
      });
    };
    const revealLocation = (target: MarkdownEditorLocationTarget) => {
      const current = viewRef.current;
      if (!current) return [];
      const doc = current.state.doc;
      const requestedStart = Number.isInteger(target.startLine) ? target.startLine! : 0;
      const requestedEnd = Number.isInteger(target.endLine) ? target.endLine! : requestedStart;
      let startLine = requestedStart;
      let endLine = requestedEnd;
      const snapshot = target.text.trim();
      if (startLine < 1 || endLine < startLine || startLine > doc.lines) {
        const match = snapshot ? doc.toString().indexOf(snapshot) : -1;
        if (match < 0) return [];
        startLine = doc.lineAt(match).number;
        endLine = doc.lineAt(Math.min(doc.length, match + snapshot.length)).number;
      }
      endLine = Math.min(endLine, doc.lines);
      const from = doc.line(startLine).from;
      const to = doc.line(endLine).to;
      const textPosition = snapshot ? doc.toString().indexOf(snapshot, from) : -1;
      const hasExactText = textPosition >= from && textPosition + snapshot.length <= to;
      const textFrom = hasExactText ? textPosition : undefined;
      const textTo = textFrom === undefined ? undefined : textFrom + snapshot.length;
      current.dispatch({
        effects: [
          setLocation.of({ from, to, textFrom, textTo }),
          EditorView.scrollIntoView(from, { y: "center" }),
        ],
      });
      // The editor owns the decoration. Returning its root tells FileViewer
      // that the asynchronous location request was handled successfully.
      return [current.dom];
    };
    const view = new EditorView({
      state: EditorState.create({
        doc: sync.state.content,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          highlightSpecialChars(),
          drawSelection(),
          history(),
          bracketMatching(),
          indentOnInput(),
          foldGutter(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          locationField,
          languageExtension(filePath),
          EditorState.allowMultipleSelections.of(true),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          editorTheme,
          EditorView.domEventHandlers({
            compositionstart: () => { sync.setComposing(true); return false; },
            compositionend: () => {
              setTimeout(() => { if (!disposed) sync.setComposing(false); }, 0);
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(externalChange))) {
              sync.edit(update.state.doc.toString());
            }
            notifySelection(view);
          }),
        ],
      }),
      parent: host.current,
    });
    viewRef.current = view;
    const scrollDOM = view.scrollDOM;
    const reportScrollPosition = () => {
      onScrollPositionChangeRef.current?.({ scrollTop: scrollDOM.scrollTop, scrollLeft: scrollDOM.scrollLeft });
    };
    scrollDOM.addEventListener("scroll", reportScrollPosition, { passive: true });
    const restoreFrame = hasPendingLocationRef.current ? null : window.requestAnimationFrame(() => {
      scrollDOM.scrollTop = initialScrollTopRef.current;
      scrollDOM.scrollLeft = initialScrollLeftRef.current;
      reportScrollPosition();
    });
    const locationApi: MarkdownEditorLocationApi = {
      revealLocation,
      clearLocation: () => {
        if (!viewRef.current) return;
        viewRef.current.dispatch({ effects: setLocation.of(null) });
      },
    };
    onLocationReadyRef.current?.(locationApi);
    notifySelection(view);

    return () => {
      disposed = true;
      if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
      scrollDOM.removeEventListener("scroll", reportScrollPosition);
      onLocationReadyRef.current?.(null);
      onSelectionChangeRef.current?.(null);
      viewRef.current = null;
      view.destroy();
    };
  }, [filePath, sync]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === state.content) return;
    const anchor = Math.min(view.state.selection.main.anchor, state.content.length);
    const head = Math.min(view.state.selection.main.head, state.content.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: state.content },
      selection: { anchor, head },
      annotations: externalChange.of(true),
    });
  }, [state.content]);

  return (
    <div className="code-file-editor-shell">
      {state.error && (
        <div className="markdown-sync-notice" role="alert">
          <span>{t("files.textSaveFailed")} {state.error}</span>
          <button type="button" onClick={() => sync?.retry()}>{t("files.textRetry")}</button>
        </div>
      )}
      {state.conflicts.length > 0 && (
        <details className="markdown-sync-notice">
          <summary>{t("files.textConflict")}</summary>
          {state.conflicts.map((conflict) => (
            <div className="markdown-conflict" key={conflict.key}>
              <pre>{conflict.local}</pre>
              <button type="button" onClick={() => sync?.resolve(conflict.key, "local")}>{t("files.textKeepLocal")}</button>
              <pre>{conflict.external}</pre>
              <button type="button" onClick={() => sync?.resolve(conflict.key, "external")}>{t("files.textUseExternal")}</button>
            </div>
          ))}
        </details>
      )}
      <div
        ref={host}
        className="code-file-editor"
        aria-label={getFileName(filePath)}
        data-saving={state.saving ? "true" : "false"}
      />
    </div>
  );
}
