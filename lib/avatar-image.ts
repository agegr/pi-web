/** Maximum edge length (in CSS pixels) used when resizing avatar uploads.
 *  128 is comfortably above the largest displayed avatar (72px preview at
 *  2x DPR) and keeps the persisted data URLs small. */
export const AVATAR_IMAGE_MAX_SIZE = 128;

/**
 * Pick a target {width, height} that fits inside `maxSize` on its longest
 * edge while preserving the source aspect ratio. Pure: easy to unit test
 * without a browser. Inputs <= maxSize are returned unchanged.
 */
export function computeAvatarTargetSize(
  width: number,
  height: number,
  maxSize: number = AVATAR_IMAGE_MAX_SIZE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: maxSize, height: maxSize };
  }
  const largest = Math.max(width, height);
  if (largest <= maxSize) return { width, height };
  const scale = maxSize / largest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Detect the source MIME so the resized output keeps its format. */
export function detectAvatarSourceMime(dataUrl: string): string {
  const match = /^data:([^;]+);/.exec(dataUrl);
  return match ? match[1].toLowerCase() : "image/png";
}

type ResizableImage = ImageBitmap | HTMLImageElement;

interface ResizeCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): {
    imageSmoothingQuality: "low" | "medium" | "high";
    drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  } | null;
  toDataURL(mime: string): string;
}

interface ResizeDeps {
  loadBitmap: (dataUrl: string) => Promise<ResizableImage>;
  createCanvas: (width: number, height: number) => ResizeCanvas;
}

const BROWSER_DEPS: ResizeDeps = {
  loadBitmap: async (dataUrl) => {
    if (typeof createImageBitmap === "function") {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      return await createImageBitmap(blob);
    }
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode avatar image"));
      img.src = dataUrl;
    });
  },
  createCanvas: (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as ResizeCanvas;
  },
};

/**
 * Browser-only: resize an avatar data URL to fit within `maxSize` and
 * re-encode it. The DOM-touching steps are isolated in `BROWSER_DEPS` so
 * the pure logic can be exercised in node tests by passing custom deps.
 *
 * This function must only be called from the browser; it touches DOM
 * globals through the default dependency set. Tests cover the pure
 * `computeAvatarTargetSize` helper directly.
 */
export async function resizeAvatarDataUrl(
  dataUrl: string,
  maxSize: number = AVATAR_IMAGE_MAX_SIZE,
  deps: ResizeDeps = BROWSER_DEPS,
): Promise<string> {
  const sourceMime = detectAvatarSourceMime(dataUrl);
  const bitmap = await deps.loadBitmap(dataUrl);
  const target = computeAvatarTargetSize(bitmap.width, bitmap.height, maxSize);
  const canvas = deps.createCanvas(target.width, target.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context for avatar resize");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, target.width, target.height);
  if ("close" in bitmap && typeof bitmap.close === "function") {
    bitmap.close();
  }
  return canvas.toDataURL(sourceMime);
}

/** Exposed for tests: the dependency shape `resizeAvatarDataUrl` accepts. */
export type { ResizeDeps, ResizeCanvas, ResizableImage };
