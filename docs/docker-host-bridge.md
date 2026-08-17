# Docker 容器內的 agent 控制 host — 權限問題與繞過方法

> 背景：pi-web 的 pi agent 跑在容器內（`node:22-alpine`）。agent 的 bash tool 與檔案操作
> 預設只能看到「容器世界」——當任務要動到 host（執行 host 指令、讀 host 檔案、管 host 的
> docker）時，會碰到三面權限牆。本文是實測過的一套繞過方法。

## 三面權限牆（症狀）

| # | 症狀 | 原因 |
|---|---|---|
| 1 | bash tool 報 cwd 不存在、指令起不來 | harness 的工作目錄是 **host 路徑**（如 `/home/wrt/TigerAI`），容器內沒有這個路徑 |
| 2 | `command not found: ssh / curl` 等 | alpine 映像只有 `ash` + node，沒有 bash/ssh/curl 等 host 常備二進位（bash tool 本身可借 ash 跑，POSIX 指令沒問題） |
| 3 | 看不到 host 檔案 | 容器只看得到掛進去的 volumes |

## 解法 A：path bridge — 容器內 symlink（解牆 #1）

工作目錄已掛載（host `/home/wrt/TigerAI` → 容器 `/workspace`）。在**容器內**為 host 路徑
建 symlink，讓 harness 的 cwd 解析成功：

```bash
# 在 host 上執行
sudo docker exec -u root pi-web sh -c \
  'mkdir -p /home/wrt && ln -sfn /workspace /home/wrt/TigerAI'
```

⚠️ 這個 symlink 存在容器的 **writable layer** — `docker compose down && up`（recreate）
就會消失。兩選項：

1. 每次 rebuild 後重跑上面那條指令（最快）
2. 燒進 Dockerfile（路徑固定時）：

   ```dockerfile
   RUN mkdir -p /home/wrt && ln -sfn /workspace /home/wrt/TigerAI
   ```

## 解法 B：ssh2 bridge — 容器內執行 host 指令（解牆 #2、#3）

容器有 Node 但沒有 ssh 二進位。裝 pure-JS 的 `ssh2`（無 native 編譯，alpine 直接可用）：

```bash
mkdir -p /workspace/sshbridge && cd /workspace/sshbridge
npm install ssh2
```

> 放在 `/workspace`（掛載卷）才能活過容器重建；**不要放容器 `/tmp`**（recreate 即失）。

`exec.js`（密碼一律由環境變數讀入，**不寫進檔案、不 commit**）：

```js
// 用法（在容器內）:
//   PI_HOST_SSH_HOST=<host IP> PI_HOST_SSH_USER=<user> PI_HOST_SSH_PASS=<pass> \
//     node exec.js 'whoami'
//   PI_HOST_SUDO_PASS=<sudo pass> node exec.js 'SUDO: systemctl status docker'
const { Client } = require('ssh2');
const cmd = process.argv[2];
if (!cmd) { console.error("usage: node exec.js '<cmd>' | 'SUDO: <cmd>'"); process.exit(2); }

const host = process.env.PI_HOST_SSH_HOST;
const user = process.env.PI_HOST_SSH_USER;
const pass = process.env.PI_HOST_SSH_PASS;
const sudo = process.env.PI_HOST_SUDO_PASS;

const isSudo = cmd.startsWith('SUDO: ');
const real = isSudo ? `echo ${sudo} | sudo -S -p '' ${cmd.slice(6)}` : cmd;

const con = new Client();
con.on('ready', () => {
  con.exec(real, (err, stream) => {
    if (err) { console.error(err.message); process.exit(1); }
    stream.on('close', (code) => process.exit(code ?? 0));
    stream.on('data', (d) => process.stdout.write(d));
    stream.stderr.on('data', (d) => process.stderr.write(d));
  });
}).on('error', (e) => { console.error('ssh error:', e.message); process.exit(1); })
  .connect({ host, port: 22, username: user, password: pass });
```

用法：

```bash
cd /workspace/sshbridge
PI_HOST_SSH_HOST=<host LAN IP> PI_HOST_SSH_USER=<user> PI_HOST_SSH_PASS=<pass> \
  node exec.js 'whoami'
```

重點：

- **比掛 docker.sock 攻擊面小**：docker.sock = host 完整 root；ssh bridge 只是普通
  帳號，必要時才 `SUDO:` 升級
- **長工作一定要脫管**，否則 SSH channel 會掛到工作結束、bridge 逾時：

  ```bash
  node exec.js 'cd /path && setsid nohup bash job.sh > job.log 2>&1 < /dev/null & disown'
  ```

- **監控模式**：host 端工作把 log 寫到「掛載進容器的目錄」，容器內直接 `tail` 讀，
  不用一直走 ssh（這配合上面的 `& disown` 是標準組合：下達 → 脫管 → 讀 log）
- host 有 ssh key 時更乾淨：`ssh2` 改傳 `privateKey` 選項，連密碼都不用

