"use strict";

// Node 的 fetch 默认不会读取 HTTP_PROXY/HTTPS_PROXY。Pi 的 SSE 回退请求
// 使用全局 fetch，因此在 Pi Web 子进程启动时安装 undici 代理调度器。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const undici = require("undici");
const { EnvHttpProxyAgent, setGlobalDispatcher } = undici;

const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const noProxy = process.env.NO_PROXY || process.env.no_proxy;

if (httpProxy || httpsProxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy }));
  // Keep fetch on the same undici implementation as the dispatcher. This is
  // also what Pi Agent does in its own CLI bootstrap.
  undici.install?.();
}
