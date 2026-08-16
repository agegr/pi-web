# 10_PiWeb — Docker 使用說明

> 本地 additions（`Dockerfile` / `docker-compose.yml` / 本文件）不屬於上游 repo，git 未追蹤。
> 上游：https://github.com/agegr/pi-web （v0.8.9，MIT）

## 快速開始

```powershell
cd C:\Tools\@@@@@@Antigravity\TigerAI-Methodology\04_RnD\10_PiWeb
copy .pi-web.env.example .pi-web.env    # 必填：密碼 + 公開域名（見「遠端存取」）
docker compose up -d --build     # 首次會 build 映像
# 缺 .pi-web.env 時 compose 會明確報錯（env file not found）——刻意如此，
# 不會帶著「無密碼/無域名」的不安全預設悄悄跑起來
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

本機用不用動。要給 LAN／外面連：改 `.pi-web.env`（不用動 compose）：

```ini
PI_WEB_PASSWORD=node -e 產生的長隨機密碼
# 走 Cloudflare Tunnel／反向代理時必填：精確的公開域名（逗號分隔可多個）
# 沒填時該域名的請求會被 403 擋掉——tunnel 通了也「打不進來」
PI_WEB_ALLOWED_HOSTS=pi.你的域名.com
```

改完 `docker compose up -d` 套用。⚠️ **env 變更要 recreate 容器才生效**——
只改檔案不重啟 = 容器還在用舊值（用 `docker exec pi-web env | grep PI_WEB` 確認）。

⚠️ 紀律：長隨機密碼、不要重用、只走 TLS（VPN／Cloudflare Tunnel）、能加 Cloudflare Access 就加（補 MFA + 稽核）。pi-web 的 Basic Auth 沒有 rate limit / MFA。

## 安全邊界（記得）

- 容器內 pi = 有 `/workspace` 和 `~/.pi/agent` 權限的完整 agent：能改掛載目錄的檔案、用裡面的 API key
- `~/.pi/agent` 掛進去 = 容器看得到所有 API key 和 session 歷史，只給信任的容器
- `/workspace` 是 read-write：容器內的寫入會直接改 host 檔案
- 跑不信任的 repo / 無人監督任務：把 `~/.pi/agent` 換成最小化的（只放必要 key）、專案用 read-only 或 copy-in/copy-out

## 進階：讓 agent 控制 host（權限與繞過）

agent 需要執行 host 指令 / 讀 host 檔案（例如遠端維護部署機）時，見
`docs/docker-host-bridge.md`：path bridge（容器內 symlink）+ ssh2 bridge
（pure-JS，不掛 docker.sock、密碼走環境變數），含 rebuild 復原 checklist。

## 排錯

| 症狀 | 處理 |
|---|---|
| 網頁連不上 | `docker compose logs -f` 看是否 Ready；確認 30141 沒被佔 |
| 權限錯誤（寫檔失敗）| compose 加 `user: "0"` 用 root 跑（權衡：較不隔離）|
| alpine 相容性問題（若有）| Dockerfile 改 `node:22-slim`（Debian 基底）|
| UI 看不到某個專案目錄 | 該目錄沒掛進容器 → 加 volume |

## 審查記錄

- 2026-08-15：上游 v0.8.9 源碼 + npm tarball 資安審查完成（無遙測／無資料外洩，認證最小化）→ 見 `04000_INDEX.md` 10_PiWeb 段
