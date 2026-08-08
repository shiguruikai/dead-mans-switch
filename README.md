# Dead Man's Switch

Cloudflare Workers 上で稼働する、個人専用のセルフホスト型死後通知システムです。

指定した期間アクセスや更新がない場合、死後通知のメールを事前に設定した送信先へ自動送信します。手動での生存報告や状況確認は Cloudflare Zero Trust（Access）で保護された生存確認画面（`/`）から安全に行えます。

## 📚 ドキュメント

- [要件定義書](docs/REQUIREMENTS.md)
- [アーキテクチャ・詳細設計書](docs/ARCHITECTURE.md)

## 🚀 技術スタック

- TypeScript (v6), Hono / Hono JSX (v4), Vite (v8), Zod (v4), pnpm
- Web Push
- Cloudflare Workers (`nodejs_compat`), Cloudflare KV, Cron Triggers, Zero Trust, Cloudflare Email Service
- Vitest

## 🚀 新規デプロイ手順

本システムを新規でセルフホストデプロイするための手順です。

### 1. 事前準備

1. **送信先メールアドレスの認証**
   - Cloudflare Dashboard > **Email Routing** > **Destination Addresses** にて、送信先メールアドレスとなる本人通知先メールアドレス（`OWNER_EMAIL_ADDRESS`）および死後通知先メールアドレス（`KIN_EMAIL_ADDRESS`）を追加します。
   - 送信された確認メール内の認証リンクをクリックし、ステータスを `Verified`（認証済み）にします。
2. **送信元メールアドレスの決定**
   - Cloudflare 上で管理・有効化している自身のドメイン（例: `yourdomain.com`）から、送信元として使用する送信元メールアドレス（例: `noreply@yourdomain.com`）を決めます。
   - ※ Cloudflare 上の所有ドメインであれば実際の受信ボックスを用意する必要はなく、任意のローカルパート（`noreply@` や `dms@` など）を指定できます。決定したアドレスは、後ほど `wrangler.jsonc` の `SENDER_EMAIL_ADDRESS` に設定します。
3. **Web Push 用 VAPID 鍵ペアの生成**
   - 以下のコマンドを実行し、表示された Public Key と Private Key を控えておきます（後ほど `wrangler.jsonc` の `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` に設定します）。

     ```bash
     pnpm dlx web-push generate-vapid-keys
     ```

> [!NOTE]
>
> Cloudflare Email Service の Email Sending を利用するには有料プランの契約が必要ですが、**事前認証済みの Destination Address 宛てへのメール送信は Workers Free プランを含むすべてのプランで無料**で利用できます。

### 2. ローカル設定 ＆ KV ネームスペース作成

#### 1. 依存パッケージのインストールと設定ファイルの準備

   ```bash
   # 1. 依存パッケージのインストール
   pnpm install

   # 2. 設定ファイルテンプレートのコピー（wrangler.jsonc は git 管理対象外です）
   cp wrangler.jsonc.example wrangler.jsonc
   ```

#### 2. Cloudflare KV ネームスペースの作成

   ```bash
   pnpm wrangler kv namespace create DMS_KV --update-config=false
   ```

   実行結果の例:

   ```txt
   🌀 Creating namespace with title "DMS_KV"
   ✨ Success!
   To access your new KV Namespace in your Worker, add the following snippet to your configuration file:
   {
     "kv_namespaces": [
       {
         "binding": "DMS_KV",
         "id": "69f6ae8ef5e54df52a81cbfb46d767c1"
       }
     ]
   }
   ```

   表示された id を [wrangler.jsonc](wrangler.jsonc) の `YOUR_KV_NAMESPACE_ID` に設定します。

#### 3. `wrangler.jsonc` の全環境変数設定

[wrangler.jsonc](wrangler.jsonc) の `vars` セクションにすべての運用環境変数を記述します（本ファイルは `.gitignore` により保護されているため、手元の秘密情報も含めて安全に一元管理できます）。

| 変数名 | 説明 | デフォルト値 / 設定例 | 変更 |
| :--- | :--- | :--- | :--- |
| `BASE_URL` | Workers 展開先 URL（生存確認画面 URL の組み立てに使用） | `https://dead-mans-switch.<subdomain>.workers.dev` | **必須** |
| `SENDER_EMAIL_ADDRESS` | 送信元メールアドレス（事前認証済みドメインのアドレス） | `noreply@yourdomain.com` | **必須** |
| `VAPID_SUBJECT` | Web Push 用 VAPID 連絡先（`mailto:本人メールアドレス`） | `mailto:owner@example.com` | **必須** |
| `OWNER_EMAIL_ADDRESS` | 本人通知先メールアドレス（生存確認リマインダーの受取先、カンマ区切りで複数指定可能） | 事前に Destination Addresses で承認済みの本人アドレス（例: `owner1@example.com, owner2@example.com`） | **必須** |
| `KIN_EMAIL_ADDRESS` | 死後通知先メールアドレス（手続案内・メッセージの受取先、カンマ区切りで複数指定可能） | 事前に Destination Addresses で承認済みの受取人アドレス（例: `kin1@example.com, kin2@example.com`） | **必須** |
| `VAPID_PUBLIC_KEY` | Web Push 通知用の Public Key | 事前準備手順で生成した Public Key | **必須** |
| `VAPID_PRIVATE_KEY` | Web Push 通知用の Private Key | 事前準備手順で生成した Private Key | **必須** |
| `WARNING_DAYS` | 生存確認リマインダー（メール＋Web Push）を送信する不活動日数 | `"7"`（7日経過後） | 任意 |
| `DEAD_DAYS` | 死後通知（死後通知先宛てメール）を送信する通算不活動日数 | `"14"`（14日経過後） | 任意 |
| `WARNING_EMAIL_SUBJECT` | 生存確認リマインダーメールの件名 | `【重要】Dead Man's Switch 生存確認リマインダー` | 任意 |
| `WARNING_EMAIL_BODY` | 生存確認リマインダーメールの本文（`${BASE_URL}` プレースホルダー利用可） | `生存シグナルが途絶えています...` | 任意 |
| `DEAD_EMAIL_SUBJECT` | 死後通知メールの件名 | `【重要通知】手続情報およびメッセージのご案内` | 任意 |
| `DEAD_EMAIL_BODY` | 死後通知メールの本文（手続案内・メッセージ） | 任意のカスタム文章（※空文字の場合はデフォルト文章を適用） | 任意 |

