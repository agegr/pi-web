# 10_PiWeb — Docker 使用說明

> 本地 additions（`Dockerfile` / `docker-compose.yml` / 本文件）不屬於上游 repo。
> 上游：https://github.com/agegr/pi-web （v0.8.9，MIT）

## 快速開始

```bash
cd /home/wrt/AG/SystemRepair/pi-web
docker compose up -d --build     # 首次會 build 映像
# 瀏覽器開 http://127.0.0.1:30141 或 https://pi01.xxx.com
```

日常：

```bash
docker compose up -d             # 啟動（映像已 build）
docker compose logs -f           # 看 log（出現 Ready 即可用）
docker compose down              # 停止
docker compose pull && docker compose up -d --build   # 更新 pi-web
```

## 它怎麼運作

- 映像 = `node:22-alpine` + `npm install -g @agegr/pi-web@latest`（package 內含預編譯 Next.js，無 build step）
- 容器內 pi-web 共用 host 的 `~/.pi/agent`（session、模型設定、API key），跟 TUI pi 同一份資料
- 預設綁 `0.0.0.0`（容器內必需），對外由 30141 映射

## 掛載（volumes）

| Host | Container | 用途 |
|---|---|---|
| `${HOME}/.pi/agent` | `/home/node/.pi/agent` | pi 設定 + session + auth |
| `/home/wrt/AG/SystemRepair` | `/workspace` | agent 要操作的專案目錄 |

要讓 agent 操作其他目錄，就在 compose 的 `volumes` 加一列，網頁 UI 的 cwd 選單裡就會出現。

## 遠端存取與 Cloudflare Tunnel 配置

給 LAN／Cloudflare Tunnel 對外連線時，請設定以下環境變數（已整合於 `docker-compose.yml` 或 `.pi-web.env`）：

```yaml
environment:
  PI_WEB_HOSTNAME: "0.0.0.0"
  PI_WEB_NO_OPEN: "1"
  PI_WEB_ALLOWED_HOSTS: "pi01.xxx.com"
  # 注意：docker-compose.yml 內密碼若含 $ 字元，務必寫成 $$ 避免 Compose 變數展開
  PI_WEB_PASSWORD: "your_complex_password_here"
```

⚠️ **注意與重點**:
- **認證 User**：`pi-web` 的 Basic Auth 使用者名稱固定為 **`pi`**（寫死於 `lib/web-auth.ts`），請勿輸入 `admin` 或其他帳號。
- **Host Header 白名單**：走 Cloudflare Tunnel（如 `pi01.xxx.com`）時，必須將該域名填入 `PI_WEB_ALLOWED_HOSTS`，否則會回傳 `403 Forbidden`。
- **`$` 轉義**：在 `docker-compose.yml` 中，`$` 符號會被 Compose 解析為變數展開，務必使用 `$$` 轉義。
- **Recreate 生效**：修改環境變數後須執行 `docker compose up -d` 重建容器以套用新設定。

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

## 相關文件與架構設計

- 🛠️ [INSTALL_GUIDE.md](./INSTALL_GUIDE.md) — 完整安裝與 Cloudflare 配置步驟
- ⚡ [STARTUP.md](./STARTUP.md) — 快速啟動與維護指令
- 👤 [USER_GUIDE.md](./USER_GUIDE.md) — 使用者登入與帳密說明
- 📐 [docs/SDD-docker-cloudflare-setup.md](./docs/SDD-docker-cloudflare-setup.md) — 系統設計與問題取捨
- 📜 [docs/dev.log.md](./docs/dev.log.md) — 開發歷史與踩坑記錄
- 💡 [LESSONS_LEARNED.md](./LESSONS_LEARNED.md) — 跨專案經驗與教訓
