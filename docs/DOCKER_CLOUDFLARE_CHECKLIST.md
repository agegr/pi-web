# pi-web Docker 與 Cloudflare Tunnel 檢查核對清單

> 適用情境：另一台機器已安裝 Docker，但 `https://<網域>` 無法連到 pi-web。
>
> Docker 只負責執行容器；要從 Internet 連入，還必須有正常的 pi-web、Cloudflare Tunnel、Public Hostname 與網路路徑。

## 先填寫本機資料

- [ ] 公開網域：`________________________`（例：`pi02.example.com`）
- [ ] pi-web 主機 LAN IP：`________________________`（例：`192.168.1.87`）
- [ ] pi-web port：`30141`
- [ ] cloudflared 跑在哪台主機：`________________________`
- [ ] Cloudflare Tunnel 名稱：`________________________`

## 1. Docker 是否正常

```bash
docker --version
docker compose version
docker info >/dev/null && echo "Docker OK"
```

- [ ] 三個指令都成功
- [ ] 執行帳號有權限操作 Docker

若出現 `permission denied`，先處理 Docker socket 權限；這不是 Cloudflare 問題。

## 2. pi-web 容器是否啟動

在 `pi-web` 專案目錄執行：

```bash
docker compose ps
docker compose logs --tail=100 pi-web
```

- [ ] `pi-web` 狀態是 `Up` 或 `running`
- [ ] 沒有持續重啟（Restarting）
- [ ] log 沒有啟動失敗、port 衝突或權限錯誤
- [ ] port 顯示類似 `0.0.0.0:30141->30141/tcp`

若未啟動：

```bash
docker compose up -d --build
docker compose logs --tail=100 pi-web
```

## 3. pi-web 環境變數是否正確

以下指令只檢查變數是否存在，不輸出密碼內容：

```bash
docker compose exec pi-web sh -lc '
  printf "PI_WEB_HOSTNAME=%s\n" "$PI_WEB_HOSTNAME"
  printf "PI_WEB_ALLOWED_HOSTS=%s\n" "$PI_WEB_ALLOWED_HOSTS"
  if [ -n "$PI_WEB_PASSWORD" ]; then echo "PI_WEB_PASSWORD=SET"; else echo "PI_WEB_PASSWORD=MISSING"; fi
'
```

- [ ] `PI_WEB_HOSTNAME=0.0.0.0`
- [ ] `PI_WEB_ALLOWED_HOSTS` 包含公開網域（不含 `https://` 和路徑）
- [ ] 顯示 `PI_WEB_PASSWORD=SET`

修改 Compose 或 `.pi-web.env` 後必須重建容器：

```bash
docker compose up -d --force-recreate
```

## 4. 先測試 pi-web 本機服務

將下方網域換成實際公開網域：

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
  -H 'Host: pi02.example.com' \
  http://127.0.0.1:30141/
```

判讀：

- [ ] `401`：正常，服務已到達且 Basic Auth 正在保護頁面
- [ ] `200`：服務可達，但請確認是否有啟用認證
- [ ] `403`：`PI_WEB_ALLOWED_HOSTS` 沒包含公開網域
- [ ] `Connection refused`：容器未啟動、未發布 port，或程式未監聽 `0.0.0.0`
- [ ] Timeout：檢查主機防火牆、路由與 IP

也可確認 port：

```bash
ss -ltn | grep ':30141'
```

## 5. 確認 Cloudflare Tunnel 的部署方式

只能至少符合下面一種架構。

### A. cloudflared 在同一台機器

```bash
docker ps --format '{{.Names}}\t{{.Image}}' | grep cloudflared
```

- [ ] cloudflared 容器正在運行
- [ ] Tunnel origin 可設定為 `http://<本機 LAN IP>:30141`
- [ ] 若兩個容器加入同一個 Docker network，也可使用 `http://pi-web:30141`

### B. cloudflared 在另一台中央主機

在 **cloudflared 所在主機** 測試：

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
  -H 'Host: pi02.example.com' \
  http://192.168.1.87:30141/
