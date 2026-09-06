/**
 * ToolIcon — a small stroke-style icon for the tool call header, chosen from
 * the tool name. Icons inherit `currentColor` so they match the surrounding
 * text (e.g. green on success / red on error).
 */

import { isBashToolName, isEditToolName, isReadToolName, isWriteToolName } from "@/lib/tool-names";

interface ToolIconProps {
  toolName: string;
  size?: number;
}

function attrs(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;
}

function isGrepName(name: string): boolean {
  return name === "grep" || name.startsWith("grep_") || name.endsWith("_grep") || name.endsWith(".grep");
}

function isFindName(name: string): boolean {
  return name === "find" || name.startsWith("find_") || name.endsWith("_find") || name.endsWith(".find");
}

function isListName(name: string): boolean {
  return name === "ls" ||
    name === "list_dir" ||
    name === "list_directory" ||
    name === "read_dir" ||
    name.startsWith("ls_") ||
    name.endsWith("_ls") ||
    name.endsWith(".ls");
}

export function ToolIcon({ toolName, size = 13 }: ToolIconProps) {
  const name = toolName.toLowerCase();
  const s = attrs(size);

  if (isBashToolName(toolName)) {
    return (
      <svg {...s}>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }

  if (isReadToolName(toolName)) {
    return (
      <svg {...s}>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (isWriteToolName(toolName) || isEditToolName(toolName)) {
    return (
      <svg {...s}>
        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      </svg>
    );
  }

  if (isGrepName(name)) {
    return (
      <svg {...s}>
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    );
  }

  if (isFindName(name)) {
    return (
      <svg {...s}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <circle cx="14" cy="13" r="3" />
        <line x1="17" y1="16" x2="19" y2="18" />
      </svg>
    );
  }

  if (isListName(name)) {
    return (
      <svg {...s}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    );
  }

  if (name.includes("mcp")) {
    // MCP / external service tool: a plug.
    return (
      <svg {...s}>
        <path d="M12 22v-5" />
        <path d="M9 7V2" />
        <path d="M15 7V2" />
        <path d="M18 7v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V7z" />
      </svg>
    );
  }

  // Generic extension tool: a cube.
  return (
    <svg {...s}>
      <path d="m21 16-9 5-9-5V8l9-5 9 5z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 12v9" />
    </svg>
  );
}