### 解法 B+（推薦）：pi skill 版 — 其他 AI 一進環境就自動發現

> 上面的 B（`exec.js` + `/workspace/sshbridge`）是通用做法，但每次要「先知道去讀這頁文件」。
> 如果容器跑的是 **pi agent**（如 pi-web），推薦把 bridge 放成 pi skill：
> `~/.pi/agent/skills/host-ssh/`。`~/.pi/agent` 是掛載卷（rebuild 存活），pi 會**自動發現**
> skills——下次任何 AI 進這個環境，skill 清單裡直接看得到，不需要繞路。

#### 當時的 4 步（瓶頸 → 打通）

1. **瓶頸**：容器零權限——無 sudo、`/sys` 唯讀、沒 ssh/curl 二進位、`apk add` 要 root 裝不了
   → 系統 ssh 客戶端的路走不通。
2. **node 路線（關鍵決定）**：容器有 node → 用純 JS `ssh2` 當 SSH 客戶端，完全不需要
   ssh 二進位。（fallback：host 上其他服務的 node_modules 深處可能內含 ssh2，可複製過來，離線也能用。）
3. **建立 skill 目錄** `~/.pi/agent/skills/host-ssh/`：`run-host.js`（SSH 腳本）+
   `package.json` + `npm install ssh2` + `SKILL.md`（主機資訊、用法、規則）。
4. **sudo 打通（`--sudo` 的祕訣）**：`printf '%s\n' '<pass>' | sudo -S -p '' bash -c '<cmd>'`
   ——把密碼 pipe 進 `sudo -S` 的 stdin，免互動輸入。

#### 安裝（約 5 分鐘）

```bash
mkdir -p ~/.pi/agent/skills/host-ssh && cd ~/.pi/agent/skills/host-ssh
# 把下面的 run-host.js 與 SKILL.md 寫入，然後：
npm install ssh2
```

#### run-host.js（密碼一律走環境變數，不寫進檔案）

```js
#!/usr/bin/env node
// host-ssh: run a command on the Docker host via ssh2 (pure JS, no ssh binary needed).
// Passwords come ONLY from environment variables — never hardcode, never commit.
//
// Usage:
//   HOST_SSH_PASS='<pass>' node run-host.js '<cmd>'                    # as host user
//   HOST_SSH_PASS='<pass>' HOST_SUDO_PASS='<pass>' node run-host.js --sudo '<cmd>'
//   HOST_SSH_HOST=<ip> ...   # override host (default: bridge gateway, see SKILL.md)

const { Client } = require('ssh2');

const args = process.argv.slice(2);
let sudo = false;
let host = process.env.HOST_SSH_HOST || '172.28.0.1'; // docker bridge gateway
let user = process.env.HOST_SSH_USER || 'wrt';
const password = process.env.HOST_SSH_PASS;
const sudoPassword = process.env.HOST_SUDO_PASS;
const cmdParts = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sudo') sudo = true;
  else if (args[i] === '--host') host = args[++i];
  else cmdParts.push(args[i]);
}
const cmd = cmdParts.join(' ');
if (!cmd) { console.error('Usage: HOST_SSH_PASS=<pass> node run-host.js [--sudo] [--host <ip>] <command>'); process.exit(2); }
if (!password) { console.error('missing env HOST_SSH_PASS'); process.exit(2); }
if (sudo && !sudoPassword) { console.error('missing env HOST_SUDO_PASS'); process.exit(2); }

// 密碼 pipe 進 sudo -S，免互動；單引號正確轉義
const sq = (s) => s.replace(/'/g, "'\\''");
const remote = sudo
  ? `printf '%s\n' '${sq(sudoPassword)}' | sudo -S -p '' bash -c '${sq(cmd)}'`
  : cmd;

const conn = new Client();
const timeout = setTimeout(() => { console.error('timeout after 120s'); conn.end(); process.exit(124); }, 120000);

conn.on('ready', () => {
  conn.exec(remote, (e, stream) => {
    if (e) { clearTimeout(timeout); console.error('exec error:', e.message); process.exit(1); }
    stream.on('data', (d) => process.stdout.write(d));
    stream.stderr.on('data', (d) => process.stderr.write(d));
    stream.on('close', (code) => { clearTimeout(timeout); conn.end(); process.exit(code == null ? 0 : code); });
    stream.on('error', (err) => { clearTimeout(timeout); console.error('stream error:', err.message); conn.end(); process.exit(1); });
  });
}).on('error', (e) => { clearTimeout(timeout); console.error('ssh error:', e.message); process.exit(1); });

conn.connect({ host, port: 22, username: user, password, readyTimeout: 15000 });
```

#### SKILL.md（範本；密碼欄位只寫來源，不寫值）

