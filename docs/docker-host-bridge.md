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

## 解法 B：ssh2 bridge — 容器內執行 host 指令（解牆 #2、#3，推薦）

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

## Rebuild 後復原 checklist

`docker compose up -d --build`（會 recreate 容器）後，按順序：

1. 重跑解法 A 的 symlink（除非已燒進 Dockerfile）
2. `sshbridge` 若在 `/workspace` → 自動活著，免處理
3. pi session：`~/.pi/agent` 有掛載 → session 與設定活著，可直接接續

## 安全紀律

- 密碼只走環境變數，不落檔、不入 git
- 推任何文件/腳本上 repo 前先掃一遍：`grep -rn '<實際密碼>' <目錄>` 確認零命中
- 這頁所有範例的密碼位都是佔位符——照做不會把真密碼帶進 repo
