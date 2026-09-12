import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { samePath } from "../paths";
import { setDisableModelInvocation as preserveVisibility } from "../skill-frontmatter";
import { getSkillCenterConfig } from "./config";
import { CenterError, requireValue } from "./errors";
import { readJson, saveJson, stateDir } from "./journal";
import type { Scope, VersionIdentity } from "./types";
import { validateBundle, type SkillBundle } from "./bundle";

export type NativeBundle = SkillBundle;
interface NativeRecord { canonical: string; name: string; source: string; target: string; scope: Scope; contextId: string | null; version: VersionIdentity }
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const recordPath = (target: string) => join(getAgentDir(), "skill-center", `native-${hash(process.platform === "win32" ? resolve(target).toLowerCase() : resolve(target))}.json`);

export function nativeFileBytes(file: NativeBundle["files"][number]) {
  requireValue(typeof file.content === "string" && (file.encoding === undefined || file.encoding === "base64"), "INVALID_BUNDLE", "技能文件编码无效。", 422);
  const buffer = Buffer.from(file.content, file.encoding === "base64" ? "base64" : "utf8");
  requireValue(file.encoding === "base64" ? buffer.toString("base64") === file.content : !file.content.includes("\0"), "INVALID_BUNDLE", "技能文件内容与编码不符。", 422);
  return buffer;
}

/** A file bundle never supplies absolute paths, links, or executable installation hooks. */
export function validateNativeBundle(bundle: NativeBundle) {
  try {
    const normalized = validateBundle(bundle.skill, bundle.files);
    requireValue(normalized.skill.name === bundle.skill.name, "INVALID_BUNDLE", "技能名称与文件包身份不一致。", 422);
    return bundle;
  } catch (error) {
    if (error instanceof CenterError) throw new CenterError(422, "INVALID_BUNDLE", error.message);
    throw error;
  }
}

export function nativeTarget(scope: Scope, cwd: string | null, name: string) {
  const folder = name.toLowerCase().replace(/[^a-z0-9._]+/g, "-").replace(/^[.\-]+|[.\-]+$/g, "").slice(0, 255);
  requireValue(folder && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder), "INVALID_BUNDLE", "技能名称不能映射为安装目录。", 422);
  return join(scope === "global" ? getAgentDir() : join(cwd!, ".pi"), "skills", folder, "SKILL.md");
}

export function nativeRecord(target: string): NativeRecord | null {
  try {
    const record = readJson<NativeRecord>(recordPath(target));
    if (!record || !/^(?:agentskill\.sh|skillsmp):.+$/.test(record.canonical) || !samePath(record.target, target) || !existsSync(target) || !samePath(realpathSync(target), target) || !record.version?.value || record.version.kind !== "provider-content-hash" || !["project", "global"].includes(record.scope)) return null;
    return record;
  } catch { return null; }
}

/** Complete tree fingerprint, rejecting links before reading their targets. */
export function nativeTree(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  let count = 0;
  function walk(dir: string, prefix = "") {
    requireValue(!lstatSync(dir).isSymbolicLink(), "FORBIDDEN_PATH", "原生技能目录包含链接，不能覆盖。", 403);
    for (const name of readdirSync(dir).sort()) {
      requireValue(++count <= getSkillCenterConfig().maxTreeEntries, "INVALID_BUNDLE", "技能目录超过检查数量限制。", 422);
      const path = join(dir, name); const stat = lstatSync(path); const relative = prefix + name;
      requireValue(!stat.isSymbolicLink(), "FORBIDDEN_PATH", "原生技能目录包含链接，不能覆盖。", 403);
      if (stat.isDirectory()) walk(path, `${relative}/`);
      else {
        requireValue(stat.isFile(), "FORBIDDEN_PATH", "技能目录存在非普通文件。", 403);
        requireValue(stat.size <= getSkillCenterConfig().maxTextBytes, "INVALID_BUNDLE", "本地技能文件超过检查大小限制。", 422);
        result[relative] = hash(readFileSync(path));
      }
    }
  }
  walk(root);
  return result;
}

export function writeNativeBundle(bundle: NativeBundle, target: string, scope: Scope, contextId: string | null, beforeTree: Record<string, string | undefined> | null, hidden: boolean | null) {
  validateNativeBundle(bundle);
  const root = dirname(target); const parent = dirname(root);
  mkdirSync(parent, { recursive: true });
  requireValue(samePath(realpathSync(parent), parent), "FORBIDDEN_PATH", "技能安装父目录已被链接替换。", 403);
  const present = existsSync(root);
  requireValue(beforeTree ? present && nativeRecord(target)?.canonical === bundle.skill.canonicalSkillId : !present, "TARGET_CONFLICT", "技能安装目标已变化，不能覆盖。", 409);
  const stage = join(parent, `.pi-skill-stage-${randomUUID()}`);
  const backup = join(parent, `.pi-skill-backup-${randomUUID()}`);
  mkdirSync(stage);
  let moved = false;
  try {
    for (const file of bundle.files) {
      const path = join(stage, file.path); mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, nativeFileBytes(file), { flag: "wx", mode: 0o600 });
    }
    // Preserve the local visibility preference before the directory becomes visible.
    if (hidden !== null) {
      const entry = join(stage, "SKILL.md");
      const text = bundle.files.find(f => f.path === "SKILL.md")!.content;
      writeFileSync(entry, preserveVisibility(text, hidden), "utf8");
    }
    if (beforeTree) {
      const actual = nativeTree(root);
      requireValue(Object.keys(actual).length === Object.keys(beforeTree).length && Object.entries(actual).every(([path, revision]) => beforeTree[path] === revision), "REVISION_CONFLICT", "技能文件在预检后被修改。", 409);
      renameSync(root, backup); moved = true;
    } else requireValue(!existsSync(root), "TARGET_CONFLICT", "技能安装目录已存在。", 409);
    renameSync(stage, root);
    stateDir();
    saveJson(recordPath(target), { canonical: bundle.skill.canonicalSkillId, name: bundle.skill.name, source: bundle.skill.source, target, scope, contextId, version: bundle.version } satisfies NativeRecord);
    if (moved) rmSync(backup, { recursive: true });
  } catch (error) {
    // If promotion did not happen, restore the original complete directory.
    if (moved && !existsSync(root) && existsSync(backup)) renameSync(backup, root);
    throw error;
  } finally {
    if (existsSync(stage) && basename(stage).startsWith(".pi-skill-stage-") && samePath(dirname(stage), parent)) rmSync(stage, { recursive: true });
  }
}
