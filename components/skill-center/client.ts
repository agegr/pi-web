import type { Installation, Classification, CheckResult } from "@/lib/skill-center/types";

export async function centerRequest<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/skill-center/${path}`, { method, signal, cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (response.status === 401) throw new Error("登录已过期，请重新认证后查询原操作，勿重复提交安装。");
  const json = response.headers.get("content-type")?.includes("application/json");
  const data = json ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error?.message ? `${data.error.message}（${data.error.code} · ${data.error.requestId}）` : `请求未完成（HTTP ${response.status}），请重试读取。`);
  if (!json) throw new Error("服务返回了无法读取的响应，请重试读取。");
  return data as T;
}
export type DomainFilter = { domainId: string | null; categoryId: string | null; classificationState: "all" | "unclassified" };
export const allDomains: DomainFilter = { domainId: null, categoryId: null, classificationState: "all" };
export function matchesDomain(c: Classification, filter: DomainFilter) {
  return (filter.classificationState !== "unclassified" || c.state === "unclassified") && (!filter.domainId || c.assignments.some(a => a.domainId === filter.domainId && (!filter.categoryId || a.categoryId === filter.categoryId)));
}
export const loadLabels: Record<Installation["loadState"], string> = { effective: "已加载", shadowed: "同名遮蔽", excluded: "配置排除", untrusted: "未信任", invalid: "解析失败", unknown: "未确认" };
export const updateLabels: Record<CheckResult["state"] | "unchecked" | "checking", string> = { "up-to-date": "已是最新", "update-available": "可更新", unsupported: "不支持", error: "检查失败", unchecked: "未检查", checking: "检查中" };
export const scopeLabel = (scope: string) => ({ project: "当前项目", global: "全局", shared: "多个位置", other: "自定义位置" }[scope] ?? scope);
export const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);

export function matchesInstallationQuery(item: Installation, query: string) {
  const value = query.trim();
  if (value.startsWith("instance:")) return item.installationId === value.slice("instance:".length);
  if (/^(?:skills\.sh|skillsmp|agentskill\.sh):/.test(value)) return item.canonicalSkillId === value;
  return [item.name, item.description, item.source].some(text => text?.toLowerCase().includes(value.toLowerCase()));
}
