// 系统提示词优化框架 —— 领域类型
// 本模块把散落在各处的系统提示词统一建模为可组合、可开关、可动态裁剪的
// 「提示词模块」。业务层（enhance / orchestrator / engine / coding-agent 的
// AGENTS.md）只依赖这些类型，不直接感知各来源的具体实现。

/** 模块来源：区分不同提示词归属，使开关 UI 与选择逻辑统一。 */
export type PromptSource = "app" | "agents-md" | "orchestrator" | "engine";

/** 模块分类：用于分组展示与选择策略打标签。 */
export type PromptCategory =
  | "identity"
  | "constraints"
  | "tone"
  | "output-format"
  | "grounding"
  | "examples"
  | "localization"
  | "safety"
  | "other";

/** 一个提示词模块（提示词的不可再分片段）。 */
export interface PromptModule {
  /** 稳定唯一标识，如 "enhance.do-not-execute"、"agents-md.security"。 */
  id: string;
  /** 来源域。 */
  source: PromptSource;
  /** 分类（分组展示 + 选择权重）。 */
  category: PromptCategory;
  /** 专业/任务标签，动态提交策略据此与用户输入匹配。 */
  tags: string[];
  /** 原始提示词文本。 */
  text: string;
  /** 可选标题（AGENTS.md 分段解析时记录 Markdown 标题，用于序列化还原）。 */
  heading?: string;
  /** 离线/LLM 压缩后的文本；compose 优先使用以节省 Token。 */
  compressedText?: string;
  /** 始终发送、不受开关/选择影响的强制模块（如「禁止执行」硬约束）。 */
  alwaysOn?: boolean;
  /** 估算 Token 数（estimateTokens），供 UI 展示与节省统计。 */
  estimatedTokens?: number;
}

/** compose 单入口选项。 */
export interface ComposeOptions {
  /** 仅聚合该来源的模块（不传则全部）。 */
  source?: PromptSource;
  /** 当前用户输入，用于动态提交策略匹配。 */
  userInput?: string;
  /** 上下文（如项目信息、对话历史摘要）。 */
  context?: string;
  /** 显式任务标签（可选，覆盖从 userInput 推导）。 */
  tags?: string[];
  /** 临时覆盖开关（如预览态），键为模块 id。 */
  enabledOverride?: Record<string, boolean>;
  /** 是否启用 LLM 选择精排（默认否，零额外调用）。 */
  useLlmSelect?: boolean;
}

/** 压缩结果。 */
export interface CompressResult {
  /** 压缩后文本。 */
  text: string;
  /** 压缩前字符数。 */
  charsBefore: number;
  /** 压缩后字符数。 */
  charsAfter: number;
  /** 压缩率（0~1），(before-after)/before。 */
  ratio: number;
  /** 是否使用了 LLM 通道（否则为离线规则压缩）。 */
  usedLlm: boolean;
}

/** 动态选择结果。 */
export interface SelectionResult {
  /** 选中（将发送）的模块，按相关度降序。 */
  selected: PromptModule[];
  /** 被跳过（不发送）的模块。 */
  skipped: PromptModule[];
  /** 压缩/选择前的 Token 总量。 */
  tokensBefore: number;
  /** 压缩/选择后的 Token 总量。 */
  tokensAfter: number;
  /** 节省的 Token 数。 */
  tokensSaved: number;
}
