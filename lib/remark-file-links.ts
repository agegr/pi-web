import { resolveLocalFileHref } from "./file-links";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  data?: { hProperties: { dataFilePathLabel: string } };
  children?: MarkdownNode[];
}

function fileLink(value: string, cwd?: string, inlineCode = false): MarkdownNode | null {
  // Be conservative: do not turn commands, URLs, or arbitrary inline code into links.
  if (/\r|\n/.test(value) || !/^(?:[a-zA-Z]:[\\/]|\\\\|\/(?!\/)|\.\.?\/|[\w.@-]+\/|[\w@-]+\.[\w-]+$)/.test(value)) return null;
  if (!inlineCode && /\s/.test(value)) return null;
  const path = resolveLocalFileHref(value, cwd);
  if (!path) return null;
  const suffix = value.match(/(:\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/)?.[0] ?? "";
  // file: URLs survive markdown sanitization and preserve spaces and URL delimiters.
  const url = path.startsWith("//")
    ? `file://${path.slice(2).split("/").map(encodeURIComponent).join("/")}`
    : `file://${path.startsWith("/") ? "" : "/"}${path.split("/").map(encodeURIComponent).join("/")}`;
  return {
    type: "link",
    url,
    data: { hProperties: { dataFilePathLabel: path + suffix } },
    children: [{ type: inlineCode ? "inlineCode" : "text", value }],
  };
}

/** Link filesystem references without rewriting fenced code, math, or existing links. */
export function remarkFileLinks({ cwd }: { cwd?: string } = {}) {
  return (tree: MarkdownNode) => {
    const walk = (parent: MarkdownNode) => {
      if (!parent.children || ["link", "linkReference", "code", "html", "image", "imageReference"].includes(parent.type)) return;
      parent.children = parent.children.flatMap((node): MarkdownNode[] => {
        if (node.type === "inlineCode") return [fileLink(node.value ?? "", cwd, true) ?? node];
        if (node.type !== "text") {
          walk(node);
          return [node];
        }
        const text = node.value ?? "";
        const result: MarkdownNode[] = [];
        // Plain paths cannot contain whitespace; use backticks for paths with spaces.
        const pattern = /(^|[\s:：,，;；(（【「“"'])((?:[a-zA-Z]:[\\/]|\\\\|\/(?!\/)|\.\.?\/|[\w.@-]+\/)[^\s<>"'`，。；！？、（）【】「」“”]+)/g;
        let offset = 0;
        for (const match of text.matchAll(pattern)) {
          const start = match.index! + match[1].length;
          const value = match[2].replace(/[.,;!:)\]}]+$/, "");
          const link = fileLink(value, cwd);
          if (!link) continue;
          if (start > offset) result.push({ type: "text", value: text.slice(offset, start) });
          result.push(link);
          offset = start + value.length;
        }
        if (!result.length) return [node];
        if (offset < text.length) result.push({ type: "text", value: text.slice(offset) });
        return result;
      });
    };
    walk(tree);
  };
}
