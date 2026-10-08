"use client";

// The file viewer's source view: CodeMirror 6, read-only until the viewer
// turns editing on. Loaded with next/dynamic, so opening a non-text file or the
// chat never downloads it. Only visible lines are in the DOM, so large files
// keep their highlighting, and the browser's own find cannot see the rest:
// Mod-f opens CodeMirror's search instead.

import { useEffect, useRef, type MutableRefObject } from "react";
import { Compartment, EditorState, Transaction, type Extension, type Text } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { unifiedMergeView } from "@codemirror/merge";
import { tags } from "@lezer/highlight";
import { minimalReplacement, selectedLineRange, type SelectedLineRange } from "@/lib/code-editor-text";

export type { SelectedLineRange };

export interface CodeEditorHandle {
  getValue(): string;
  /**
   * Replace the text with `text`, changing only the span that differs so the
   * selection and scroll position survive. Not an undo step.
   */
  setValue(text: string): void;
  /** Treat `text` as the saved version: the editor is dirty while it differs. */
  markSaved(text: string): void;
  getScrollElement(): HTMLElement | null;
  focus(): void;
}

interface Props {
  handleRef: MutableRefObject<CodeEditorHandle | null>;
  /** Text at creation; later changes go through `handleRef`. */
  initialValue: string;
  /** Saved version at creation (differs from `initialValue` for a restored draft). */
  savedValue: string;
  filePath: string;
  language: string;
  lineSeparator: "\n" | "\r\n";
  readOnly: boolean;
  wrapLines: boolean;
  isDark: boolean;
  /** The version on disk to show a unified diff against, or null. */
  compareWith: string | null;
  ariaLabel: string;
  onDirtyChange: (dirty: boolean) => void;
  onSelectionLinesChange: (range: SelectedLineRange | null) => void;
  onSave: () => void;
  onMentionSelection: (range: SelectedLineRange) => void;
  onScroll: (scrollTop: number, scrollLeft: number) => void;
  onReady: () => void;
  /** Called with the text just before the editor is destroyed. */
  onDispose: (text: string) => void;
}

// Colors close to the Prism `vs` / `vscDarkPlus` themes the chat's code blocks
// use, so a file reads the same as a snippet of it.
const lightHighlight = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: "#008000" },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword], color: "#0000ff" },
  { tag: [tags.controlKeyword], color: "#af00db" },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: "#a31515" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "#098658" },
  { tag: [tags.regexp, tags.escape], color: "#811f3f" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#795e26" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#267f99" },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: "#001080" },
  { tag: [tags.tagName, tags.angleBracket], color: "#800000" },
  { tag: [tags.meta, tags.processingInstruction], color: "#666666" },
  { tag: tags.heading, color: "#0000ff", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "#0451a5", textDecoration: "underline" },
  { tag: tags.invalid, color: "#cd3131" },
]);

const darkHighlight = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: "#6a9955" },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword], color: "#569cd6" },
  { tag: [tags.controlKeyword], color: "#c586c0" },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: "#ce9178" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "#b5cea8" },
  { tag: [tags.regexp, tags.escape], color: "#d16969" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#dcdcaa" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#4ec9b0" },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: "#9cdcfe" },
  { tag: [tags.tagName, tags.angleBracket], color: "#569cd6" },
  { tag: [tags.meta, tags.processingInstruction], color: "#9b9b9b" },
  { tag: tags.heading, color: "#569cd6", fontWeight: "bold" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "#4fc1ff", textDecoration: "underline" },
  { tag: tags.invalid, color: "#f44747" },
]);

const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--text)",
    backgroundColor: "var(--bg)",
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    fontWeight: "var(--font-mono-weight)",
    lineHeight: "1.6",
  },
  ".cm-content": { padding: "0" },
  ".cm-gutters": {
    backgroundColor: "var(--bg-panel)",
    color: "var(--text-dim)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "28px",
    padding: "0 10px",
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-line": { padding: "0 8px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  ".cm-panels": {
    backgroundColor: "var(--bg-panel)",
    color: "var(--text)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-textfield": {
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
  },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--bg)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
  },
});

function colorTheme(isDark: boolean): Extension {
  return [
    EditorView.theme({
      ".cm-selectionBackground": { backgroundColor: isDark ? "#3a3d41" : "#e5ebf1" },
      "&.cm-focused .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: isDark ? "#264f78" : "#add6ff",
      },
      ".cm-activeLine": { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.035)" },
      ".cm-activeLineGutter": { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" },
      ".cm-selectionMatch": { backgroundColor: isDark ? "rgba(173,214,255,0.15)" : "rgba(173,214,255,0.5)" },
    }, { dark: isDark }),
    syntaxHighlighting(isDark ? darkHighlight : lightHighlight),
  ];
}

// drawSelection() still paints a caret in a focused read-only view.
const readOnlyTheme = EditorView.theme({ ".cm-cursorLayer": { display: "none" } });

