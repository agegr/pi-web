/**
 * The server half of `docs/integrations.md`'s downstream settings sections: a
 * pi extension registers a section here, and Pi Web renders it.
 *
 * Two pieces, both kept on `globalThis` so a Next dev hot reload — or a second
 * copy of this module in a bundler's graph — does not read the extensions twice
 * or lose what they registered:
 *
 *   - the registry, at `Symbol.for("@agegr/pi-web/settings-sections/v1")`, the
 *     same versioned shape `lib/session-liveness.ts` established for extensions;
 *   - the boot state of the one load that reads them.
 *
 * `pi` loads extensions when a session starts, which would leave a plugin's
 * section invisible until someone chatted. `warmSettingsSections()` loads them
 * at server start instead, asking for extensions only.
 */

import { homedir } from "node:os";
import { errorMessage } from "./errors";
import {
  MAX_SETTINGS_SECTIONS,
  normalizeSettingsSection,
  type SettingsReadResult,
  type SettingsSectionDescriptor,
  type SettingsSectionStatus,
} from "./settings-sections";

export const SETTINGS_SECTIONS_REGISTRY_KEY = "@agegr/pi-web/settings-sections/v1";
const PROTOCOL_VERSION = 1;

/** Built-ins whose work belongs to a session: the MCP host, the codemode worker, the llama provider. */
const SESSION_ONLY_BUILTINS = ["llama.cpp", "codemode", "tool-search", "mcp"];

const BOOT_STATE_KEY = "@agegr/pi-web/settings-sections-boot/v1";

/** Handlers a registered section answers; its descriptor travels beside them. */
export interface RegisteredSettingsSection {
  read(): SettingsReadResult | Promise<SettingsReadResult>;
  apply(values: Record<string, unknown>): void | Promise<void>;
  status?(): SettingsSectionStatus | undefined | Promise<SettingsSectionStatus | undefined>;
}

export type SettingsSectionRegistration = SettingsSectionDescriptor & RegisteredSettingsSection;

export interface SettingsSectionsRegistry {
  version: typeof PROTOCOL_VERSION;
  /** Throws on a descriptor this build cannot render; the returned release is idempotent. */
  register(section: SettingsSectionRegistration): () => void;
  list(): SettingsSectionDescriptor[];
  read(id: string): Promise<SettingsReadResult | null>;
  apply(id: string, values: Record<string, unknown>): Promise<void>;
  status(id: string): Promise<SettingsSectionStatus | undefined>;
}

export type SettingsSectionsBootState = "idle" | "loading" | "ready" | "failed";

export interface WarmSettingsSectionsOptions {
  /** Read the extensions again after the first answer, as after a package install. */
  force?: boolean;
  /**
   * The folder whose project extensions load beside the user's global ones.
   * The user's home by default: both are where configuration lives.
   */
  cwd?: string;
}

interface BootState {
  state: SettingsSectionsBootState;
  loading: Promise<void> | null;
  /**
   * Held for the process: a section's handlers are closures of the extension
   * instance this loader created, so letting it go would leave a section the
   * dialog still lists with nothing behind it.
   */
  loader: unknown;
}

type GlobalScope = typeof globalThis & { [key: symbol]: unknown };

interface Registered extends SettingsSectionDescriptor {
  handlers: RegisteredSettingsSection;
}

