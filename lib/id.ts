// id.ts —— 统一 ID / slug 生成工具
// 消除 unified-engine 各模块（unified-engine-runtime / autoplan-adapter /
// autoplan-llm-adapter）重复实现 uid / slug 的问题，集中维护、便于审计。
// 纯函数、无副作用，可在服务端与客户端共用。

/** 生成带前缀的随机 ID（base36，8 字符）。 */
export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 将标题转换为 URL/文件名友好的 slug（小写、连字符、最长 32 字符）。 */
export function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "change"
  );
}