### 3. 検証 ＆ デプロイ

```bash
# 1. 型チェック・リント・テスト
pnpm typecheck
pnpm lint
pnpm test

# 2. 本番デプロイ
pnpm deploy
```

### 4. メール送信・通知シミュレーションテスト（CLI）

開発環境または本番環境（`--remote`）において、実際に警告リマインダーメールや死後通知メールが送信されるかを安全に通しテストできます。

```bash
# 1. 現在のステータス確認
pnpm cli status
pnpm cli status --remote         # 本番・リモート環境

# 2. 生存シグナル（Ping）送信
pnpm cli ping
pnpm cli ping --remote

# 3. 警告リマインダー送信テスト（last_active_at を過去に変更）
pnpm cli warning
pnpm cli warning --remote        # 本番・リモート環境（確認プロンプトが出ます）

# 4. 死後通知送信テスト
pnpm cli dead --remote

# 5. テスト完了後の NORMAL 状態への復帰（リセット）
pnpm cli reset --remote
```

> [!TIP]
>
> - CLI ツールは [wrangler.jsonc](wrangler.jsonc) 内の `vars.WARNING_DAYS` / `vars.DEAD_DAYS` を自動的に参照し、各種シミュレーションの経過日時を動的に算出します。
> - 本番・リモート環境（`--remote`）への操作を行うには、事前に Cloudflare へのログイン（`pnpm wrangler login`）または環境変数 `CLOUDFLARE_API_TOKEN` の設定が必要です。
> - 実際の書き込みを行わずに事前に変更内容を確認したい場合は、`--dry-run` フラグ（例: `pnpm cli warning --dry-run`）を付与してください。

### 5. デプロイ後の設定

#### 5.1 外部スクリプト用 Service Token の作成

外部スクリプトなどから生存報告 (`POST /api/ping`) を行うための認証トークンを作成します。

1. Cloudflare Dashboard > **Zero Trust** > **Access controls** > **Service credentials** > **Service Tokens** を開きます。
2. **Create Service Token** をクリックします。
3. **Service Token Name**（例: `dead-mans-switch-token`）と **Service Token Duration**（例: `Non-expiring`）を入力し、`Generate token` をクリックします。
4. 表示された **Header and client ID** と **Header and client secret** を控えておきます。※ Client Secret は画面を閉じると再表示できません。

#### 5.2 Cloudflare Zero Trust の設定

アプリケーション（Worker ドメイン全体）へのアクセス制御ルールを設定します。

1. Cloudflare Dashboard > **Zero Trust** > **Access controls** > **Applications** を開きます。
2. **Create new application** をクリックし、**Continue with Self-hosted and private** をクリックします。
3. **Public hostnames** に `<YOUR_WORKER_DOMAIN>`（例: `dead-mans-switch.example.workers.dev`）を入力します。
4. **Access Policies** にて以下の2つのポリシーを追加します。
   - **本人用ポリシー**: デフォルトで定義済みの `Allow My Email` など本人確認ができる任意のポリシー
   - **外部スクリプト用ポリシー**: 前述の手順で作成した Service Token で Bypass するポリシー

#### 5.3 外部スクリプトからの呼び出し例

自動生存報告を行うスクリプトからは、以下のヘッダーを付与してリクエストを送信します：

```bash
curl -X POST "https://<YOUR_WORKER_DOMAIN>/api/ping" \
  -H "CF-Access-Client-Id: <YOUR_CLIENT_ID>" \
  -H "CF-Access-Client-Secret: <YOUR_CLIENT_SECRET>"
```

#### 5.4 初回 Web Push 購読設定

本人端末のブラウザから通知購読を登録します。

1. `https://<YOUR_WORKER_DOMAIN>/` へアクセスし、Zero Trust 認証を通過します。
2. 「この端末の Web Push 通知を許可」ボタンをクリックし、表示されたブラウザダイアログで「許可」を選択します。

#### 5.5 環境変数の変更手順（運用開始後）

- [wrangler.jsonc](wrangler.jsonc) 内の `vars` の値を編集し、`pnpm deploy` を再実行するだけで更新できます。
- ※ Cloudflare Dashboard > **Workers & Pages** > 本 Worker > **Settings** > **Variables and Secrets** から直接編集することも可能です。

> [!IMPORTANT]
>
> **【最悪の想定】クレカ解約によるドメイン自動解約リスクへの対策**
> 本人が死亡した際、親族がクレジットカードを解約または口座を凍結することで、ドメインの自動更新が失敗し、死後通知前にドメインが失効するリスクがあります。不活動期間（`DEAD_DAYS`）を2ヶ月以上の長期に設定する場合は、**ドメインを5年〜10年分まとめて前払いしておく、または、不活動期間を30日以内に設定する運用**を推奨します。

## 📄 ライセンス

[MIT License](LICENSE)
