export interface SidebarWidthResult {
  changed: boolean;
  width: number;
}

export function createSidebarWidthTracker(opts: { min: number; max: number }) {
  let current: number | null = null;

  return {
    next(rawWidth: number): SidebarWidthResult {
      const width = Math.max(opts.min, Math.min(opts.max, rawWidth));
      if (current === width) {
        return { changed: false, width };
      }
      current = width;
      return { changed: true, width };
    },
  };
}
