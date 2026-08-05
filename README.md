# Dead Man's Switch (`dead-mans-switch`)

Cloudflare Workers + Hono + KV 上で稼働する、全自動不活動検知・死後通知システム（セルフホスト型・本人専用）です。

日常のアクセスからアクティビティを自動検知（パッシブハートビート）し、不活動判定（デフォルト: 14日）時に指定宛先へ死後通知（メッセージ・案内）を自動送信します。手動での確認・復帰は Cloudflare Zero Trust (Access) で保護された `/checkin` ページから行えます。

## 📚 ドキュメント

- [要件定義書](docs/REQUIREMENTS.md)
- [アーキテクチャ・詳細設計書](docs/ARCHITECTURE.md)

## 🚀 技術スタック

- TypeScript (v6) / Hono (v4) / pnpm
- Cloudflare Workers (`nodejs_compat`) / Cloudflare KV / Cron Triggers
- Cloudflare Zero Trust (Access) (本人認証・アクセス制限)
- Cloudflare Email Send / Web Push (VAPID / Service Worker)
- Vitest (`@cloudflare/vitest-pool-workers`)

## 🚀 新規デプロイ手順

本システムを新規でセルフホストデプロイするための手順です。

### 1. 事前準備（外部サービス・鍵の生成）

1. **Cloudflare Email Routing の Destination address 登録・承認**
   - Cloudflare Dashboard > **Email Routing** > **Destination addresses** にて、送信先アドレス（親族宛 `KIN_EMAIL_ADDRESS` および本人宛 `OWNER_EMAIL_ADDRESS`）を追加し、受信メール内の確認リンクをクリックして `Verified`（認証済み）にします。
   - 差出人用アドレス（例: `noreply@yourdomain.com`）を決めておきます。
2. **Web Push 用 VAPID 鍵ペアの生成**
   - 以下のコマンドを実行し、表示された Public Key と Private Key を控えておきます。

     ```bash
     pnpm dlx web-push generate-vapid-keys
     ```

### 2. ローカル設定 ＆ KV ネームスペース作成

1. **依存パッケージのインストール**

   ```bash
   pnpm install
   ```

2. **Cloudflare KV ネームスペースの作成**

   ```bash
   pnpm wrangler kv:namespace create DMS_KV
   ```

   - 出力された ID を [wrangler.jsonc](wrangler.jsonc) の `kv_namespaces[0].id` に設定します。
3. **`wrangler.jsonc` の環境変数設定**
   - [wrangler.jsonc](wrangler.jsonc) の `vars` セクションを環境に合わせて編集します。
     - `BASE_URL`: Workers 展開先 URL（例: `https://dead-mans-switch.<subdomain>.workers.dev`）
     - `SENDER_EMAIL_ADDRESS`: 自身の所有ドメイン送信元アドレス
     - `VAPID_SUBJECT`: `mailto:OWNER_EMAIL_ADDRESS`

### 3. シークレット環境変数の設定

Cloudflare Workers に必要なシークレットを登録します。

```bash
# パッシブハートビート用 API 認証トークン（任意のランダム文字列）
pnpm wrangler secret put PING_SECRET_TOKEN

# 本人メールアドレス
pnpm wrangler secret put OWNER_EMAIL_ADDRESS

# 死後通知先メールアドレス
pnpm wrangler secret put KIN_EMAIL_ADDRESS

# VAPID 鍵
pnpm wrangler secret put VAPID_PUBLIC_KEY
pnpm wrangler secret put VAPID_PRIVATE_KEY

# 死後通知本文（任意: 未設定時はデフォルト文章を適用）
pnpm wrangler secret put DEAD_EMAIL_BODY
```

### 4. 検証 ＆ デプロイ

```bash
# 1. 型チェック・リント・テスト実行
pnpm typecheck
pnpm lint
pnpm test

# 2. 本番デプロイ
pnpm deploy
```

### 5. デプロイ後の設定 ＆ 初期化

1. **Cloudflare Zero Trust (Access) によるアクセス保護**
   - Cloudflare Dashboard > **Zero Trust** > **Access** > **Applications** で新規 Application を作成。
   - Application Path: `https://<YOUR_WORKER_DOMAIN>/checkin`
   - Policy: Allow / Emails に `OWNER_EMAIL_ADDRESS`（本人）のみ許可するポリシーを設定。
2. **初回 Web Push 購読設定**
   - デプロイ後に `https://<YOUR_WORKER_DOMAIN>/checkin` へアクセス（Zero Trust 認証を通過）し、「通知を許可」ボタンを押してブラウザの通知受信設定を行います。

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
> - **Cloudflare Email Send（完全無料 $0）**: 送信先の親族アドレス（`KIN_EMAIL_ADDRESS`）および本人警告アドレス（`OWNER_EMAIL_ADDRESS`）は、あらかじめ Cloudflare Dashboard > **Email Routing** > **Destination addresses** で事前登録・受信承認（Verify）を済ませておいてください。Cloudflare の仕様により、**事前認証済みの Destination address 宛てへのメール送信は Workers Free プランを含む全プランで完全無料（$0・クォータ制限なし）** で利用できます。また、差出人として所有ドメインの `SENDER_EMAIL_ADDRESS` を `wrangler.jsonc` に指定してください。
> - **ドメイン維持・クレカ解約リスクへの対策（最悪の想定）**: 本人が死亡した際、親族がクレジットカードを解約または口座を凍結することで、ドメインの自動更新が失敗し死後通知前にドメインが失効するリスクがあります。不活動期間（`DEAD_DAYS`）を2ヶ月以上の長期に設定する場合は、**ドメインを5年〜10年分まとめて前払い（一括更新）しておくか、不活動期間を30日以内に設定する運用**を強く推奨します。
> - **Cloudflare Zero Trust**: デプロイ後、Cloudflare Dashboard > **Zero Trust** > **Access** > **Applications** で `/checkin` パスに対し本人のメールアドレスのみ許可するポリシーを設定してください。

## 📄 ライセンス

[MIT License](LICENSE)
