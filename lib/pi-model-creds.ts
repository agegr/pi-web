// 默认模型凭证解析 —— 供 optimize / compress / select 共用的 SDK 解析逻辑。
//
// 抽取自 app/api/agents-md/optimize/route.ts，避免各处重复实现默认
// provider/model + apiKey/headers 的解析。服务侧使用（依赖 SDK）。

// 跟随上游重写（2026-08-02）：原 @/lib/pi 防腐层已被上游重构删除，
// 这里直接消费 SDK 的 SettingsManager / ModelRegistry / ModelRuntime（HEAD 范式），
// 保持基线干净、不复活被上游有意移除的共享设施。
import {
  SettingsManager,
  ModelRegistry,
  ModelRuntime,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

/** 凭证缺失/配置错误：调用方应将其映射为 4xx（而非 500），以保持 API 契约稳定。 */
export class ModelCredentialsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "ModelCredentialsError";
  }
}

/** 解析出的默认模型凭证。model 透传给 completeSimple。 */
export interface ModelCredentials {
  model: unknown;
  apiKey: string;
  headers: Record<string, string>;
  provider: string;
  modelId: string;
}

/** 解析当前默认 provider/model 及其 apiKey/headers（cwd 可选，用于 project 作用域）。 */
export async function resolveDefaultModelCredentials(cwd?: string): Promise<ModelCredentials> {
  const agentDir = getAgentDir();
  const mgr = SettingsManager.create(cwd ?? process.cwd(), agentDir);
  await mgr.reload();
  const defaultProvider = mgr.getDefaultProvider();
  const defaultModel = mgr.getDefaultModel();
  if (!defaultProvider || !defaultModel) {
    throw new ModelCredentialsError("No default model configured. Set one in Settings.");
  }

  const modelsPath = `${agentDir}/models.json`;
  const modelRuntime = await ModelRuntime.create();
  const registry = new ModelRegistry(modelRuntime);
  const model = registry.find(defaultProvider, defaultModel);
  if (!model)
    throw new ModelCredentialsError(`Model not found: ${defaultProvider}/${defaultModel}`);

  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new ModelCredentialsError(auth.error);
  if (!auth.apiKey) throw new ModelCredentialsError(`No API key for "${defaultProvider}"`);

  return {
    model,
    apiKey: auth.apiKey,
    headers: auth.headers ?? {},
    provider: defaultProvider,
    modelId: defaultModel,
  };
}
