# Pi Web

[English](./README.md) | [简体中文](./README.zh-CN.md)

[pi コーディングエージェント](https://github.com/badlogic/pi-mono) のローカル Web UI です。Pi Web はローカルの pi セッションファイルを読み込み、セッションの閲覧、リアルタイムチャット、モデル設定、スキル管理、プロジェクトファイルのプレビューを行えるブラウザワークスペースを提供します。

![Pi Web では、CLI と同じ pi セッションを、構造化された Markdown、ツール呼び出し、プロジェクトナビゲーションとともに表示できます](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

CLI と Pi Web で同じ pi セッションを利用できます。構造化されたツール呼び出し、読みやすい Markdown、セッション閲覧、整理された結果表示を備えています。

## クイックスタート

Pi Web には Node.js 22.19.0 以降が必要です。現在のバージョンは `node --version` で確認できます。

**インストールせずに実行：**

```bash
npx @agegr/pi-web@latest
```

**またはグローバルにインストール：**

```bash
npm install -g @agegr/pi-web
pi-web
```

続いて [http://127.0.0.1:30141](http://127.0.0.1:30141) を開きます。サーバーの準備が整うと、CLI はブラウザを自動的に開こうとします。Pi Web はデフォルトで `127.0.0.1` のみをリッスンします。

**オプション：**

```bash
pi-web --port 8080              # カスタムポート
pi-web --hostname 0.0.0.0       # 信頼できるネットワークに公開
pi-web -p 8080 -H 0.0.0.0       # オプションを組み合わせる
pi-web --no-open                # ブラウザを自動的に開かない

PORT=8080 pi-web                # 環境変数にも対応
PI_WEB_HOSTNAME=0.0.0.0 pi-web  # ネットワーク公開を明示的に有効化
PI_WEB_ALLOWED_HOSTS=pi-web.internal pi-web  # プロキシまたはカスタムホスト名を許可
PI_WEB_NO_OPEN=1 pi-web         # バックグラウンドサービスとして実行する場合に便利
```

## 公開環境でのデプロイと認証

Pi Web はデフォルトで認証を要求します。初回起動時に、一度だけ使用できる初期化 token がサーバーのターミナルに表示されます。セットアップページでこの token を入力し、パスワードを設定してください。token はパスワードではなく、ブラウザや設定ファイルから復元することもできません。

ログインのレート制限は、デフォルトでは匿名アクセス元を 1 つの固定バケットとして扱い、クライアントが送信した proxy header を信頼しません。Pi Web を信頼できるリバースプロキシの背後で実行し、プロキシがこれらの header を上書き・サニタイズする場合は、`PI_WEB_TRUSTED_PROXY=true` を設定して `X-Forwarded-For` / `X-Real-IP` のアクセス元を使用できます。すべての直接アクセスを遮断し、プロキシが偽装された header を除去できる場合にのみ有効にしてください。

- 認証情報はデフォルトで `~/.pi/agent/pi-web-auth.json` に保存されます。別の場所を使用するには `PI_WEB_AUTH_CONFIG_PATH` を設定してください。
- Pi Agent のセッション、モデル、その他の設定はデフォルトで `~/.pi/agent/` に保存されます。`PI_CODING_AGENT_DIR` で Pi Agent のディレクトリ全体を変更できます。
- 初期化 token を紛失した場合は、Pi Web をローカルで停止し、認証設定ファイルを削除して再起動すると、ターミナルで新しい token を取得できます。この復旧操作は Pi Web を実行しているローカルアカウントが管理できる場合にのみ行ってください。既存の認証設定が消去され、新しいパスワードの設定が必要になります。
- サーバーが認証設定の破損を報告した場合、Pi Web は未初期化として扱わず、設定ファイルを暗黙に上書きすることもありません。サービスを停止し、server stderr に表示されたパスをバックアップしたうえで、ローカルの管理者が意図的に修復または削除して再初期化してください。
- ログイン session の有効期限は 24 時間です。パスワードを変更すると既存の session は取り消されるため、新しいパスワードで再ログインしてください。
- 認証 session の期限切れ、ブラウザの切断、パスワードの変更によって、バックグラウンドの AgentSession が停止・破棄・中断されることはありません。実行中の処理は継続し、再ログイン後に結果を確認できます。

### HTTPS とリバースプロキシ

公開アクセスでは、Pi Web を HTTPS リバースプロキシの背後に置き、Pi Web 自体は loopback のみを listen するようにしてください。`PI_WEB_TRUSTED_PROXY=true` を有効にする場合は、クライアントから Pi Web への直接アクセスを遮断し、信頼できるプロキシがクライアントの `X-Forwarded-For` header を追加ではなく上書きする必要があります。次の Nginx 例では、証明書管理ツールによって TLS 証明書が設定済みであることを前提としています。

```nginx
server {
    listen 443 ssl;
    server_name pi.example.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:30141;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

`--hostname 127.0.0.1` を指定し、プロキシの外部ホスト名を許可したうえで、Pi Web の HTTP ポートを直接公開せずに信頼できる proxy のアクセス元判定を有効にしてください。

```bash
PI_WEB_ALLOWED_HOSTS=pi.example.com PI_WEB_TRUSTED_PROXY=true pi-web --hostname 127.0.0.1 --port 30141 --no-open
```

Pi Web は Agent の状態を SSE で配信するため、リバースプロキシは長時間接続を許可し、レスポンスをバッファリングしないようにする必要があります。ファイアウォールでアクセス元を制限し、有効な TLS 証明書を使用し、`pi-web-auth.json`、Pi の session ファイル、モデルの API key を他のユーザーから読み取れないようにしてください。セットアップ token はサーバーのターミナル stderr（またはサービスのサーバー側ログ）に一度だけ表示され、HTTP response、ブラウザ、cookie、設定ファイルには返されません。

このリポジトリには組み込みの `Dockerfile` はありません。コンテナイメージを作成する場合は、Pi Agent の設定ディレクトリをコンテナにマウントし、`PI_CODING_AGENT_DIR` をそのマウント先に設定してください。認証設定は persistent volume に保存するか、`PI_WEB_AUTH_CONFIG_PATH` を設定してください。そうしないとコンテナの再作成時に認証状態が失われます。パスワード、初期化 token、session cookie、API key をイメージ、Dockerfile、compose ファイル、ログに書き込まないでください。

## HTTP プロキシ

Pi Web は、サーバー側のモデルリクエストと API リクエストに標準の `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 環境変数を使用します。

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

## 機能

- **作業をすぐに再開**：セッションのパスやターミナル履歴を探さずに、プロジェクトごとに過去の pi の会話を閲覧できます。
- **別の方向性を安全に試す**：以前のメッセージから続けるか、セッションをフォークして別の進め方を試せます。
- **ブランチをまたいで作業**：サイドバーから Git worktree を切り替えると、新しいセッションと Explorer が選択したチェックアウトに追従します。
- **プロジェクトを見ながらチャット**：エージェントの作業中に、左側でファイルを閲覧し、右側でソース、ドキュメント、画像、音声、PDF をプレビューできます。
- **セッションの状態を明確に把握**：コンテキスト使用量、コスト、コンパクション状態、システムプロンプトの詳細をトップバーで確認できます。
- **ターミナルでの設定を削減**：モデル、ログイン／API キー、モデルテスト、スキルの切り替えを Web UI から管理できます。

## 注意事項

- **データディレクトリ**：Pi Web はデフォルトで `~/.pi/agent/sessions` を読み込みます。別の pi エージェントディレクトリを指定するには `PI_CODING_AGENT_DIR` を設定してください。
- **セッションファイル**：ファイルは `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl` に保存されます。
- **モデル設定**：Models パネルは pi エージェントディレクトリ内の `models.json` を読み書きします。モデルの一覧とデフォルト値は pi の設定から取得されます。
- **ファイルアクセス**：ファイルの閲覧とプレビューは、選択したプロジェクトディレクトリとセッションに含まれる作業ディレクトリに限定されます。
- **Git worktree**：切り替え機能が表示される条件、新しい worktree の作成方法、削除時の動作については、[Pi Web の Worktree](./docs/worktrees.md) を参照してください。
- **Fork とセッション内ブランチの違い**：Fork は新しい `.jsonl` ファイルを作成します。"Edit from here" は同じセッションファイル内に別のブランチを作成します。

## 開発

```bash
npm install
npm run dev
```

ローカル開発サーバーは [http://127.0.0.1:30141](http://127.0.0.1:30141) で動作します。

よく使うチェック：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

ローカル開発中は `next build` / `npm run build` を実行しないでください。`.next/` に書き込みが行われ、開発サーバーに影響する可能性があります。ビルドはリリース作業に任せてください。

## プロジェクト構成

```text
app/
  api/
    agent/          # AgentSession を作成・操作し、SSE イベントを公開
    auth/           # OAuth と API キーの管理
    cwd/validate/   # カスタム作業ディレクトリの検証
    default-cwd/    # pi のデフォルト作業ディレクトリを取得
    files/          # ファイルの一覧、読み込み、プレビュー、監視
    home/           # 現在のユーザーのホームディレクトリ
    models/         # 利用可能なモデル、デフォルトモデル、思考レベル
    models-config/  # models.json の読み書きとモデルのテスト
    sessions/       # セッションの読み込み、名前変更、削除、コンテキスト、HTML エクスポート
    skills/         # スキルの一覧、検索、インストール、有効化／無効化
components/
  AppShell.tsx        # メインレイアウト、URL 状態、上部パネル、ファイルタブ
  SessionSidebar.tsx  # プロジェクト選択、セッションツリー、Explorer
  ChatWindow.tsx      # メッセージ、SSE、画像のドラッグ＆ドロップ、ミニマップ
  ChatInput.tsx       # 入力欄、モデル／ツール／思考／コンパクション／スラッシュコントロール
  MessageView.tsx     # メッセージ、思考、ツール呼び出し／結果の表示
  ModelsConfig.tsx    # モデルと認証の設定パネル
  SkillsConfig.tsx    # スキル管理パネル
  FileExplorer.tsx    # ファイルツリー
  FileViewer.tsx      # ソース、差分、画像、音声、PDF、DOCX のプレビュー
lib/
  http-dispatcher.ts  # サーバー側 fetch の HTTP(S) プロキシ設定
  rpc-manager.ts      # AgentSessionWrapper のライフサイクルとグローバルレジストリ
  session-reader.ts   # .jsonl セッションファイルとブランチコンテキストの解析
  normalize.ts        # toolCall フィールド名の正規化
  file-access.ts      # ファイル読み込みの安全境界
  file-paths.ts       # ファイルパスのエンコードと相対パスのヘルパー
  markdown.ts         # Markdown／Mermaid／KaTeX プラグインの設定
  pi-types.ts         # pi 関連の型
hooks/
  useAgentSession.ts  # セッションの読み込み、コマンド送信、SSE ステートマシン
  useAudio.ts         # 完了通知音
  useDragDrop.ts      # 画像のドラッグ＆ドロップ
  useTheme.ts         # テーマの切り替え
bin/
  pi-web.js           # npm CLI エントリポイント
instrumentation.ts    # サーバー HTTP ディスパッチャーの初期化
```
