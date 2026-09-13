export const LOCATION_HIGHLIGHT_CLASS = "location-highlight";

const LOCATION_TEXT_HIGHLIGHT_NAME = "pi-location-highlight";

interface HighlightRegistryLike {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}

interface BrowserHighlightGlobals {
  CSS?: { highlights?: HighlightRegistryLike };
  Highlight?: new (...ranges: Range[]) => unknown;
}

let dismissHandler: (() => void) | null = null;
let dismissKeyHandler: ((event: KeyboardEvent) => void) | null = null;

function browserGlobals(): BrowserHighlightGlobals {
  return globalThis as unknown as BrowserHighlightGlobals;
}

export function clearLocationTextHighlight() {
  if (dismissHandler && typeof document !== "undefined") {
    document.removeEventListener("pointerdown", dismissHandler, true);
  }
  if (dismissKeyHandler && typeof document !== "undefined") {
    document.removeEventListener("keydown", dismissKeyHandler, true);
  }
  dismissHandler = null;
  dismissKeyHandler = null;
  browserGlobals().CSS?.highlights?.delete(LOCATION_TEXT_HIGHLIGHT_NAME);
}

export function setLocationTextHighlight(range: Range | null): boolean {
  clearLocationTextHighlight();
  if (!range || typeof document === "undefined") return false;

  const globals = browserGlobals();
  const registry = globals.CSS?.highlights;
  const HighlightConstructor = globals.Highlight;
  if (!registry || !HighlightConstructor) return false;

  registry.set(LOCATION_TEXT_HIGHLIGHT_NAME, new HighlightConstructor(range));
  dismissHandler = () => clearLocationTextHighlight();
  dismissKeyHandler = (event) => {
    if (event.key === "Escape") clearLocationTextHighlight();
  };
  document.addEventListener("pointerdown", dismissHandler, true);
  document.addEventListener("keydown", dismissKeyHandler, true);
  return true;
}
