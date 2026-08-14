import type { ImageContent, ToolResultMessage } from "./types";

export function getToolResultImages(result?: ToolResultMessage): ImageContent[] {
  return result?.content.filter((block): block is ImageContent => block.type === "image") ?? [];
}
