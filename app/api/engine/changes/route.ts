import { NextResponse } from "next/server";
import { statSync } from "fs";
import { isAbsolute, resolve } from "path";
import { homedir } from "os";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import { allowFileRoot } from "@/lib/file-access";
import {
  registerDefaultEngine,
  getUnifiedEngineAdapter,
} from "@/lib/unified-engine/unified-engine-adapter";

const MAX_TITLE_LEN = 200;
const MAX_DESC_LEN = 2000;

/** 归一化 cwd：支持 ~ 与相对路径；非绝对路径按进程 cwd 解析。 */
function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

/**
 * 校验引擎工作目录（cwd）：
 * - 必须存在且为目录（杜绝路径穿越/任意目录写：join(cwd,...) 仅作用于真实存在的目录）；
 * - 解析为绝对路径后登记为允许根（allowFileRoot），使后续文件读取与交付物写入均受约束。
 * 失败抛出带说明的错误，由调用方转为 400。
 */
function assertSafeCwd(cwd: string): string {
  const normalized = normalizeCwd(cwd);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(normalized);
  } catch {
    throw new Error(`目录不存在：${cwd}`);
  }
  if (!stat.isDirectory()) throw new Error(`路径不是目录：${cwd}`);
  allowFileRoot(normalized);
  return normalized;
}

// POST /api/engine/changes  body: { title, description?, cwd }
// 创建一次自主编程变更（autoplan 需求 + comet change 二合一），返回 RunState。
export async function POST(req: Request) {
  const csrf = validateCsrf(req);
  if (csrf) return csrf;

  try {
    const [body, parseError] = await safeJsonBody<{
      title?: unknown;
      description?: unknown;
      cwd?: unknown;
    }>(req);
    if (parseError) return parseError;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const rawCwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const description = typeof body.description === "string" ? body.description : undefined;

    // 输入约束
    if (!title) return NextResponse.json({ error: "title 必填" }, { status: 400 });
    if (title.length > MAX_TITLE_LEN)
      return NextResponse.json(
        { error: `title 长度不能超过 ${MAX_TITLE_LEN} 字符` },
        { status: 400 },
      );
    if (description && description.length > MAX_DESC_LEN)
      return NextResponse.json(
        { error: `description 长度不能超过 ${MAX_DESC_LEN} 字符` },
        { status: 400 },
      );
    if (!rawCwd)
      return NextResponse.json(
        { error: "cwd 必填（项目根目录，comet 状态机工作目录）" },
        { status: 400 },
      );

    // 安全校验：cwd 必须为真实存在的目录，并登记为允许根（防任意目录写/路径穿越）
    const cwd = assertSafeCwd(rawCwd);

    registerDefaultEngine();
    const run = await getUnifiedEngineAdapter().createChange({ title, description, cwd });
    return NextResponse.json(run);
  } catch (error) {
    return errorResponse(error);
  }
}
