// Token 估算 —— 纯确定性启发式，便于单测与展示。
// 真实分词依赖模型词表，这里用「字符数 / 4」作为跨模型近似（中英文混合场景下
// 与 GPT 类分词器偏差较小，足以用于节省量对比与 UI 展示）。

/** 估算一段文本的 Token 数（确定性：相同输入恒得相同输出）。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(0, Math.ceil(text.length / 4));
}

/** 把 Token 数格式化为 k / M 短串（与 lib/format-token-count 一致）。 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}
