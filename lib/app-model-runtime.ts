import {
  ModelRuntime,
  type CreateModelRuntimeOptions,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import {
  CURSOR_PROVIDER_ID,
  createCursorProviderExtension,
  refreshCursorProviderModels,
  registerCursorProvider,
} from "./cursor-provider/register";

const MODEL_CATALOG_REFRESH_TIMEOUT_MS = 8_000;
const CURSOR_MODEL_CATALOG_ERROR = "Cursor model list is temporarily unavailable. Check your connection and try again.";

export async function createAppModelRuntime(
  options?: CreateModelRuntimeOptions,
): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create(options);
  registerCursorProvider(runtime, options?.authPath);
  return runtime;
}

export function getAppModelExtensions(): InlineExtension[] {
  return [createCursorProviderExtension()];
}

export async function refreshAppModelCatalogs(
  runtime: ModelRuntime,
  providerId?: string,
): Promise<string | undefined> {
  if (providerId && providerId !== CURSOR_PROVIDER_ID) return undefined;
  try {
    await refreshCursorProviderModels(
      runtime,
      AbortSignal.timeout(MODEL_CATALOG_REFRESH_TIMEOUT_MS),
    );
    return undefined;
  } catch (error) {
    console.error(
      "[cursor-provider] Model discovery failed:",
      error instanceof Error ? error.message : error,
    );
    return CURSOR_MODEL_CATALOG_ERROR;
  }
}
