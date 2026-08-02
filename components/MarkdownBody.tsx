"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { resolveLocalFileHref } from "@/lib/file-links";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { markdownRehypePlugins, markdownRemarkPlugins, normalizeDisplayMath } from "@/lib/markdown";
import { MermaidBlock, CodeBlock } from "./MermaidBlock";
import { QuoteReplyPopover } from "./QuoteReplyPopover";
import { useI18n } from "@/hooks/useI18n";
import { parseParagraph, type ParsedSegment } from "@/lib/quote-reply";

interface MarkdownBodyProps {
  children: string;
  className?: string;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string, fileName?: string) => void;
  /** When set (assistant messages), each paragraph becomes hoverable/clickable
   *  to pop a quote-reply popover. */
  onQuoteReply?: (quote: string) => void;
}

/** Exactly one quote-reply popover can be open at a time (per message body). */
const QuoteOpenContext = createContext<{ openId: string | null; setOpenId: (id: string | null) => void }>({
  openId: null,
  setOpenId: () => {},
});

export function MarkdownBody({ children, className, isStreaming, cwd, onOpenFile, onQuoteReply }: MarkdownBodyProps) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(children), [children]);
  const [openId, setOpenId] = useState<string | null>(null);
  // Stable renderer identities keep stateful blocks mounted across message hover updates.
  const components = useMemo<Components>(() => ({
    code({ className, children, ...props }) {
      const lang = className?.replace("language-", "").toLowerCase() ?? "";
      const raw = String(children);
      const isBlock = className?.includes("language-") || raw.includes("\n");
      if (isBlock) {
        if (lang === "mermaid") {
          return <MermaidBlock code={raw.replace(/\n$/, "")} isStreaming={isStreaming} />;
        }
        return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
      }
      return (
        <code
          className="markdown-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    a({ href, children, ...props }) {
      // `node` is react-markdown metadata, not a DOM attribute.
      delete props.node;
      const filePath = onOpenFile ? resolveLocalFileHref(href, cwd) : null;
      const openFile = onOpenFile;
      if (!filePath || !openFile) {
        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      }

      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault();
        openFile(filePath);
      };

      return (
        <a href={href} {...props} onClick={handleClick}>
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      delete props.node;
      const filePath = typeof src === "string" ? resolveLocalFileHref(src, cwd) : null;
      const imageSrc = filePath
        ? `/api/files/${encodeFilePathForApi(filePath)}?type=read`
        : src;
      // Dynamic local paths are served directly by the file API.
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
    },
    p({ children, ...props }) {
      delete props.node;
      const pid = useId();
      if (!onQuoteReply) return <p {...props}>{children}</p>;
      return (
        <QuoteableParagraph pid={pid} onQuoteReply={onQuoteReply} onOpenFile={onOpenFile} cwd={cwd}>
          {children}
        </QuoteableParagraph>
      );
    },
    li({ children, ...props }) {
      delete props.node;
      const pid = useId();
      if (!onQuoteReply) return <li {...props}>{children}</li>;
      return (
        <QuoteableParagraph as="li" pid={pid} onQuoteReply={onQuoteReply} onOpenFile={onOpenFile} cwd={cwd}>
          {children}
        </QuoteableParagraph>
      );
    },
    table({ children }) {
      return (
        <div className="markdown-table-wrap">
          <table>{children}</table>
        </div>
      );
    },
    tr({ children, ...props }) {
      delete props.node;
      const pid = useId();
      if (!onQuoteReply) return <tr {...props}>{children}</tr>;
      return (
        <QuoteableParagraph as="tr" pid={pid} onQuoteReply={onQuoteReply} onOpenFile={onOpenFile} cwd={cwd}>
          {children}
        </QuoteableParagraph>
      );
    },
  }), [cwd, isStreaming, onOpenFile, onQuoteReply]);

  return (
    <QuoteOpenContext.Provider value={{ openId, setOpenId }}>
      <div className={["markdown-body", className].filter(Boolean).join(" ")}>
        <ReactMarkdown
          remarkPlugins={markdownRemarkPlugins}
          rehypePlugins={markdownRehypePlugins}
          components={components}
        >
          {normalizedMarkdown}
        </ReactMarkdown>
      </div>
    </QuoteOpenContext.Provider>
  );
}

