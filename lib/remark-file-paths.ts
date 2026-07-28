import { scanFilePaths } from "./file-path-scan";

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

const SKIPPED_TYPES = new Set([
  "code",
  "inlineCode",
  "link",
  "linkReference",
  "definition",
  "image",
  "imageReference",
  "html",
]);

function splitTextNode(value: string): MdastNode[] | null {
  const matches = scanFilePaths(value);
  if (matches.length === 0) return null;

  const parts: MdastNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      parts.push({ type: "text", value: value.slice(cursor, match.start) });
    }
    parts.push({
      type: "link",
      url: match.path,
      children: [{ type: "text", value: match.path }],
    });
    cursor = match.end;
  }

  if (cursor < value.length) {
    parts.push({ type: "text", value: value.slice(cursor) });
  }

  return parts;
}

function transform(node: MdastNode): void {
  const children = node.children;
  if (!children) return;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (SKIPPED_TYPES.has(child.type)) continue;

    if (child.type === "text" && typeof child.value === "string") {
      const parts = splitTextNode(child.value);
      if (parts) {
        children.splice(index, 1, ...parts);
        index += parts.length - 1;
      }
      continue;
    }

    transform(child);
  }
}

export function remarkFilePaths() {
  return (tree: MdastNode): void => {
    transform(tree);
  };
}
