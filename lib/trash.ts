// 会话回收站：删除的会话文件移入 ~/.pi/agent/trash/ 而非直接删除，
// 支持列出、恢复（回到原会话目录并还原文件名）与彻底删除。
import { mkdirSync, openSync, readSync, closeSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import { basename, isAbsolute, join, resolve } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readSessionHeader } from "./session-reader";

// 与 SDK getDefaultSessionDir 相同的 cwd 目录编码：--<cwd 中 / \ : 替换为 ->--
function sessionDirForCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(getAgentDir(), "sessions", safePath);
}

// trashSessionFile 写入的文件名前缀：ISO 时间戳（: 和 . 替换为 -），如 2025-07-31T16-35-00-000Z_
const TRASH_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_/;

export interface TrashedSession {
  /** 回收站内文件名（含删除时间戳前缀） */
  fileName: string;
  /** 原始文件名（还原时去掉前缀） */
  originalName: string;
  sessionId: string;
  /** 会话原所在目录（来自 session header） */
  cwd: string;
  /** 会话标题：首条 user 消息文本 */
  title: string;
  /** 最后更新时间（文件 mtime，rename 进回收站不会改变它） */
  modified: number;
}

export function getTrashDir(): string {
  // 与会话目录同源：getAgentDir 支持 PI_CODING_AGENT_DIR 覆盖，
  // 回收站必须跟随同一目录，否则删除与恢复会落到不同位置。
  return join(getAgentDir(), "trash");
}

/** 将会话文件移入回收站，文件名加时间戳前缀便于识别删除时间并避免同名冲突。 */
export function trashSessionFile(filePath: string): void {
  const trashDir = getTrashDir();
  mkdirSync(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  renameSync(filePath, join(trashDir, `${stamp}_${basename(filePath)}`));
}

// 提取首条 user 消息文本作为标题；解析失败时回退到 cwd。
// 只读取文件头部（首条 user 消息必在开头附近），避免全量读入含 base64 的大文件。
const MAX_TITLE_SCAN_BYTES = 512 * 1024;
function readTrashedTitle(filePath: string, fallback: string): string {
  try {
    const fd = openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(MAX_TITLE_SCAN_BYTES);
      const bytes = readSync(fd, buf, 0, MAX_TITLE_SCAN_BYTES, 0);
      const content = buf.toString("utf8", 0, bytes);
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        let entry: { type?: string; message?: { role?: string; content?: unknown } };
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry?.type === "message" && entry.message?.role === "user") {
          const c = entry.message.content;
          if (typeof c === "string") return c.trim() || fallback;
          if (Array.isArray(c)) {
            const text = c
              .map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text : ""))
              .join(" ")
              .trim();
            if (text) return text;
          }
        }
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    // 忽略损坏文件，使用回退标题
  }
  return fallback;
}

/** 列出回收站中的会话，按最后更新时间倒序。 */
export function listTrashedSessions(): TrashedSession[] {
  const trashDir = getTrashDir();
  let files: string[];
  try {
    files = readdirSync(trashDir);
  } catch {
    return [];
  }

  const result: TrashedSession[] = [];
  for (const fileName of files) {
    if (!fileName.endsWith(".jsonl")) continue;
    const filePath = join(trashDir, fileName);
    try {
      const header = readSessionHeader(filePath);
      if (!header?.id) continue;
      const stat = statSync(filePath);
      result.push({
        fileName,
        originalName: fileName.replace(TRASH_PREFIX_RE, ""),
        sessionId: header.id,
        cwd: header.cwd ?? "",
        title: readTrashedTitle(filePath, header.cwd || fileName),
        modified: stat.mtimeMs,
      });
    } catch {
      // 跳过无法读取的文件
    }
  }
  result.sort((a, b) => b.modified - a.modified);
  return result;
}

// 校验文件名只能指向回收站目录内的普通 jsonl 文件，防止路径穿越。
function assertTrashFileName(fileName: string): void {
  if (!fileName.endsWith(".jsonl") || basename(fileName) !== fileName) {
    throw new Error("Invalid trash file name");
  }
}

/** 将回收站中的会话恢复到原会话目录（~/.pi/agent/sessions/<编码cwd>/），还原原始文件名。 */
export function restoreTrashedSession(fileName: string): { restoredPath: string; sessionId: string } {
  assertTrashFileName(fileName);
  const trashPath = join(getTrashDir(), fileName);
  const header = readSessionHeader(trashPath);
  if (!header?.id || !header.cwd) {
    throw new Error("无法读取会话信息，文件可能已损坏");
  }
  // pi 写入的 cwd 一定是绝对路径；相对路径会被 resolve 解析到意外位置，防御性拒绝
  if (!isAbsolute(header.cwd)) {
    throw new Error("会话原目录无效（非绝对路径）");
  }
  const originalName = fileName.replace(TRASH_PREFIX_RE, "");
  // 使用与 pi 相同的 cwd 编码规则定位原会话目录，保证恢复位置和原文件一致。
  const sessionDir = sessionDirForCwd(header.cwd);
  const restoredPath = join(sessionDir, originalName);
  // renameSync 会静默覆盖目标文件，恢复前必须确认原位置不存在同名会话。
  let exists = false;
  try {
    statSync(restoredPath);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (exists) throw new Error(`原位置已存在同名会话，请先处理该文件：${restoredPath}`);
  mkdirSync(sessionDir, { recursive: true });
  renameSync(trashPath, restoredPath);
  return { restoredPath, sessionId: header.id };
}

/** 从回收站彻底删除（不可恢复）。 */
export function purgeTrashedSession(fileName: string): void {
  assertTrashFileName(fileName);
  unlinkSync(join(getTrashDir(), fileName));
}

/** 清空回收站中的全部会话文件（不可恢复）。只删除 .jsonl，保留手动放入的其它文件。 */
export function clearTrashedSessions(): number {
  const trashDir = getTrashDir();
  let files: string[];
  try {
    files = readdirSync(trashDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const fileName of files) {
    if (!fileName.endsWith(".jsonl")) continue;
    try {
      unlinkSync(join(trashDir, fileName));
      removed += 1;
    } catch {
      // 单个文件删除失败不影响其余文件
    }
  }
  return removed;
}
