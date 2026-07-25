/** 初始化 Node.js 服务端运行时，输出首启 token 并配置服务端请求代理。
 * @returns 初始化完成的 Promise。
 * @throws 认证模块或请求代理初始化失败时抛出错误。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { announceSetupToken } = await import("@/lib/pi-web-auth");
  announceSetupToken();
  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();
}
