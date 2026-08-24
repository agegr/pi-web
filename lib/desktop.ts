export interface DesktopBridge {
  readonly isDesktop: true;
  readonly platform: string;
  readonly selectDirectory: () => Promise<string | null>;
}

declare global {
  interface Window {
    piDesktop?: DesktopBridge;
  }
}

/** True only when pi-web is hosted by its Electron shell. */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && window.piDesktop?.isDesktop === true;
}
