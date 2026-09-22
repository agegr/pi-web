/**
 * Runtime-only bridge to Capacitor native plugins (pi#31).
 *
 * The web app carries ZERO npm dependencies on Capacitor: inside the Android
 * and iOS shells (`mobile/`), the Capacitor runtime is injected into the page
 * by the native WebView, and the plugin proxies are reachable through
 * `window.Capacitor.Plugins`. In plain browsers (and during SSR) nothing here
 * touches the DOM or global scope: every export is either a pure helper or a
 * lazy accessor that returns null when the bridge is absent.
 *
 * Because the plugin JS packages (e.g. `@capacitor/camera`'s web layer) are
 * NOT bundled into the remote page, accessors materialize each plugin proxy
 * through the public `Capacitor.registerPlugin` API: the shells inject the
 * core runtime plus `PluginHeaders` (the native method tables), so every
 * registered method is routed straight to native. Method names and option
 * shapes therefore mirror the official plugin APIs; the string-literal
 * constants below replace the enums those packages would export.
 */

export const CAMERA_RESULT_TYPES = {
  /** Native capture returns raw base64 image bytes. */
  base64: "base64",
  /** Native capture returns a WebView-servable URL. */
  uri: "uri",
} as const;

export const CAMERA_SOURCES = {
  /** Native action sheet: take a photo or choose from the library. */
  prompt: "PROMPT",
  camera: "CAMERA",
  photos: "PHOTOS",
} as const;

/** CSS class the safe-area scenario in `app/globals.css` keys off (pi#31). */
export const CAPACITOR_SHELL_SCENARIO_CLASS = "capacitor-shell";

export interface CapacitorCameraPhoto {
  base64String?: string;
  webPath?: string;
  format?: string;
}

export interface CapacitorCameraPlugin {
  getPhoto(options: {
    resultType: typeof CAMERA_RESULT_TYPES[keyof typeof CAMERA_RESULT_TYPES];
    source: typeof CAMERA_SOURCES[keyof typeof CAMERA_SOURCES];
    quality?: number;
    width?: number;
    correctOrientation?: boolean;
  }): Promise<CapacitorCameraPhoto>;
}

export interface CapacitorPickedFile {
  /** Web-only convenience; native results carry `data` instead. */
  blob?: Blob;
  /** Base64 file data, present when `readData: true` (native). */
  data?: string;
  name?: string;
  path?: string;
  mimeType?: string;
  size?: number;
}

export interface CapacitorFilePickerPlugin {
  /** @capawesome/capacitor-file-picker (community, MIT): arbitrary files. */
  pickFiles(options?: { types?: string[]; limit?: number; readData?: boolean }): Promise<{ files: CapacitorPickedFile[] }>;
  /** Image multi-pick (photo library UI on both platforms). */
  pickImages(options?: { limit?: number; readData?: boolean }): Promise<{ files: CapacitorPickedFile[] }>;
}

export interface CapacitorPluginListenerHandle {
  remove: () => Promise<void>;
}

export interface CapacitorActionPerformedEvent {
  notification?: {
    extra?: { sessionUrl?: string };
  };
}

export interface CapacitorLocalNotificationsPlugin {
  schedule(options: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      extra?: Record<string, string>;
      schedule?: { at?: Date };
    }>;
  }): Promise<{ notifications?: unknown[] }>; 
  requestPermissions(): Promise<{ display?: string }>;
  addListener(
    eventName: "localNotificationActionPerformed",
    callback: (event: CapacitorActionPerformedEvent) => void,
  ): Promise<CapacitorPluginListenerHandle>;
}

export interface CapacitorKeyboardPlugin {
  setAccessoryBarVisible?: (options: { isVisible: boolean }) => Promise<void>;
}

export interface CapacitorPreferencesPlugin {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
}

interface CapacitorPluginRegistry {
  Camera?: CapacitorCameraPlugin;
  FilePicker?: CapacitorFilePickerPlugin;
  LocalNotifications?: CapacitorLocalNotificationsPlugin;
  Keyboard?: CapacitorKeyboardPlugin;
  Preferences?: CapacitorPreferencesPlugin;
}

interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  /**
   * Legacy plugin registry. In Capacitor 7 a plugin proxy exists here only
   * after `registerPlugin` ran for that name — the shells inject the core
   * runtime plus `PluginHeaders` (the native plugin method tables), but NOT
   * the per-plugin web layers (the web app is dependency-free), so the
   * materialization below goes through the public `registerPlugin` API.
   */
  Plugins?: CapacitorPluginRegistry;
  registerPlugin?: (name: string, jsImplementations?: Record<string, unknown>) => unknown;
}

function getCapacitorRuntime(): CapacitorRuntime | undefined {
  if (typeof window === "undefined") return undefined; // SSR / plain Node guard
  return (window as { Capacitor?: CapacitorRuntime }).Capacitor;
}