```markdown
# host-ssh

容器內以純 JS（ssh2）SSH 到 Docker host 執行指令。不需 ssh 二進位、不需 root。

| 項目 | 值 |
|------|-----|
| Host | bridge gateway（發現方法見下） |
| User | `<host 使用者>` |
| 密碼 | **只走環境變數** `HOST_SSH_PASS` / `HOST_SUDO_PASS`，不寫進任何檔案 |

**bridge gateway 發現方法（不可硬編碼）**：`cat /proc/net/route` 的 gw 欄是 little-endian
hex（如 `01001CAC` → `172.28.0.1`）；或容器 IP 同網段 + `.1`。

用法：`HOST_SSH_PASS='<pass>' node run-host.js [--sudo] '<指令>'`

規則：1) `--sudo` 先問使用者 2) 刪除/修改 host 的東西絕對先問 3) 預設只做唯讀查詢
```

#### 驗證

```bash
HOST_SSH_PASS='...' node run-host.js 'whoami && hostname'                    # → host 使用者 + 主機名
HOST_SSH_PASS='...' HOST_SUDO_PASS='...' node run-host.js --sudo 'whoami'   # → root
```

#### 與解法 B（exec.js）的差異

- `--sudo` flag（B 用 `SUDO: ` 前綴）、`--host` flag、120s 逾時、sudo 指令單引號轉義
- 放 pi skills → **自動發現**；exec.js 需要每個 AI 先被指引去讀這頁
- 長工作脫管模式（`setsid nohup ... & disown` + log 寫掛載目錄再 tail）兩版都適用

## 為什麼不直接掛 docker.sock

| | 掛 docker.sock | ssh bridge |
|---|---|---|
| 權限 | = host 完整 root（可動所有容器、讀所有 secret） | 普通使用者帳號（按需 SUDO） |
| 適用 | CI／自動化管理 | agent 在 host 上「幫忙跑活」的本場景 |

## 踩過的地雷（排錯表）

| 地雷 | 症狀 | 解法 |
|---|---|---|
| heredoc 搶 sudo 的 stdin | `echo pass \| sudo -S bash <<EOF … EOF` → `3 incorrect password attempts` | 先把腳本寫成檔案，再 `echo $PASS \| sudo -S -p '' bash /tmp/script.sh` |
| 容器內跑 bash 特有語法 | ash 報 syntax error | 容器只有 ash（POSIX）；`bash -n` 語法檢查要**在 host** 上跑 |
| 長指令 `nohup &` 不脫管 | bridge 逾時、看起來卡死 | `setsid nohup … & disown` |
| 腳本放容器 `/tmp` | rebuild 後消失 | 持久物放 `/workspace`（掛載卷） |
| `docker logs --since <epoch 數字>` | 無輸出 | 用 `--tail N` 或 RFC3339 時間戳 |
| 用 sed 貪婪 `.*` 抓 log 數字 | 吃掉前導數字（如 `1094` 變 `94`） | 改用 `grep -oE '[0-9]+(\.[0-9]+)?'` |
| bridge gateway IP 不固定 | 舊的 `172.21.0.1` 連不上、ssh 失敗 | 同一台 host 在不同 docker network 下子網不同（實測出現過 172.21.0.1 / 172.28.0.1）；用 `cat /proc/net/route`（gw 欄 little-endian hex）或容器 IP 同網段 + `.1` 找現值 |

## Rebuild 後復原 checklist

`docker compose up -d --build`（會 recreate 容器）後，按順序：

1. 重跑解法 A 的 symlink（除非已燒進 Dockerfile）
2. `sshbridge` 若在 `/workspace` → 自動活著，免處理
3. pi session：`~/.pi/agent` 有掛載 → session 與設定活著，可直接接續

## 權限邊界：容器 root ≠ host root

> **關鍵事實**
> - 容器內的 `root` **不是** host 的 root。容器最多只能碰到：容器自己的檔案系統 + compose 裡掛進來的 volume（本機：`~/.pi/agent`、` /workspace` → `/home/wrt/TigerAI/AG/SystemRepair`）。
> - 若目標是修 **host 本機**（這台 wrt 主機、專案 SystemRepair），很多操作必須在 host 上執行。容器內做不到——除非走 ssh bridge（解法 B/B+）回到 host。
> - `user: "0"` 讓容器內的 pi 以 root 執行，並**不會**讓容器變成 host root；它只會讓掛載目錄內的檔案被 root 擁有/修改。

### root 運行的代價

- agent 以 root 執行後，掛載目錄（`/workspace`、 `~/.pi/agent`）內新建的檔案/目錄 owner 都是 `root:root`。
- 之後改回 `user: node` 跑，agent 就**寫不進**那些 root 擁有的檔案，導致「權限錯誤」的假象。
- 建議：只在需要寫入 host 擁有者的檔案時才臨時用 root；長期以 node 執行，必要時用 ssh bridge 以 host 帳號操作。

## 安全紀律

- 密碼只走環境變數，不落檔、不入 git
- 推任何文件/腳本上 repo 前先掃一遍：`grep -rn '<實際密碼>' <目錄>` 確認零命中
- 這頁所有範例的密碼位都是佔位符——照做不會把真密碼帶進 repo
