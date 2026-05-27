export interface TestConnectionModelLike {
  id?: string;
}

export interface TestConnectionProviderLike {
  modelId?: string;
  models?: TestConnectionModelLike[];
}

export function pickTestModelId(provider: TestConnectionProviderLike): string | null {
  const firstConfiguredModelId = provider.models?.find((model) => typeof model.id === "string" && model.id.trim().length > 0)?.id?.trim();
  if (firstConfiguredModelId) return firstConfiguredModelId;

  const providerLevelModelId = provider.modelId?.trim();
  if (providerLevelModelId) return providerLevelModelId;

  return null;
}