/** A <p>/<li> whose plain text is parsed on hover (desktop) / click (mobile)
 *  to pop a quote-reply popover. The parse result is locked once shown so a
 *  streaming tail doesn't make the popover flicker; re-engaging re-parses. */
function QuoteableParagraph({ children, onQuoteReply, onOpenFile, cwd, as = "p", pid }: { children: ReactNode; onQuoteReply: (quote: string) => void; onOpenFile?: (filePath: string, fileName?: string) => void; cwd?: string; as?: "p" | "li" | "tr"; pid: string }) {
  const { openId, setOpenId } = useContext(QuoteOpenContext);
  const { t } = useI18n();
  const open = openId === pid;
  const ref = useRef<HTMLElement>(null);
  const [segments, setSegments] = useState<ParsedSegment[] | null>(null);
  const [showTip, setShowTip] = useState(false);
  const tipRef = useRef<HTMLSpanElement>(null);
  // Detect touch capability lazily (same approach as useIsMobile but local).
  const [coarse] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches);

  // Another paragraph opened its popover → close ours (only one popover at a time).
  useEffect(() => {
    if (!open && segments) setSegments(null);
  }, [open, segments]);

  // When the popover opens, ensure it's in view (the paragraph near the
  // bottom of the viewport would otherwise push it out of sight).
  const popoverRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (segments && popoverRef.current) {
      popoverRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [segments]);

  const openPopover = () => {
    if (segments || open) return;
    // For table rows, join cell text with " | " so the quoted line reads like
    // a markdown row instead of all cells mashed together.
    const el = ref.current;
    const text = as === "tr" && el
      ? Array.from(el.querySelectorAll("td, th")).map((c) => (c.textContent ?? "").trim()).join(" | ")
      : (el?.textContent ?? "");
    // Any paragraph is quoteable (not just questions): closed questions get
    // option buttons, everything else gets a fallback quote button.
    const parsed = parseParagraph(text);
    if (parsed.length > 0) {
      setSegments(parsed);
      setOpenId(pid);
    }
  };
  const closePopover = () => {
    setSegments(null);
    setOpenId(null);
  };
  // Click toggles: show on first click, hide on the second.
  const toggle = () => {
    if (segments) closePopover();
    else openPopover();
  };

  const Tag = as as React.ElementType;
  // Follow-the-mouse tooltip: position updated imperatively on mousemove (no
  // re-render per move); mouseenter sets it via rAF so it shows even if the
  // pointer doesn't move afterwards.
  const moveTip = (x: number, y: number) => {
    if (tipRef.current) {
      tipRef.current.style.left = `${x + 12}px`;
      tipRef.current.style.top = `${y + 14}px`;
    }
  };
  const showTooltip = (e: MouseEvent<HTMLElement>) => {
    if (coarse) return;
    setShowTip(true);
    const { clientX, clientY } = e;
    requestAnimationFrame(() => moveTip(clientX, clientY));
  };
  const hideTooltip = () => {
    setShowTip(false);
  };
  return (
    <Tag
      ref={ref}
      onMouseEnter={showTooltip}
      onMouseMove={coarse ? undefined : (e: MouseEvent<HTMLElement>) => moveTip(e.clientX, e.clientY)}
      onMouseLeave={hideTooltip}
      onClick={toggle}
      style={{ position: "relative", cursor: "pointer" }}
    >
      {children}
      {showTip && !segments && (
        <span
          ref={tipRef}
          style={{
            position: "fixed",
            left: -9999,
            top: -9999,
            fontSize: 11,
            color: "var(--text-dim)",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "2px 6px",
            pointerEvents: "none",
            zIndex: 50,
            whiteSpace: "nowrap",
          }}
        >
          {t("chat.quoteReplyHint")}
        </span>
      )}
      {segments && (
        <QuoteReplyPopover
          innerRef={popoverRef}
          segments={segments}
          onPick={(q) => { onQuoteReply(q); closePopover(); }}
          onOpenFile={onOpenFile}
          cwd={cwd}
        />
      )}
    </Tag>
  );
}
