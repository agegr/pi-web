# 0003: 宿主与伴随进程的端口分配与连接生命周期策略

## 状态
已决策 (Accepted)

## 背景 (Context)
在将 Next.js 生产服务器作为 Sidecar 子进程通过 Tauri 弹出式运行后，Tauri 窗口需要加载 Next.js 的本地主页才能开始运行。
这就需要解决两个核心通信与生命周期问题：
1. **端口冲突问题：** 如果用户的开发机器已经开了一个 `pi-web` 或其他程序占用了 `30141` 默认端口，应用便会崩溃。
2. **生命周期保活干净关闭：** 如果用户强行关掉了 Tauri 的窗口，如何确保在后台默默运行并监听端口的 Node.js 宿主服务进程被立即顺畅杀死，绝不残留多余的后台无主孤儿进程（Orphan Processes）造成物理开销和死锁。

## 决策 (Decision)
我们制定如下 **端口发现与生命周期协调策略**：
1. **动态端口寻址 (Dynamic Port Scanning)：**
   Tauri 主应用启动后，利用 Rust 原生网络套接字库扫描并锁定本地第一个空闲的可用端口（从 30141 开始向上搜寻，如搜到 30142 闲置则锁定它）。
2. **启动传参 Sidecar：**
   Tauri 调用命令拉起 `pi-web-backend.exe` 并向其注入环境变量 `PORT={发现的可用端口}`（或者传参 `-p {端口}`）。使 Node 服务总是动态适配到可用的通信端口上。
3. **安全自愈白屏：**
   Tauri 内部在载入 `http://localhost:{端口}` 前，会进入一个优雅的 Rust 加载动画窗体进行等候。在 Rust 主逻辑探测子端口网络畅通并成功响应 200 后，主 WebView 再一键切换、载入该地址，避免白屏报错。
4. **杀死孤儿的保护伞 (Orphan Prevention)：**
   * 在 Tauri 的 Rust 层监听窗口退出事件 (`tauri::RunEvent::ExitRequested`)，捕获并强制显式调用 `.kill()` 清理杀死 Node 子进程的 OS 句柄。
   * **第二重保险 (Node.js 侧)：** 在 Node.js 的 `bin/pi-web.js` 与服务端主干，监听 `process.on('disconnect')`。当检测到父进程 Tauri 的 IPC 管道断开（即 Tauri crash 或者意外断连），Node 自动调用 `process.exit(0)` 进行神圣的自我终结。

## 后果 (Consequences)
* 彻底杜绝了用户因为“端口抢占/无法启动”造成的黑屏或者白屏闪退。
* 保障了在 Windows 平台关闭窗口后，后台绝对没有任何多余的孤儿 Node 进程常驻耗电，具有极强的进程行为纯净度。
