# Pi Web

[English](./README.md) | [简体中文](./README.zh-CN.md) | [Русский](./README.ru.md)

[pi コーディングエージェント](https://github.com/earendil-works/pi) のローカルブラウザー UI です。Pi Web は pi と同じローカル設定とセッションファイルを使用し、ブラウザーから会話の検索と再開、エージェントの実行、モデルやリソースの設定、プロジェクトファイルの確認を行えます。

![構造化された Markdown、ツール呼び出し、プロジェクトナビゲーションとともに pi セッションを表示する Pi Web](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## 機能

- **セッションワークスペース**：プロジェクトごとに会話を閲覧、再開、名前変更、エクスポート、削除し、実行状態、コンテキスト使用量、コスト、コンパクション情報を確認できます。
- **2 種類の分岐**：**New session** は以前のメッセージから独立したセッションファイルを作成し、**Edit from here** は現在のセッション内にブランチを作成します。
- **プロジェクトファイルツール**：ファイルの閲覧とアップロード、Git Diff の確認、ソース、Markdown、画像、音声、PDF、DOCX のプレビューに対応し、変更時は自動更新されます。
- **Git worktree**：同じリポジトリのセッションをまとめたまま、サイドバーからチェックアウトを切り替えられます。
- **Web での設定**：Pi Web を離れずに、Provider のログインと API Key、モデル、モデルテスト、プラグインパッケージ、スキルを管理できます。
- **英語と簡体字中国語の UI**：初回はブラウザーの言語に従い、トップバーから言語を切り替えられます。

## クイックスタート

Pi Web には Node.js 22.19.0 以降が必要です。`node --version` でバージョンを確認してから、次を実行します：

```bash
npx @agegr/pi-web@latest
```

サーバーの準備が整うと、CLI はブラウザーを自動的に開こうとします。開かない場合は [http://127.0.0.1:30141](http://127.0.0.1:30141) にアクセスしてください。Pi Web はデフォルトで `127.0.0.1` のみをリッスンします。

モデル Provider が未設定の場合は、**Models** パネルを開いてログインするか API Key を追加してください。

`pi-web` コマンドをグローバルにインストールする場合：

```bash
npm install -g @agegr/pi-web@latest
pi-web
```

更新時は、実行中のプロセスを `Ctrl+C` で停止してから同じインストールコマンドを再実行します。アンインストールするには `npm uninstall -g @agegr/pi-web` を実行します。

## 設定

ポートとホスト名では、コマンドラインオプションが対応する環境変数より優先されます。`--no-open` と `PI_WEB_NO_OPEN=1` は、どちらを指定してもブラウザーの自動起動が無効になります。

| オプションまたは環境変数 | 用途 | デフォルト |
| --- | --- | --- |
| `--port <port>`、`-p <port>`、または `PORT` | サーバーポート | `30141` |
| `--hostname <host>`、`-H <host>`、または `PI_WEB_HOSTNAME` | バインドするホスト名（例：`127.0.0.1`、`0.0.0.0`、または Tailscale アドレス） | `127.0.0.1` |
| `--no-open` または `PI_WEB_NO_OPEN=1` | ブラウザーを自動的に開かない | 自動的に開く |
| `PI_WEB_ALLOWED_HOSTS` | 追加で許可するプロキシまたはカスタムホスト名。複数指定はカンマ区切りで完全一致 | 未設定 |
| `PI_WEB_PASSWORD` | Basic Auth のパスワードを固定（ユーザー名は常に `pi`）。未設定の場合、サーバーは最初のネットワークリクエスト時に 6 桁の PIN を自動生成し `~/.pi-web/` に保存（再起動をまたいで保持） | 自動生成の 6 桁 PIN |

例：

```bash
pi-web -p 8080 -H 0.0.0.0 --no-open
```

### リモートアクセス

ループバック以外のアドレスにバインドすると、高い権限の操作を実行できるエージェントがネットワークに公開されます。Basic Auth は転送中のパスワードを暗号化しないため、平文 HTTP で Pi Web をインターネットに公開せず、信頼できるリバースプロキシによる HTTPS または信頼できる VPN を使用してください。リバースプロキシが外部ホスト名を転送する場合は、その名前を完全一致で `PI_WEB_ALLOWED_HOSTS` に追加します。この許可リストは Pi Web のバインド先を変更しません。

デフォルトでは**パスワードは設定されません**。ネットワークから最初に Pi Web に届いたリクエストに対し、サーバーは 6 桁の PIN を自動生成してランタイム領域（再起動をまたいで保持される）に書き込みます。トップバーの **接続手机** アイコンを開けば現在の PIN を確認でき、QR コードにはワンタイムペアリングトークンが埋め込まれているため、スマートフォンはパスワード入力なしで直接 Pi Web に着地します。

自動生成 PIN の代わりに独自のパスワードを使いたい場合は、環境変数 `PI_WEB_PASSWORD` を設定してください：

```bash
PI_WEB_PASSWORD='任意のパスワード' pi-web --hostname 0.0.0.0
```

### モバイルからのアクセス

`http://127.0.0.1:30141` は Pi Web を実行しているコンピューター上でのみ有効です。スマートフォンでは `127.0.0.1` はスマートフォン自身を指します。代わりにコンピューターの実際のアドレスを使用してください。

**同じ Wi-Fi の場合。** すべてのインターフェースにバインドし、スマートフォンで `http://<コンピューターのLAN IP>:30141` を開きます：

```bash
pi-web --hostname 0.0.0.0
```

トップバーの **接続手机** モーダルの QR コードにはアドレスとワンタイムペアリングトークンが含まれているため、スマートフォンはデスクトップセッションに直接着地し、**パスワード入力は不要**です。

**任意のネットワーク（Tailscale 経由）。** 両方の端末に Tailscale をインストールして同じ tailnet に参加させ、tailnet アドレスにバインドします（自機の 100.x アドレスは `tailscale ip -4` で確認）：

```bash
pi-web --hostname 100.x.x.x
```

`-H 0.0.0.0` を使用したとき、ランチャーは Tailscale の IP を自動取得して QR コードに埋め込みます。Tailscale クライアント：[iOS](https://apps.apple.com/us/app/tailscale/id1470499037) · [Android](https://play.google.com/store/apps/details?id=com.tailscale.ipn)。他の人と共有するには、同じ tailnet に招待してアドレスを伝えてください。

**スマートフォン側の認証。** 6 桁 PIN が求められるのは、URL を直接入力した場合（QR を経由しない場合）のみです。QR コード経由ではこのステップが省略され、最初のスキャン時にペアリングトークンが 30 日有効なセッション cookie と交換されます。cookie はサーバー再起動をまたいで有効ですが（署名鍵を `~/.pi-web/session.key` に保持しているため）、サーバーの `PI_WEB_PASSWORD` の値が変わると無効化されます。

### HTTP プロキシ

サーバー側のモデルリクエストと API リクエストは、標準の `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 環境変数を使用します。

macOS または Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## 注意事項

- **エージェントデータ**：Pi Web はデフォルトで `~/.pi/agent` の pi データを読み込みます。セッションファイルは `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl` にあります。別の pi エージェントディレクトリを使用するには `PI_CODING_AGENT_DIR` を設定してください。
- **ファイルシステムへのアクセス**：Pi Web はエージェントデータディレクトリと、セッションに記録された作業ディレクトリを読み取れる必要があります。既存の pi セッションを共有する場合は、pi と同じファイルシステム環境で Pi Web を実行してください。
- **共有設定**：Models パネルは pi のモデル、設定、認証情報ストレージを使用するため、変更は両方のインターフェースに反映されます。
- **ファイルアクセスの範囲**：ファイルブラウザーは、Pi Web で選択した作業ディレクトリと、既知のプロジェクトまたはセッションルートに限定されます。汎用のファイルシステムブラウザーではありません。
- **Git worktree**：スイッチャーの表示条件、worktree の作成、削除時の動作については [Worktrees in Pi Web](./docs/worktrees.md) を参照してください。

## 開発

```bash
npm install
npm run dev
```

開発サーバーは [http://127.0.0.1:30141](http://127.0.0.1:30141) で動作します。一般的なチェックは次のコマンドで実行します：

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

通常の開発中は `next build` または `npm run build` を実行しないでください。`.next/` に書き込まれ、開発サーバーに影響する可能性があります。ビルドはリリース作業時にのみ実行してください。

コントリビューター向けガイド：[Internationalization](./docs/i18n.md) と [Release process](./docs/release.md)。

## リポジトリ構成

```text
app/             Next.js UI と API ルート
components/      React UI コンポーネント
hooks/           クライアントの状態と操作に関する hooks
lib/             セッション、エージェント、モデル、ファイル、Git、セキュリティのロジック
public/          静的アセットと PWA ファイル
bin/             npm CLI エントリポイントと起動オプションの解析
docs/            ユーザーおよびコントリビューター向けの個別ガイド
```

アーキテクチャの説明と詳細なファイルマップについては [AGENTS.md](./AGENTS.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
