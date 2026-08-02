// comet-cli.ts —— 白名单调用 comet 的 .mjs 脚本（不可信供应链隔离）
// 规则：仅允许调用 ALLOWED_SCRIPTS 内的脚本；cwd 必须为绝对路径；带超时与参数约束。
// 绝不 import() 上游 comet-runtime.mjs（471KB 运行时），全部经 child_process 隔离执行。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveExecutable } from "../../allowed-commands";

const execFileAsync = promisify(execFile);

// 真实运行时代码位于 assets/skills/comet/scripts/，8 个 .mjs 为薄壳
const COMET_SCRIPTS_DIR = join(
  process.cwd(),
  "vendor",
  "comet",
  "assets",
  "skills",
  "comet",
  "scripts",
);

const ALLOWED_SCRIPTS = new Set<string>([
  "comet-state.mjs",
  "comet-guard.mjs",
  "comet-handoff.mjs",
  "comet-archive.mjs",
  "comet-yaml-validate.mjs",
  "comet-env.mjs",
]);

/** change 名白名单：仅允许字母数字、连字符、下划线、点；长度受限。 */
const CHANGE_NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const MAX_ARG_LEN = 1024;

/** 校验 comet change 名（杜绝任意目录写/路径穿越）。 */
export function assertChangeName(change: string): void {
  if (!CHANGE_NAME_RE.test(change)) {
    throw new Error(`非法 comet change 名：${change}`);
  }
}

/** 校验通用 CLI 参数：拒绝路径穿越、空字节、绝对路径、控制字符与超长。 */
function assertCliArg(arg: string): void {
  if (arg.length > MAX_ARG_LEN) throw new Error(`comet 参数过长：${arg.length}`);
  // 路径穿越 / 绝对路径 / 空字节。
  if (arg.includes("..") || arg.includes("\0") || arg.startsWith("/")) {
    throw new Error(`非法 comet 参数：${arg}`);
  }
  // 拒绝控制字符（除常见的空白外）。
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(arg)) {
    throw new Error(`非法 comet 参数（含控制字符）：${arg}`);
  }
}

export interface CometCliResult {
  stdout: string;
  code: number;
}

/** 以白名单方式生成 comet 脚本；任何越权或非法 cwd 直接拒绝。 */
export async function runCometScript(
  script: string,
  args: string[],
  cwd: string,
): Promise<CometCliResult> {
  if (!ALLOWED_SCRIPTS.has(script)) {
    throw new Error(`未授权的 comet 脚本：${script}`);
  }
  if (!cwd || !cwd.startsWith("/")) {
    throw new Error("comet 调用要求绝对路径 cwd");
  }
  // 约束 argv：change 名（args[1]）走白名单；其余参数拒绝路径穿越/空字节/绝对路径/控制字符。
  if (args.length >= 2) assertChangeName(args[1]);
  for (const a of args) assertCliArg(a);
  const scriptPath = join(COMET_SCRIPTS_DIR, script);
  try {
    // comet guard 的 build/verify 检查会跑 `npm run build` 验证项目可构建。
    // dev server 进程环境的 TURBOPACK/NODE_ENV 会让 `next build --webpack` 冲突失败，
    // 故仅在该环境下默认跳过 build 检查（comet 内置 COMET_SKIP_BUILD=1 逃生口）。
    // 生产环境（NODE_ENV=production 且无 TURBOPACK）默认允许 comet 跑真实构建验证；
    // 也可用 COMET_SKIP_BUILD 显式覆盖（0/1）。
    const explicit = process.env.COMET_SKIP_BUILD;
    const skipInDev = process.env.NODE_ENV === "development" || Boolean(process.env.TURBOPACK);
    const skipBuild = explicit ?? (skipInDev ? "1" : "0");
    const childEnv = skipBuild === "1" ? { ...process.env, COMET_SKIP_BUILD: "1" } : process.env;
    // 经共享白名单解析 node 可执行文件（M4：统一受控命令解析，杜绝任意二进制直调）。
    const nodeBin = resolveExecutable("node", cwd);
    const { stdout } = await execFileAsync(nodeBin, [scriptPath, ...args], {
      cwd,
      env: childEnv,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout.toString(), code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; code?: number };
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.toString();
    return { stdout: out, code: typeof err.code === "number" ? err.code : 1 };
  }
}

/** 读取 comet change 的单个字段（comet-state.mjs get <change> <field>） */
export async function cometGet(change: string, field: string, cwd: string): Promise<string> {
  assertChangeName(change);
  const { stdout, code } = await runCometScript("comet-state.mjs", ["get", change, field], cwd);
  if (code !== 0) return "";
  return stdout.trim();
}

/** comet 运行时是否可用：探测白名单守卫脚本是否存在。
 *  守卫真实化（PRD FR-4 / V4）据此区分「comet 未安装（降级放行，保证可演示）」与
 *  「comet 已安装但守卫拒绝/执行异常（必须阻断，绝不静默通过）」。 */
export function isCometAvailable(): boolean {
  return existsSync(join(COMET_SCRIPTS_DIR, "comet-guard.mjs"));
}