function editingExtensions(readOnly: boolean): Extension {
  return readOnly
    // Not contenteditable: no caret, no paste menu, no software keyboard or
    // iOS focus zoom. The tabindex keeps it focusable, so text selection,
    // Mod-f and Mod-i still reach the editor's keymap.
    ? [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({ tabindex: "0" }),
        readOnlyTheme,
      ]
    : [highlightActiveLine(), highlightActiveLineGutter()];
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS presents itself as a Mac; touch support tells them apart.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * iOS Safari zooms into a focused editable element whose text is under 16px.
 * `maximum-scale=1` stops that auto-zoom while pinch zoom keeps working there:
 * iOS ignores the value for the user's own gestures. Android honors it and
 * would lose pinch zoom, so only iOS gets it, and only while an editor exists.
 */
function useNoFocusZoomOnIOS(): void {
  useEffect(() => {
    if (!isIOS()) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta || /maximum-scale/.test(meta.content)) return;
    const original = meta.content;
    meta.content = `${original}, maximum-scale=1`;
    return () => {
      meta.content = original;
    };
  }, []);
}

export default function CodeEditor(props: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const savedDocRef = useRef<Text | null>(null);
  const dirtyRef = useRef(false);
  const callbacksRef = useRef(props);
  const compartments = useRef({
    language: new Compartment(),
    editing: new Compartment(),
    wrap: new Compartment(),
    color: new Compartment(),
    compare: new Compartment(),
  }).current;
  callbacksRef.current = props;
  useNoFocusZoomOnIOS();

  const { handleRef, lineSeparator } = props;

  // Created once per file and line separator; the other props reconfigure it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = callbacksRef.current;

    const reportDirty = (state: EditorState) => {
      const dirty = savedDocRef.current ? !state.doc.eq(savedDocRef.current) : false;
      if (dirty === dirtyRef.current) return;
      dirtyRef.current = dirty;
      callbacksRef.current.onDirtyChange(dirty);
    };

    const state = EditorState.create({
      doc: initial.initialValue,
      extensions: [
        EditorState.lineSeparator.of(lineSeparator),
        lineNumbers(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        search({ top: true }),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              callbacksRef.current.onSave();
              return true;
            },
          },
          {
            key: "Mod-i",
            run: (view) => {
              const range = selectedLineRange(view.state);
              if (!range) return false;
              callbacksRef.current.onMentionSelection(range);
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.domEventHandlers({
          keydown(event) {
            // While editing, Esc belongs to the editor: it must not reach the
            // global shortcut that stops the running agent.
            if (event.key === "Escape" && !callbacksRef.current.readOnly) event.preventDefault();
            return false;
          },
        }),
        EditorView.contentAttributes.of({ "aria-label": initial.ariaLabel }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) reportDirty(update.state);
          if (update.docChanged || update.selectionSet) {
            callbacksRef.current.onSelectionLinesChange(selectedLineRange(update.state));
          }
        }),
        baseTheme,
        compartments.language.of([]),
        compartments.editing.of(editingExtensions(initial.readOnly)),
        compartments.wrap.of(initial.wrapLines ? EditorView.lineWrapping : []),
        compartments.color.of(colorTheme(initial.isDark)),
        compartments.compare.of([]),
      ],
    });
    savedDocRef.current = state.toText(initial.savedValue);
    dirtyRef.current = false;

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;
    reportDirty(view.state);

    const handleScroll = () => {
      callbacksRef.current.onScroll(view.scrollDOM.scrollTop, view.scrollDOM.scrollLeft);
    };
    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

    handleRef.current = {
      getValue: () => view.state.sliceDoc(),
      setValue: (text) => {
        const change = minimalReplacement(view.state.doc, view.state.toText(text));
        if (!change) return;
        view.dispatch({ changes: change, annotations: Transaction.addToHistory.of(false) });
      },
      markSaved: (text) => {
        savedDocRef.current = view.state.toText(text);
        reportDirty(view.state);
      },
      getScrollElement: () => view.scrollDOM,
      focus: () => view.focus(),
    };
    callbacksRef.current.onReady();

    return () => {
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      if (handleRef.current?.getScrollElement() === view.scrollDOM) handleRef.current = null;
      callbacksRef.current.onDispose(view.state.sliceDoc());
      view.destroy();
      viewRef.current = null;
    };
  }, [compartments, handleRef, lineSeparator]);

  const { filePath, language, readOnly, wrapLines, isDark, compareWith } = props;

  useEffect(() => {
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const description = LanguageDescription.matchFilename(languages, fileName)
      ?? (language && language !== "text" ? LanguageDescription.matchLanguageName(languages, language, true) : null);
    let active = true;
    if (!description) {
      viewRef.current?.dispatch({ effects: compartments.language.reconfigure([]) });
      return;
    }
    description.load().then((support) => {
      if (active) viewRef.current?.dispatch({ effects: compartments.language.reconfigure(support) });
    }).catch(() => {
      // Plain text stays readable when a language chunk fails to load.
    });
    return () => {
      active = false;
    };
  }, [compartments, filePath, language, lineSeparator]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.editing.reconfigure(editingExtensions(readOnly)) });
  }, [compartments, readOnly, lineSeparator]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.wrap.reconfigure(wrapLines ? EditorView.lineWrapping : []) });
  }, [compartments, wrapLines, lineSeparator]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.color.reconfigure(colorTheme(isDark)) });
  }, [compartments, isDark, lineSeparator]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartments.compare.reconfigure(compareWith === null ? [] : unifiedMergeView({
        original: view.state.toText(compareWith),
        mergeControls: true,
        gutter: true,
      })),
    });
  }, [compartments, compareWith, lineSeparator]);

  return <div ref={containerRef} className="file-code-editor" style={{ height: "100%", minHeight: 0 }} />;
}
