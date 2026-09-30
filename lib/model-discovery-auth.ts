import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface ModelDiscoveryAuth {
  apiKey?: string;
  headers: Record<string, string>;
  /**
   * Effective upstream base URL: the models.json value when present, otherwise
   * pi's own provider catalog. This is what lets discovery work for a provider
   * entry that only lists models and relies on the built-in endpoint, and for
   * providers that pi ships without a models.json entry at all.
   */
  baseUrl?: string;
  /** Effective API protocol, needed to build the protocol-correct model list URL. */
  api?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function resolveModelDiscoveryAuth(
  providerName: string,
  provider: Record<string, unknown>,
): Promise<ModelDiscoveryAuth> {
  let tempDir: string | undefined;
  try {
    tempDir = mkdtempSync(join(tmpdir(), "pi-web-model-discovery-"));
    const modelsPath = join(tempDir, "models.json");
    const discoveryModelId = "__pi_web_model_discovery__";
    writeFileSync(modelsPath, JSON.stringify({
      providers: {
        [providerName]: {
          ...provider,
          models: [{ id: discoveryModelId }],
        },
      },
    }, null, 2), "utf8");

    const modelRuntime = await ModelRuntime.create({ modelsPath });
    const loadError = modelRuntime.getError();
    if (loadError) throw new Error(loadError);
    const model = modelRuntime.getModel(providerName, discoveryModelId);
    if (!model) throw new Error(`Unable to load provider "${providerName}"`);

    // Compose the provider the same way pi does: an entry without a baseUrl or
    // api (built-in provider, or a models-only override) still resolves to the
    // endpoint and protocol pi ships for that provider.
    const baseUrl = model.baseUrl?.trim()
      || modelRuntime.getProvider(providerName)?.baseUrl?.trim()
      || undefined;
    const api = model.api ?? modelRuntime.getModels(providerName)[0]?.api;

    const resolved = await modelRuntime.getAuth(model);
    if (resolved) {
      return {
        apiKey: resolved.auth.apiKey,
        headers: stringRecord(resolved.auth.headers),
        baseUrl,
        api,
      };
    }

    return {
      headers: stringRecord(modelRuntime.getCompatibilityRequestConfig(model).headers),
      baseUrl,
      api,
    };
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
