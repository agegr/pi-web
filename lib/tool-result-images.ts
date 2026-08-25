export const MAX_TOOL_RESULT_IMAGE_BYTES = 10 * 1024 * 1024;

export const TOOL_RESULT_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
]);