function createRegistry(): SettingsSectionsRegistry {
  const sections = new Map<string, Registered>();

  return {
    version: PROTOCOL_VERSION,

    register(section) {
      if (section === null || typeof section !== "object") {
        throw new Error("A settings section registration must be an object");
      }
      const descriptor = normalizeSettingsSection(section);
      if (!descriptor) {
        const id = (section as { id?: unknown }).id;
        throw new Error(`Settings section "${String(id)}" is not one this build can render`);
      }
      if (typeof section.read !== "function") {
        throw new Error(`Settings section "${descriptor.id}" must implement read()`);
      }
      if (typeof section.apply !== "function") {
        throw new Error(`Settings section "${descriptor.id}" must implement apply(values)`);
      }
      if (section.status !== undefined && typeof section.status !== "function") {
        throw new Error(`Settings section "${descriptor.id}" must implement status() as a function`);
      }
      if (!sections.has(descriptor.id) && sections.size >= MAX_SETTINGS_SECTIONS) {
        throw new Error(`Settings sections are limited to ${MAX_SETTINGS_SECTIONS}; "${descriptor.id}" was not added`);
      }
      // Registering an id again replaces it, so a forced reload swaps in fresh closures.
      const registered: Registered = { ...descriptor, handlers: section };
      sections.set(descriptor.id, registered);
      return () => {
        if (sections.get(descriptor.id) === registered) sections.delete(descriptor.id);
      };
    },

    list() {
      return [...sections.values()].map(({ handlers, ...descriptor }) => {
        void handlers;
        return descriptor;
      });
    },

    async read(id) {
      const section = sections.get(id);
      return section ? await section.handlers.read() : null;
    },

    async apply(id, values) {
      const section = sections.get(id);
      if (!section) throw new Error(`Settings section "${id}" is not registered`);
      if (values === null || typeof values !== "object" || Array.isArray(values)) {
        throw new Error("Settings values must be an object");
      }
      await section.handlers.apply(values);
    },

    async status(id) {
      const section = sections.get(id);
      if (!section || typeof section.handlers.status !== "function") return undefined;
      return await section.handlers.status();
    },
  };
}

/** The process-wide registry, created once and kept across a hot reload. */
export function getSettingsSectionsRegistry(): SettingsSectionsRegistry {
  const scope = globalThis as GlobalScope;
  const key = Symbol.for(SETTINGS_SECTIONS_REGISTRY_KEY);
  const existing = scope[key] as SettingsSectionsRegistry | undefined;
  if (existing?.version === PROTOCOL_VERSION && typeof existing.register === "function") return existing;
  const registry = createRegistry();
  scope[key] = registry;
  return registry;
}

function bootState(): BootState {
  const scope = globalThis as GlobalScope;
  const key = Symbol.for(BOOT_STATE_KEY);
  const existing = scope[key] as BootState | undefined;
  if (existing !== undefined && typeof existing === "object") return existing;
  const created: BootState = { state: "idle", loading: null, loader: null };
  scope[key] = created;
  return created;
}

export function getSettingsSectionsBootState(): SettingsSectionsBootState {
  return bootState().state;
}

/** The loader kept alive above; a test reads it to see what the boot load found. */
export function getSettingsSectionsBootLoader(): unknown {
  return bootState().loader;
}

/**
 * Loads the extensions that can declare a section, at server start. Unawaited by
 * its caller: the dialog lists the built-in sections until this answers.
 *
 * Extensions only — no skills, prompts, themes, context files, model runtime or
 * session — so the price is one module import per installed extension.
 */
export function warmSettingsSections(options: WarmSettingsSectionsOptions = {}): Promise<void> {
  const boot = bootState();
  const force = options.force === true;
  if (boot.loading !== null) {
    // A forced read after the one in flight, so a package installed mid-load is seen.
    return force ? boot.loading.then(() => warmSettingsSections(options)) : boot.loading;
  }
  if (!force && (boot.state === "ready" || boot.state === "failed")) return Promise.resolve();

  boot.state = "loading";
  boot.loading = (async () => {
    // The registry must exist before the extensions run, or their factories find
    // nothing to register into and the section is silently lost.
    getSettingsSectionsRegistry();
    const sdk = await import("@earendil-works/pi-coding-agent");
    const agentDir = sdk.getAgentDir();
    const cwd = options.cwd ?? homedir();
    const loader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: sdk.SettingsManager.create(cwd, agentDir),
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      disabledBuiltinExtensions: [...SESSION_ONLY_BUILTINS],
    });
    await loader.reload();
    boot.loader = loader;
    const result = loader.getExtensions();
    const issues = (result.errors?.length ?? 0) + (result.warnings?.length ?? 0);
    if (issues > 0) console.warn(`[pi-web] ${issues} extension issue(s) while loading Settings sections`);
    boot.state = "ready";
  })()
    .catch((error: unknown) => {
      boot.state = "failed";
      console.warn(`[pi-web] could not load extensions for Settings: ${errorMessage(error)}`);
    })
    .finally(() => { boot.loading = null; });
  return boot.loading;
}
