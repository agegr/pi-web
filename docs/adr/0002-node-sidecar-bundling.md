# 0002: NextJS 服务端编译成单二进制 Sidecar 方案

## 状态
已决策 (Accepted)

## 背景 (Context)
要让 Tauri 在启动时拉起 Next.js 服务端，我们需要将这个 Node.js 应用程序编译编译成一个无须电脑预装 Node 的独立 `.exe` 二进制伴随进程 (Sidecar)。
Next.js 通常在构建时生成巨大的 `.next/` 文件夹并强烈依赖外界的 `node_modules/`，这在直接使用 `pkg` 打包时常常会因为静态资源寻址（如 `public` 目录或 `.next` 模块解析）引发各种奇葩路径错误。

## 决策 (Decision)
我们采用 **Next.js 官方 Standalone 构建** 并配合 **pkg** 编译封装：
1. **配置 Next.js 独立输出模式：** 
   在 `next.config.ts` (或 `next.config.js`) 中开启自动精简打包配置：
   ```typescript
   // next.config.ts
   import type { NextConfig } from "next";
   const nextConfig: NextConfig = {
     output: "standalone"
   };
   export default nextConfig;
   ```
2. **运行构建编译：**
   执行 `npm run build`。此时，Next.js 会在 `.next/standalone/` 生成一个极度紧凑、**将所有必要的 node_modules 全部通过 webpack 混淆压缩进同级服务体** 的极简 Node 状态。它不需要原来笨重的 `node_modules`，仅占用非常小的体积！
3. **配合 Vercel pkg 打包二进制：**
   编写极简的 `pkg` 配置文件或者执行 `pkg .next/standalone/server.js -o sidecars/pi-web-backend-x86_64-pc-windows-msvc.exe --targets node18-win-x64`（或对应宿主架构），让它变成一个可以被 Tauri 完美的 Sidecar 调用的纯正单 Windows 二进制 EXE 进程。

## 后果 (Consequences)
* **无缝运行保障：** Next.js 项目的代码、API、WebSocket（如果有）等会作为原生的 Standalone Server 完美在后台运行。
* **文件体积极限压缩：** 精简了生产环境 node_modules 后，后台压缩出的 sidecar 只有十几到几十 MB 不等。
* **静态资源分包维护：** Next.js 的静态前端部分 (`.next/static` 以及原本的 `public` 文件夹) 还是需要存放在外层。由于它们不需要被打包进 exe 去编译，我们可以将它们直接作为 Tauri 框架中主窗体读取的前端资产，而后台 API 仅作为纯无状态 RPC 交互。
