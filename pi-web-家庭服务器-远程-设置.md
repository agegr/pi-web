# pi-web 家庭服务器 + 远程访问方案

> 使用旧笔记本（X230/X220）作为家庭服务器，通过 Cloudflare Tunnel 实现外网访问 pi-web。

---

## 目录

1. [整体架构](#1-整体架构)
2. [服务组件](#2-服务组件)
3. [本地反向代理：Caddy + 密码保护](#3-本地反向代理caddy--密码保护)
4. [远程隧道：Cloudflare Tunnel](#4-远程隧道cloudflare-tunnel)
5. [紧急后门：Tailscale VPN](#5-紧急后门tailscale-vpn)
6. [服务器硬件与系统选择](#6-服务器硬件与系统选择)
   - [硬件评估](#61-硬件评估)
   - [系统选择（Ubuntu/Lubuntu/Windows）](#62-系统选择)
   - [Docker 还是直接跑](#63-docker还是直接跑)
   - [从 Win7 安装 Ubuntu Server](#64-从-win7-安装-ubuntu-server)
   - [Ubuntu 初始化（安装组件）](#65-ubuntu-初始化安装组件)
7. [日常操作命令](#7-日常操作命令)
8. [故障恢复流程](#8-故障恢复流程)

---

## 1. 整体架构

```
外网 (手机 4G / 公司电脑)
    │
    ├── HTTPS ── Cloudflare Edge ── Cloudflare Tunnel ──┐
    │                                                   │
    └── Tailscale VPN (紧急备用) ───────────────────────┐
                                                        │
                                              ┌─────────▼──────────┐
                                              │   家庭路由器 / 光猫    │
                                              └─────────┬──────────┘
                                                        │
                                              ┌─────────▼──────────┐
                                              │  X230 家庭服务器      │
                                              │                      │
                                              │  Tailscale (SSH 后门)│
                                              │  Caddy (8080, 密码)  │
                                              │  cloudflared (隧道)  │
                                              │  pi-web (30141)     │
                                              └──────────────────────┘
```

### 三层防护

| 层 | 组件 | 作用 |
|---|---|---|
| 传输加密 | Cloudflare Tunnel | HTTPS 自动加密，不暴露家庭 IP |
| 访问控制 | Caddy Basic Auth | 用户名 + 密码验证 |
| 备用通道 | Tailscale | pi-web 崩溃时的 SSH 紧急入口 |

---

## 2. 服务组件

| 组件 | 版本 | 端口 | 说明 |
|---|---|---|---|
| **pi-web** | 0.6.12-dev | 30141 | Web UI（Node.js 22） |
| **Caddy** | v2.9.1 | 8090 | 反向代理 + Basic Auth 密码保护 |
| **cloudflared** | 2026.5.2 | - | Cloudflare Tunnel 客户端 |
| **Tailscale** | 最新 | - | VPN，用于 SSH 紧急管理 |

---

## 3. 本地反向代理：Caddy + 密码保护

### 3.1 下载 Caddy

```bash
# 下载到 C:\caddy\
curl -L -o caddy.exe "https://caddyserver.com/api/download?os=windows&arch=amd64"
```

### 3.2 生成密码哈希

```bash
C:\caddy\caddy.exe hash-password --plaintext "你的密码"
# 输出: $2a$14$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3.3 创建 Caddyfile

`C:\caddy\Caddyfile`：

```nginx
:8090 {
    basic_auth {
        admin $2a$14$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    }
    reverse_proxy localhost:30141
}
```

**多用户配置**：

```nginx
:8090 {
    basic_auth {
        admin  $2a$14$...哈希...
        张三   $2a$14$...哈希...
        李四   $2a$14$...哈希...
    }
    reverse_proxy localhost:30141
}
```

### 3.4 启动 Caddy

```bash
C:\caddy\caddy.exe run --config C:\caddy\Caddyfile
```

### 3.5 改密码

```bash
# 1. 生成新哈希
C:\caddy\caddy.exe hash-password --plaintext "新密码"

# 2. 替换 Caddyfile 里的哈希
# 3. 重启 Caddy
taskkill /F /IM caddy.exe
C:\caddy\caddy.exe run --config C:\caddy\Caddyfile
```

---

## 4. 远程隧道：Cloudflare Tunnel

### 4.1 下载 cloudflared

```bash
curl -L -o cloudflared.exe "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
```

### 4.2 Quick Tunnel（免账号模式）

```bash
cloudflared.exe tunnel --url http://localhost:8090
```

启动后会输出：

```
Your quick Tunnel has been created! Visit it at:
https://xxxx-xxxx-xxxx-xxxx.trycloudflare.com
```

**特点**：
- ✅ 不需要账号
- ✅ 自动 HTTPS
- ⚠️ 每次重启进程 URL 会变
- ⚠️ 无可用性保证
- ⚠️ 不能绑定自定义域名

> **断网重连 URL 不会变**：只要 cloudflared 进程不重启，URL 保持不变。

### 4.3 启动脚本（推荐）

`C:\caddy\start-tunnel.cmd`：

```batch
@echo off
cd /d C:\caddy
cloudflared.exe tunnel --url http://localhost:8090
pause
```

双击运行，窗口里会显示 URL。

### 4.4 命名隧道（固定 URL，需要域名）

如果需要固定地址：

```bash
# 1. 注册 Cloudflare 账号
# 2. 买域名（推荐 Cloudflare 直接买，成本价续费不涨价）
#    最便宜：.icu / .cyou / .click ≈ ¥21/年

# 3. 创建命名隧道
cloudflared tunnel login
cloudflared tunnel create pi-web

# 4. 配置文件 ~/.cloudflared/config.yml
tunnel: pi-web
credentials-file: C:\Users\xxx\.cloudflared\pi-web.json
ingress:
  - hostname: pi.你的域名.com
    service: http://localhost:8090
  - service: http_status:404

# 5. 绑定域名
cloudflared tunnel route dns pi-web pi.你的域名.com

# 6. 启动
cloudflared tunnel run pi-web
```

**域名价格参考**（Cloudflare 成本价，续费不涨）：

| 域名 | 每年价格 |
|---|---|
| `.icu` | ≈¥21 |
| `.cyou` | ≈¥21 |
| `.click` | ≈¥22 |
| `.link` | ≈¥29 |
| `.xyz` | ≈¥30 |

> 建议 Cloudflare 直接买域名，DNS 托管和隧道一站式搞定。

---

## 5. 紧急后门：Tailscale VPN

### 5.1 为什么需要

```
Cloudflare Tunnel → Caddy → pi-web
```

如果 pi-web 崩了、API 没额度、配置出错，Cloudflare 隧道在也没用。需要一条**不依赖 pi-web 的后门通道**。

### 5.2 安装 Tailscale

**Ubuntu/Linux**：

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

**手机/其他电脑**：应用商店搜索 Tailscale 安装，登录同一账号。

### 5.3 使用场景

```
手机 4G ── Tailscale ── SSH → X230 (100.x.x.x)
```

pi-web 挂了以后：

```
1. 手机打开 Tailscale App
2. SSH 进 X230（Tailscale 分配的 IP）
3. 修复问题
4. systemctl restart pi-web
```

---

## 6. 服务器硬件与系统选择

### 6.1 硬件评估

| 硬件 | 说明 |
|---|---|
| **机型** | X230 / X220 |
| **CPU** | i5-3320M / i5-2520M（完全够用） |
| **内存** | 8GB（足够） |
| **存储** | 建议 SSD |

### 6.2 系统选择

| 系统 | 桌面 | 开机 RAM | 说明 |
|---|---|---|---|
| **Windows 7** | ✅ Aero | ~1GB | ❌ Node.js v22 不支持，最高 v18（已 EOL） |
| **Windows 10/11** | ✅ | ~2GB | ❌ X230 跑起来略卡，长期开机不稳定 |
| **Ubuntu Desktop** | GNOME（重） | ~1.5-2GB | ❌ 资源消耗大，X230 勉强能跑 |
| **Lubuntu** | LXQt（轻量） | ~300-400MB | ⚠️ 比 Ubuntu 流畅，但当服务器用不需要桌面 |
| **Ubuntu Server 24.04 LTS** | ❌ 无 | **~100-200MB** | ✅ **推荐**，支持到 2029 年 |
| **Debian 12** | ❌ 无 | ~100MB | ✅ 稳定，配置稍复杂 |

#### Lubuntu vs Ubuntu 的区别

| 方面 | Ubuntu Desktop | Lubuntu | Ubuntu Server |
|---|---|---|---|
| **桌面环境** | GNOME（重） | LXQt（轻量） | **无桌面** |
| **开机 RAM** | ~1.5-2GB | ~300-400MB | **~100-200MB** |
| **X230 流畅度** | 勉强 | 流畅 | **丝滑** |
| **适合场景** | 日常桌面用 | 老旧电脑桌面 | **24h 服务器** |

#### 建议：装 Ubuntu Server，不要装桌面

这台机器是**服务器**，不是日常电脑。装桌面 = 浪费 300MB+ 内存 + CPU 渲染界面，而你平时不会接显示器用，全是 SSH 远程管理。

**如果想偶尔当笔记本用**：装 Ubuntu Server 后手动装 LXQt，需要用桌面时再启动，不用就不加载：

```bash
sudo apt install lxqt
startx   # 需要桌面时再启动
```

### 6.3 Docker？还是直接跑？

| 系统 | 结论 |
|---|---|
| **Windows 7** | ❌ Node.js v22 不支持 Win7，最高只到 v18（已 EOL） |
| **Windows 10/11** | ✅ 但 X230 跑 Win10 略卡，长期开机不稳定 |
| **Ubuntu Server 24.04 LTS** | ✅ **推荐**，支持到 2029 年 |
| **Debian 12** | ✅ 稳定，配置稍复杂 |

### 6.3 Docker？还是直接跑？

| 方式 | 内存占用 | 运维复杂度 | 升级便利性 |
|---|---|---|---|
| **直接跑（推荐）** | ~150MB | 简单 | 简单 |
| **Docker** | ~400MB | 需要挂载卷、处理权限 | 略复杂 |

X230 只有 8GB 内存，**直接跑更省资源**。

### 6.4 从 Win7 安装 Ubuntu Server

#### 6.4.1 下载 Ubuntu Server ISO

在 X230（当前 Win7）上操作：

```bash
# 用浏览器打开 https://ubuntu.com/download/server
# 点击 Download Ubuntu Server 24.04 LTS
# 保存到桌面
```

或者用迅雷/IDM 直接下（更快）：

```
https://releases.ubuntu.com/24.04/ubuntu-24.04.2-live-server-amd64.iso
```

> 文件约 2.6GB，建议用有线网络下载。

#### 6.4.2 制作启动 U 盘

需要：一个 **8GB+ 的 U 盘**（里面的数据会被清空）。

1. 下载 **Rufus**：https://rufus.ie/ （免费，绿色软件，亲测 Win7 兼容）
2. 插入 U 盘
3. 打开 Rufus：
   - 设备：选中你的 U 盘
   - 引导类型选择：点 **选择** → 找刚才下载的 `ubuntu-24.04.2-live-server-amd64.iso`
   - 分区类型：**GPT**
   - 目标系统类型：**UEFI（非 CSM）**
   - 其他默认，点 **开始** → 确定 → 等待完成（约 5 分钟）

> X230 默认是 Legacy BIOS 启动，如果你没改过，分区类型选 **MBR**、目标系统选 **BIOS or UEFI-CSM**。
> 不确定的话进 BIOS（开机按 F1）→ Security → Secure Boot → Disable，然后 Config → 查看启动模式。

#### 6.4.3 BIOS 设置

X230 开机按 **F1** 进 BIOS：

```
Config → Serial ATA (SATA) → AHCI（如果装了 SSD 建议开）
Security → Secure Boot → Disabled
Startup → Boot Mode → 根据需要选 Legacy 或 UEFI
Startup → Boot → USB HDD 调到第一位
F10 → Yes 保存退出
```

#### 6.4.4 安装 Ubuntu Server

1. 插上 U 盘，开机从 U 盘启动
2. 选择 **Try or Install Ubuntu Server**
3. 语言：**English**（终端里中文可能有乱码）
4. 键盘布局：默认 **English (US)**
5. 网络配置：有线一般自动 DHCP，WiFi 需要手动连
6. 代理（Proxy）：**留空**，直接 Continue
7. 镜像源（Mirror）：默认 `archive.ubuntu.com`（国内可以改 `mirrors.ustc.edu.cn` 或 `mirrors.aliyun.com` 加速）
8. 磁盘分区：选 **Use An Entire Disk** → 选你的 SSD/硬盘 → Continue（确认会清空全部数据）
9. 用户名和密码：
   - Your name：随便填
   - Your server's name：**pi-server**（或其他）
   - Pick a username：**pi**（SSH 时用这个）
   - Password：设一个强密码（记下来！）
   - Confirm your password：再输一次
10. SSH 配置：**勾选 Install OpenSSH server**（重要！不然后面没法远程连）
11. 等待安装完成（约 5-10 分钟，取决于 U 盘速度）
12. 提示 **Reboot Now** → 拔掉 U 盘 → 回车

重启后用你设的账号密码登录：

```bash
# 登录成功后会看到类似
pi@pi-server:~$
```

#### 6.4.5 安装后基础配置

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 检查 IP 地址
ip addr
# 记下来（比如 192.168.1.100），后面 SSH 要用

# （可选）国内加速：改镜像源
sudo sed -i 's/archive.ubuntu.com/mirrors.ustc.edu.cn/g' /etc/apt/sources.list
sudo sed -i 's/security.ubuntu.com/mirrors.ustc.edu.cn/g' /etc/apt/sources.list
```

现在你可以合上盖子，从你自己的电脑/手机 SSH 进来继续配置了。

---

### 6.5 Ubuntu 初始化（安装组件）

```bash
# 装 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# 装 pi-web
sudo npm install -g @agegr/pi-web

# 下载 Caddy
sudo apt install -y debian-keyring debian-archive-keyring
curl -1sLf 'https://dl.cloudflare.com/cloudflare-main.gpg' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudflare.com/caddy-stable.deb' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# 下载 cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# 装 Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

---

## 7. 日常操作命令

### 7.1 启动顺序

```bash
# 1. pi-web
pi-web

# 2. Caddy（密码验证）
# Linux:
sudo systemctl start caddy
# Windows:
C:\caddy\caddy.exe run --config C:\caddy\Caddyfile

# 3. Cloudflare Tunnel
cloudflared tunnel run pi-web    # 命名隧道
# 或
C:\caddy\cloudflared.exe tunnel --url http://localhost:8090  # Quick Tunnel
```

### 7.2 升级

```bash
# pi-web
sudo npm update -g @agegr/pi-web
sudo systemctl restart pi-web

# Caddy（Linux）
sudo apt update && sudo apt upgrade caddy

# cloudflared
# 下载新版本替换二进制
```

---

## 8. 故障恢复流程

### 场景：API 没额度 / pi-web 崩了

```
1. 手机打开 Tailscale App（确保连上）
2. 用 SSH 客户端连接：
     ssh user@100.x.x.x    # Tailscale IP
3. 检查问题：
     systemctl status pi-web
     journalctl -u pi-web -n 50
4. 修复（换 API Key / 改配置）
5. 重启：
     sudo systemctl restart pi-web
6. 验证本地访问：
     curl http://localhost:30141
7. 通过 Cloudflare 隧道再次访问
```

### 场景：Cloudflare 隧道断了

```
1. 通过 Tailscale SSH 进服务器
2. 检查 cloudflared 进程
     ps aux | grep cloudflared
3. 重启：
     cloudflared tunnel run pi-web
4. 获取新 URL（如果是 Quick Tunnel）
```
