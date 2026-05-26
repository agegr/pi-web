# 0001: 选择 基于 Tauri 作为客户端桌面包装方案

## 状态
已决策 (Accepted)

## 背景 (Context)
我们决定将以 Next.js 和 Node.js 为驱动的 `pi-web` 打包为能够在 Windows 上独立双击安装并启动的 `.exe` 应用。在交互形态中选择“A. 独立桌面窗体”，我们面临着两个主流技术选型：
1. **Electron：** 集成 Chromium 与高容量的 Node.js 主进程环境。缺点是分发包体巨大（>100MB），且内存占用极高。
2. **Tauri：** 使用 Rust 编写，调用操作系统的原生 WebView（Windows 上为 WebView2）。包体极小（<15MB），内存极其轻盈。

由于本项目专注于极简、快响应、高性能的终端助手定位，巨型多余开销的 Electron 显得不合时宜，Tauri 成了最靓丽和被期望的打包容器方案。

## 决策 (Decision)
我们选择使用 **Tauri** 作为桌面客户端壳体 (Client-Shell) 方案。
但是，由于本项目后端具有显著的 Node.js 库（例如 `@earendil-works/pi-coding-agent`）依赖、文件读写 API、SSE 事件流实现，而 Tauri 本身目前无法原生、无缝地在同一个进程内承载这套复杂 Node.js 与 Next.js 服务。

因此：
**我们将采用 “Tauri + Node.js 伴随进程 (Sidecar)” 架构：**
1. 桌面端启动时，通过 Tauri 的 Rust 核心机制以 **Sidecar 伴随子进程** 的形式启动我们的后端 Node.js 服务。
2. 后端服务监听在本地随机或指定端口（如 `30141`）。
3. Tauri 本身的 WebView 窗口作为纯前端壳体，直接载入本地 `http://localhost:30141` 路由，从而为用户提供无缝、轻盈、纯粹的本地窗口界面。
4. 捕获 Tauri 窗口关闭事件，保证伴随 Node 进程被干净地清理杀死。

## 后果 (Consequences)
* 能够获得极佳的安装包尺寸（预计只有 15MB ~ 30MB 左右）。
* 极低的空闲系统内存占用。
* 能够无缝兼容和运行我们已有的 Next.js 生产服务端，开发人员不需要用 Rust 彻底重写后台 RpcManager。
* 打包构建时需要两步工作：第一步打包 Node 服务为单个可执行程序以作为伴随进程，第二步构建 Tauri 安装包。