```

- [ ] 回傳 `401` 或 `200`
- [ ] 使用的是 pi-web 主機的正確 LAN IP，不是舊機器 IP
- [ ] 兩台機器之間的 VLAN、防火牆或路由允許 TCP 30141

如果這一步不通，Cloudflare 一定也不會通；先修內網路徑。

## 6. Cloudflare Public Hostname 是否存在

在 Cloudflare Zero Trust Dashboard 的 Tunnel 設定中核對：

- [ ] Tunnel 狀態為 `HEALTHY`
- [ ] Public Hostname 是正確網域，例如 `pi02.example.com`
- [ ] Service Type 是 `HTTP`
- [ ] Service URL 是正確來源，例如 `http://192.168.1.87:30141`
- [ ] 沒有誤用 `https://` 連到只提供 HTTP 的 30141
- [ ] 每台機器使用不同網域，或已有明確的路由規則

注意：複製 Docker Compose 到新機器，不會自動新增或修改 Cloudflare Public Hostname。

## 7. cloudflared 是否收到最新設定

在 cloudflared 所在主機執行：

```bash
docker logs --tail=200 cloudflare 2>&1 | \
  grep -E 'Registered tunnel connection|Updated to new configuration|Unable to reach the origin|error='
```

如果容器名稱不是 `cloudflare`，先用 `docker ps` 找出名稱再替換。

- [ ] 出現 `Registered tunnel connection`
- [ ] 最新 configuration 包含新網域與正確 IP/port
- [ ] 沒有 `Unable to reach the origin service`
- [ ] 若設定沒有更新，安全地重啟 cloudflared 容器後再查 log

請勿把 Tunnel token、完整啟動命令或未遮罩的 log 貼到公開聊天室。

## 8. 從外部測試 DNS 與 HTTPS

最好使用手機行動網路或不在同一 LAN 的設備：

```bash
nslookup pi02.example.com
curl -I https://pi02.example.com/
```

- [ ] DNS 查詢成功
- [ ] HTTPS 沒有憑證錯誤
- [ ] `401` 代表已成功到達 pi-web 登入驗證
- [ ] `403` 優先檢查 `PI_WEB_ALLOWED_HOSTS`
- [ ] Cloudflare `502` 優先檢查 origin IP、port、容器狀態與防火牆
- [ ] Cloudflare `1033` 優先檢查 Tunnel 是否在線

## 9. 登入與 Agent 資料

- [ ] Basic Auth 使用者名稱固定為 `pi`
- [ ] 使用該機器設定的 `PI_WEB_PASSWORD`
- [ ] 宿主機 `~/.pi/agent` 存在
- [ ] Compose 已掛載至 `/home/node/.pi/agent`
- [ ] 專案目錄已掛載至容器內 `/workspace`（或自訂工作目錄）

```bash
docker inspect pi-web --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
```

宿主機不需要另外安裝 `pi` CLI；Pi Agent SDK 已包含在 pi-web 容器套件中。宿主機的 `~/.pi/agent` 是設定、認證及 session 資料，不代表已安裝 CLI。

## 回報結果範本

請把以下結果回報給管理者，所有 token、密碼與 API key 必須遮罩：

```text
公開網域：
pi-web 主機 IP：
cloudflared 主機 IP：
docker compose ps：PASS / FAIL
本機 curl 狀態碼：
cloudflared 主機 curl 狀態碼：
Tunnel 狀態：HEALTHY / DOWN / UNKNOWN
Public Hostname origin：
外部 curl 狀態碼：
相關錯誤（已遮罩敏感資料）：
```

## 快速判斷順序

```text
容器 Up？
  → 本機 curl 通？
    → cloudflared 主機 curl 到 origin 通？
      → Tunnel Healthy？
        → Public Hostname 指向正確 IP:30141？
          → 外部 DNS/HTTPS 通？
```

不要跳步：第一個失敗的步驟，通常就是問題所在。
