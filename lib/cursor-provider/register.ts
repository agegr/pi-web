import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  type ExtensionAPI,
  type InlineExtension,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  generateCursorAuthParams,
  getTokenExpiry,
  pollCursorAuth,
  refreshCursorToken,
} from "./auth";
import {
  FALLBACK_MODELS,
  processModels,
  toProviderModelConfig,
  type CursorModel,
} from "./models";
import {
  accountCacheKey,
  cleanupSessionState,
  cursorModelCacheIsFresh,
  getCursorModels,
  loadCachedModels,
  streamCursor,
} from "./stream";

export const CURSOR_PROVIDER_ID = "cursor";

type RegisterProvider = (
  providerId: string,
  config: ReturnType<typeof buildCursorProviderConfig>,
) => void;

function buildCursorProviderConfig(
  rawModels: CursorModel[],
) {
  return {
    name: "Cursor",
    baseUrl: "https://api2.cursor.sh",
    api: "openai-completions" as const,
    models: processModels(rawModels).map(toProviderModelConfig),
    streamSimple: streamCursor,
    oauth: {
      name: "Cursor (Pro/Ultra/Teams)",
      isSubscription: true,
      async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
        const { verifier, uuid, loginUrl } = await generateCursorAuthParams();
        callbacks.onAuth({ url: loginUrl, instructions: "" });
        const credentials = await pollCursorAuth(
          uuid,
          verifier,
          callbacks.signal,
        );
        return {
          refresh: credentials.refreshToken,
          access: credentials.accessToken,
          expires: getTokenExpiry(credentials.accessToken),
        };
      },
      async refreshToken(
        credentials: OAuthCredentials,
        signal: AbortSignal,
      ): Promise<OAuthCredentials> {
        return refreshCursorToken(credentials.refresh, signal);
      },
      getApiKey(credentials: OAuthCredentials): string {
        return credentials.access;
      },
    },
  };
}

export function readStoredCursorAccessToken(
  authPath = join(getAgentDir(), "auth.json"),
): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const cursor = (parsed as Record<string, unknown>).cursor;
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    const access = (cursor as Record<string, unknown>).access;
    return typeof access === "string" && access ? access : undefined;
  } catch {
    return undefined;
  }
}

function initialModels(authPath?: string): CursorModel[] {
  const token = readStoredCursorAccessToken(authPath);
  if (!token) return FALLBACK_MODELS;
  return loadCachedModels(accountCacheKey(token)) ?? [];
}

function registerCursor(
  registerProvider: RegisterProvider,
  options: { authPath?: string; models?: CursorModel[] } = {},
): void {
  registerProvider(
    CURSOR_PROVIDER_ID,
    buildCursorProviderConfig(
      options.models ?? initialModels(options.authPath),
    ),
  );
}

export function registerCursorProvider(
  runtime: ModelRuntime,
  authPath?: string,
): void {
  registerCursor((providerId, config) => runtime.registerProvider(providerId, config), {
    authPath,
  });
}

export async function refreshCursorProviderModels(
  runtime: ModelRuntime,
  signal: AbortSignal,
  discover: typeof getCursorModels = getCursorModels,
): Promise<boolean> {
  const resolved = await runtime.getAuth(CURSOR_PROVIDER_ID, { signal });
  if (!resolved?.auth.apiKey) return false;
  if (
    runtime.getModels(CURSOR_PROVIDER_ID).length > 0
    && cursorModelCacheIsFresh(resolved.auth.apiKey)
  ) {
    return false;
  }
  const models = await discover(resolved.auth.apiKey, signal);
  registerCursor(
    (providerId, config) => runtime.registerProvider(providerId, config),
    { models },
  );
  return true;
}

export function createCursorProviderExtension(): InlineExtension {
  return {
    name: "pi-web-cursor-provider",
    hidden: true,
    factory(pi: ExtensionAPI) {
      registerCursor((providerId, config) => {
        pi.registerProvider(providerId, config);
      });

      const cleanup = (ctx: { sessionManager: { getSessionId(): string } }) => {
        cleanupSessionState(ctx.sessionManager.getSessionId());
      };
      pi.on("session_before_switch", (_event, ctx) => cleanup(ctx));
      pi.on("session_before_fork", (_event, ctx) => cleanup(ctx));
      pi.on("session_before_tree", (_event, ctx) => cleanup(ctx));
      pi.on("session_shutdown", (_event, ctx) => cleanup(ctx));
      pi.on("model_select", (event, ctx) => {
        if (event.source === "restore") return;
        const leftCursor = event.previousModel?.provider === CURSOR_PROVIDER_ID;
        const enteredCursor = event.model?.provider === CURSOR_PROVIDER_ID;
        if (leftCursor !== enteredCursor) cleanup(ctx);
      });
    },
  };
}
