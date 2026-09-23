import { spawn } from "child_process";
import { isIP } from "net";

const FILE_MANAGER_BY_PLATFORM = new Map<string, string>([
  ["win32", "explorer.exe"],
  ["darwin", "open"],
  ["linux", "xdg-open"],
]);

/** 该平台是否有可用的文件管理器命令。 */
export function isFileManagerSupported(platform: string): boolean {
  return FILE_MANAGER_BY_PLATFORM.has(platform);
}

/**
 * 构造在系统文件管理器中打开目录的命令。
 * @param platform Node 的 process.platform 取值
 * @param target 要打开的目标路径
 * @returns 命令与参数，平台不支持时返回 null
 */
export function fileManagerCommand(
  platform: string,
  target: string,
): { command: string; args: string[] } | null {
  const command = FILE_MANAGER_BY_PLATFORM.get(platform);
  return command ? { command, args: [target] } : null;
}

/**
 * 请求的 Host 是否指向本机。
 *
 * 注意：Host 头由客户端提供、可以伪造，所以这不是访问控制，只是可用性护栏，
 * 挡的是“手机等远程访问时点了按钮，却弹出服务器上的窗口”这种困惑。
 * 真实防线是服务默认只绑 127.0.0.1（`dev:lan` / `start:lan` 才会对外暴露）
 * 以及调用方的路径白名单。缺少 Host 头时按不可信处理。
 * @param host Host 头
 * @returns 是否为回环地址
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  const closingBracket = normalized.indexOf("]");
  const name = normalized.startsWith("[") && closingBracket !== -1
    ? normalized.slice(1, closingBracket)
    : normalized.split(":")[0];
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (name === "::1") return true;
  return isIP(name) === 4 && name.startsWith("127.");
}

/**
 * 让系统文件管理器打开目录。
 * @param target 要打开的目录（调用方负责校验权限）
 * @param platform Node 的 process.platform 取值
 * @returns 命令成功启动后 resolve
 */
export function launchFileManager(
  target: string,
  platform: string = process.platform,
): Promise<void> {
  const spec = fileManagerCommand(platform, target);
  if (!spec) return Promise.reject(new Error(`Unsupported platform: ${platform}`));
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { detached: true, stdio: "ignore" });
    // explorer.exe 打开成功时也可能返回退出码 1，因此只以能否启动为准。
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
