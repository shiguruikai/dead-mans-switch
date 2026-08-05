# Dead Man's Switch

Cloudflare Workers 上で稼働する、個人専用のセルフホスト型死後通知システムです。

指定した期間アクセスや更新がない場合、死後通知のメールを事前に設定した送信先へ自動送信します。手動での生存報告や状況確認は Cloudflare Zero Trust (Access) で保護された `/checkin` 画面から安全に行えます。

## 📚 ドキュメント

- [要件定義書](docs/REQUIREMENTS.md)
- [アーキテクチャ・詳細設計書](docs/ARCHITECTURE.md)

## 🚀 技術スタック

- TypeScript (v6) / Hono (v4) / pnpm
- Web Push
- Cloudflare Workers (`nodejs_compat`) / Cloudflare KV / Cron Triggers / Zero Trust / Email Service
- Vitest (@cloudflare/vitest-pool-workers)

## 🚀 新規デプロイ手順

本システムを新規でセルフホストデプロイするための手順です。

### 1. 事前準備

1. **送信先メールアドレスの承認**
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
| `BASE_URL` | Workers 展開先 URL（チェックイン URL の組み立てに使用） | `https://dead-mans-switch.<subdomain>.workers.dev` | **必須** |
| `SENDER_EMAIL_ADDRESS` | 送信元メールアドレス（事前認証済みドメインのアドレス） | `noreply@yourdomain.com` | **必須** |
| `VAPID_SUBJECT` | Web Push 用 VAPID 連絡先（`mailto:本人メールアドレス`） | `mailto:owner@example.com` | **必須** |
| `OWNER_EMAIL_ADDRESS` | 本人通知先メールアドレス（生存確認リマインダーの受取先） | 事前に Destination Addresses で承認済みの本人アドレス | **必須** |
| `KIN_EMAIL_ADDRESS` | 死後通知先メールアドレス（手続案内・メッセージの受取先） | 事前に Destination Addresses で承認済みの受取人アドレス | **必須** |
| `PING_SECRET_TOKEN` | 外部スクリプト（Git フック等）からの自動 Ping 用認証キー | 任意のランダムな英数字列（例: `openssl rand -hex 16` 等） | **必須** |
| `VAPID_PUBLIC_KEY` | Web Push 通知用の Public Key | 事前準備手順で生成した Public Key | **必須** |
| `VAPID_PRIVATE_KEY` | Web Push 通知用の Private Key | 事前準備手順で生成した Private Key | **必須** |
| `WARNING_DAYS` | 生存確認リマインダー（メール＋Web Push）を送信する不活動日数 | `"7"`（7日経過後） | 任意 |
| `DEAD_DAYS` | 死後通知（死後通知先宛てメール）を送信する通算不活動日数 | `"14"`（14日経過後） | 任意 |
| `WARNING_EMAIL_SUBJECT` | 生存確認リマインダーメールの件名 | `【重要】Dead Man's Switch 生存確認リマインダー` | 任意 |
| `WARNING_EMAIL_BODY` | 生存確認リマインダーメールの本文（`${BASE_URL}` プレースホルダー利用可） | `アクティビティが途絶えています...` | 任意 |
| `DEAD_EMAIL_SUBJECT` | 死後通知メールの件名 | `【重要通知】手続情報およびメッセージのご案内` | 任意 |
| `DEAD_EMAIL_BODY` | 死後通知メールの本文（手続案内・メッセージ） | 任意のカスタム文章（※空文字の場合はデフォルト文章を適用） | 任意 |

### 3. 検証 ＆ デプロイ

```bash
# 1. 型チェック・リント・テスト実行
pnpm typecheck
pnpm lint
pnpm test

# 2. 本番デプロイ
pnpm deploy
```

### 4. デプロイ後の設定 ＆ 初期化

1. **Cloudflare Zero Trust (Access) によるアクセス保護**
   - Cloudflare Dashboard > **Zero Trust** > **Access** > **Applications** で新規 Application を作成。
   - Application Path: `https://<YOUR_WORKER_DOMAIN>/checkin`
   - Policy: Allow / Emails に `OWNER_EMAIL_ADDRESS`（本人通知先）のみ許可するポリシーを設定。
2. **初回 Web Push 購読設定**
   - デプロイ後に `https://<YOUR_WORKER_DOMAIN>/checkin` へアクセス（Zero Trust 認証を通過）し、「通知を許可」ボタンを押してブラウザの通知受信設定を行います。
3. **環境変数の変更手順（運用開始後）**
   - [wrangler.jsonc](wrangler.jsonc) 内の `vars` の値を編集し、`pnpm deploy` を再実行するだけで簡単に更新できます。
   - ※ Cloudflare Dashboard > **Workers & Pages** > 本 Worker > **Settings** > **Variables and Secrets** からブラウザ上で直接編集することも可能です。

## 🛠 開発用コマンド

```bash
# ローカル開発サーバー起動
pnpm dev

# 型チェック / リント / テスト
pnpm typecheck
pnpm lint
pnpm test
```

> **[!IMPORTANT]**
>
> - **Cloudflare Email Send（完全無料 $0）**: 送信先メールアドレス（死後通知先 `KIN_EMAIL_ADDRESS` および本人通知先 `OWNER_EMAIL_ADDRESS`）は、あらかじめ Cloudflare Dashboard > **Email Routing** > **Destination Addresses** で事前登録・受信承認（Verify）を済ませておいてください。Cloudflare の仕様により、**事前認証済みの Destination Address 宛てへのメール送信は Workers Free プランを含む全プランで完全無料（$0・クォータ制限なし）** で利用できます。また、送信元として所有ドメインの `SENDER_EMAIL_ADDRESS` を `wrangler.jsonc` に指定してください。
> - **ドメイン維持・クレカ解約リスクへの対策（最悪の想定）**: 本人が死亡した際、親族がクレジットカードを解約または口座を凍結することで、ドメインの自動更新が失敗し死後通知前にドメインが失効するリスクがあります。不活動期間（`DEAD_DAYS`）を2ヶ月以上の長期に設定する場合は、**ドメインを5年〜10年分まとめて前払い（一括更新）しておくか、不活動期間を30日以内に設定する運用**を強く推奨します。
> - **Cloudflare Zero Trust**: デプロイ後、Cloudflare Dashboard > **Zero Trust** > **Access** > **Applications** で `/checkin` パスに対し本人のメールアドレスのみ許可するポリシーを設定してください。

## 📄 ライセンス

[MIT License](LICENSE)