/**
 * True only inside the native Capacitor shells. SSR-safe: false on the server
 * and in every plain browser, PWA install included. Pure — it never mutates
 * the document (see {@link applyCapacitorShellScenario}).
 */
export function isCapacitorShell(): boolean {
  const runtime = getCapacitorRuntime();
  return runtime?.isNativePlatform?.() === true;
}

function getCapacitorPlugin<T>(name: keyof CapacitorPluginRegistry): T | null {
  if (!isCapacitorShell()) return null;
  const runtime = getCapacitorRuntime();
  if (!runtime) return null;
  const existing = runtime.Plugins?.[name];
  if (existing) return existing as T;
  // The plugin's web layer is not bundled into the remote page, so the proxy
  // must be materialized against the natively injected PluginHeaders. Calling
  // the public `registerPlugin` with no web implementations does exactly that:
  // every method listed in the native header is routed straight to native.
  if (typeof runtime.registerPlugin !== "function") return null;
  try {
    const proxy = runtime.registerPlugin(name, {});
    return (proxy as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export function getCapacitorCamera(): CapacitorCameraPlugin | null {
  return getCapacitorPlugin<CapacitorCameraPlugin>("Camera");
}

export function getCapacitorFilePicker(): CapacitorFilePickerPlugin | null {
  return getCapacitorPlugin<CapacitorFilePickerPlugin>("FilePicker");
}

export function getCapacitorLocalNotifications(): CapacitorLocalNotificationsPlugin | null {
  return getCapacitorPlugin<CapacitorLocalNotificationsPlugin>("LocalNotifications");
}

export function getCapacitorKeyboard(): CapacitorKeyboardPlugin | null {
  return getCapacitorPlugin<CapacitorKeyboardPlugin>("Keyboard");
}

export function getCapacitorPreferences(): CapacitorPreferencesPlugin | null {
  return getCapacitorPlugin<CapacitorPreferencesPlugin>("Preferences");
}

/**
 * Permission denials surface as plugin errors whose message mentions the
 * denied permission or access. User-initiated cancellation is NOT a denial.
 */
export function isPermissionDeniedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /permission|denied|not authorized|unauthorized/i.test(message);
}

function decodeBase64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = typeof atob === "function"
    ? atob(base64)
    : Buffer.from(base64, "base64").toString("binary");
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Camera capture result (`resultType: "base64"`) → a `File` the attach flow's
 * existing `processImageFiles` pipeline accepts unchanged.
 */
export function fileFromCameraPhoto(base64String: string, format = "jpeg"): File {
  const normalizedFormat = format === "jpg" ? "jpeg" : format;
  const mimeType = `image/${normalizedFormat}`;
  const stamp = typeof Date !== "undefined" ? Date.now() : 0;
  return new File([decodeBase64Bytes(base64String)], `camera-${stamp}.${normalizedFormat}`, { type: mimeType });
}

function uploadNameFor(picked: CapacitorPickedFile, index: number): string {
  if (picked.name) return picked.name;
  if (picked.path) {
    const base = picked.path.split("/").filter(Boolean).pop();
    if (base && base.includes(".")) return base;
  }
  return `upload-${Date.now()}-${index + 1}`;
}

/**
 * Document/photo-picker results (`@capawesome/capacitor-file-picker`) →
 * `File[]` for the upload and attach pipelines. On native platforms the
 * bytes arrive base64-encoded through the bridge (`readData: true`); the
 * `blob` field is the web implementation's convenience. Entries with
 * neither are skipped rather than failing the whole pick.
 */
export function filesFromPickedFiles(picked: CapacitorPickedFile[]): File[] {
  const files: File[] = [];
  picked.forEach((entry, index) => {
    let source: Blob | Uint8Array<ArrayBuffer> | null = entry.blob ?? null;
    if (!source && entry.data) {
      try {
        source = decodeBase64Bytes(entry.data);
      } catch {
        source = null;
      }
    }
    if (!source) return;
    const name = uploadNameFor(entry, index);
    const fallbackType = source instanceof Blob ? source.type : "";
    const mimeType = entry.mimeType && entry.mimeType !== "" ? entry.mimeType : fallbackType;
    files.push(new File([source], name, mimeType ? { type: mimeType } : undefined));
  });
  return files;
}

/**
 * Extend the standalone-PWA safe-area scenario (pi#1) to the shells: a
 * Capacitor WebView reports `display-mode: browser`, so the CSS scenario keys
 * off this class instead. Idempotent; a no-op outside the shells.
 */
export function applyCapacitorShellScenario(root: Document | null = null): void {
  if (!isCapacitorShell()) return;
  const doc = root ?? (typeof document === "undefined" ? null : document);
  doc?.documentElement.classList.add(CAPACITOR_SHELL_SCENARIO_CLASS);
}
