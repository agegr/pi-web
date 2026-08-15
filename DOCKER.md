# 10_PiWeb — Docker 使用說明

> 本地 additions（`Dockerfile` / `docker-compose.yml` / 本文件）不屬於上游 repo，git 未追蹤。
> 上游：https://github.com/agegr/pi-web （v0.8.9，MIT）

## 快速開始

```powershell
cd C:\Tools\@@@@@@Antigravity\TigerAI-Methodology\04_RnD\10_PiWeb
docker compose up -d --build     # 首次會 build 映像
# 瀏覽器開 http://127.0.0.1:30141
```

日常：

```powershell
docker compose up -d             # 啟動（映像已 build）
docker compose logs -f           # 看 log（出現 Ready 即可用）
docker compose down              # 停止
docker compose pull && docker compose up -d --build   # 更新 pi-web
```

## 它怎麼運作

- 映像 = `node:22-alpine` + `npm install -g @agegr/pi-web@latest`（package 內含預編譯 Next.js，無 build step）
- 容器內 pi-web 共用 host 的 `~/.pi/agent`（session、模型設定、API key），跟 TUI pi 同一份資料
- 預設綁 `0.0.0.0`（容器內必需），對外只有 `127.0.0.1:30141` 一個映射

## 掛載（volumes）

| Host | Container | 用途 |
|---|---|---|
| `C:/Users/yesin/.pi/agent` | `/home/node/.pi/agent` | pi 設定 + session + auth |
| `C:/Tools/.../TigerAI-Methodology` | `/workspace` | agent 要操作的專案（自行改）|

要讓 agent 操作其他目錄，就在 compose 的 `volumes` 加一列，網頁 UI 的 cwd 選單裡就會出現。

## 遠端存取（可選）

本機用不用動。要給 LAN／外面連：

```yaml
environment:
  PI_WEB_PASSWORD: "node -e 產生的長隨機密碼"
  # 走 Cloudflare Tunnel 時：
  # PI_WEB_ALLOWED_HOSTS: "pi.你的域名.com"
```

⚠️ 紀律：長隨機密碼、不要重用、只走 TLS（VPN／Cloudflare Tunnel）、能加 Cloudflare Access 就加（補 MFA + 稽核）。pi-web 的 Basic Auth 沒有 rate limit / MFA。

## 安全邊界（記得）

- 容器內 pi = 有 `/workspace` 和 `~/.pi/agent` 權限的完整 agent：能改掛載目錄的檔案、用裡面的 API key
- `~/.pi/agent` 掛進去 = 容器看得到所有 API key 和 session 歷史，只給信任的容器
- `/workspace` 是 read-write：容器內的寫入會直接改 host 檔案
- 跑不信任的 repo / 無人監督任務：把 `~/.pi/agent` 換成最小化的（只放必要 key）、專案用 read-only 或 copy-in/copy-out

## 排錯

| 症狀 | 處理 |
|---|---|
| 網頁連不上 | `docker compose logs -f` 看是否 Ready；確認 30141 沒被佔 |
| 權限錯誤（寫檔失敗）| compose 加 `user: "0"` 用 root 跑（權衡：較不隔離）|
| alpine 相容性問題（若有）| Dockerfile 改 `node:22-slim`（Debian 基底）|
| UI 看不到某個專案目錄 | 該目錄沒掛進容器 → 加 volume |

## 審查記錄

- 2026-08-15：上游 v0.8.9 源碼 + npm tarball 資安審查完成（無遙測／無資料外洩，認證最小化）→ 見 `04000_INDEX.md` 10_PiWeb 段
