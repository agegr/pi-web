import { createHash } from "node:crypto";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { getSkillCenterConfig } from "./config";
import { requireValue } from "./errors";
import { safeRelative } from "./relative-path";
import type { SourceSkill, VersionIdentity } from "./types";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export interface SkillBundle { skill: SourceSkill; files: Array<{ path: string; content: string; encoding?: "base64" }>; version: VersionIdentity }
export function validateBundle(skill: SourceSkill, input: unknown): SkillBundle {
  const config = getSkillCenterConfig();
  requireValue(Array.isArray(input) && input.length > 0 && input.length <= config.maxTreeEntries, "INVALID_SKILL_BUNDLE", "技能文件包为空或文件数量超限。", 422);
  const seen = new Set<string>(); let bytes = 0;
  const files = input.map(value => {
    const raw = object(value); const path = safeRelative(raw.path);
    // Windows aliases and alternate streams must never overwrite another bundle member.
    requireValue(!/[<>"|?*]/.test(path) && path.split("/").every(p => !/[. ]$/.test(p) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)), "INVALID_SKILL_BUNDLE", "文件包包含不安全文件名。", 422);
    const key = path.toLowerCase();
    requireValue(!seen.has(key) && typeof raw.content === "string", "INVALID_SKILL_BUNDLE", "文件包包含重复路径或无效文件内容。", 422);
    seen.add(key);
    requireValue(raw.encoding === undefined || raw.encoding === "base64", "INVALID_SKILL_BUNDLE", "未知文件编码。", 422);
    const binary = raw.encoding === "base64";
    const buffer = Buffer.from(raw.content, binary ? "base64" : "utf8");
    requireValue(binary ? buffer.toString("base64") === raw.content : !raw.content.includes("\0"), "INVALID_SKILL_BUNDLE", "文件编码无效。", 422);
    bytes += buffer.length;
    requireValue(buffer.length <= config.maxTextBytes && bytes <= config.maxBundleBytes, "INVALID_SKILL_BUNDLE", "文件包超过大小限制。", 422);
    return { path, content: raw.content, ...(binary ? { encoding: "base64" as const } : {}) };
  }).sort((a,b) => a.path.localeCompare(b.path));
  const nodes = new Set<string>();
  for (const path of seen) { const parts = path.split("/"); for (let n = 1; n <= parts.length; n++) nodes.add(parts.slice(0,n).join("/")); }
  requireValue(nodes.size <= config.maxTreeEntries, "INVALID_SKILL_BUNDLE", "文件包超过目录数量限制。", 422);
  for (const path of seen) { const segments = path.split("/"); while (segments.length > 1) { segments.pop(); requireValue(!seen.has(segments.join("/")), "INVALID_SKILL_BUNDLE", "文件与目录路径发生冲突。", 422); } }
  const entry = files.find(f => f.path === "SKILL.md");
  requireValue(entry && !entry.encoding, "INVALID_SKILL_BUNDLE", "文件包缺少文本格式的根 SKILL.md。", 422);
  const { frontmatter } = parseFrontmatter<Record<string,unknown>>(entry.content);
  requireValue(typeof frontmatter.name === "string" && /^[\w.-]+(?:::[\w.-]+)*$/.test(frontmatter.name) && typeof frontmatter.description === "string" && frontmatter.description.trim(), "INVALID_SKILL_BUNDLE", "SKILL.md 缺少有效名称或用途说明。", 422);
  return { skill: { ...skill, name: frontmatter.name, description: frontmatter.description, metadataState: "ready" }, files, version: { kind: "provider-content-hash", label: "技能文件包 SHA-256", value: hash(JSON.stringify(files)) } };
}
