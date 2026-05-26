# Pi-Web 领域概念与技术设计文档

## 📖 核心词汇表 (Domain Glossary)

* **Host-Process (宿主服务进程)：** 运行 Node.js 运行时和 Next.js 生产服务器后端（包括 RpcManager 消息流控制、本地文件读写、SSE 路由）的进程。
* **Client-Shell (客户端壳体)：** 供用户交互的视窗载体。在本方案中为由 **Tauri** 建立的原生轻量窗体（Windows 上使用的是 Microsoft Edge WebView2 渲染内核）。
* **Sidecar (伴随/子进程)：** Tauri 的原生机制，允许主程序安全拉起并维护一个独立的二进制辅助进程。在本方案中，指被打包成单文件二进制的 Node.js/Next.js 后端服务。
* **Local-Toolchain (本地工具链)：** 本机上安装的开发工具（Git、Node/Npm、编译器等）。无论是何种打包方案，都必须继承并安全调用操作系统的本地开发工具链。
* **Dynamic Port Scanning (动态端口搜寻避让)：** 运行时检测操作系统可用空闲网络套接字端口的机制，用于防止两款应用或两个实例抢占 `30141` 默认端口导致故障。
* **Orphan Prevention (孤儿伴随进程自杀与清理机制)：** 客户端退出或崩溃时，确保维护的后台子二进制程序不会残留后台，通过 Rust-kill 和 Node-ipc 断开监听双重保障进行内存清理。
