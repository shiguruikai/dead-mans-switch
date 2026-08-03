# Dead Man's Switch (`dead-mans-switch`)

Cloudflare Workers + Hono + KV 上で稼働する、全自動不活動検知・死後通知システム（セルフホスト型・本人専用）です。

日常のアクセスからアクティビティを自動検知（パッシブハートビート）し、不活動判定（デフォルト: 14日）時に指定宛先へ死後通知（メッセージ・案内）を自動送信します。手動での確認・復帰は Cloudflare Zero Trust (Access) で保護された `/checkin` ページから行えます。

---

## 📚 ドキュメント

- [要件定義書](docs/REQUIREMENTS.md)
- [アーキテクチャ・詳細設計書](docs/ARCHITECTURE.md)
- [実装進め方ガイド](docs/進め方.md) ※詳細なセットアップ・シークレット設定・デプロイ手順はこちらを参照してください。

---

## 🚀 技術スタック

- **TypeScript** (v7) / **Hono** (v4) / **pnpm**
- **Cloudflare Workers** (`nodejs_compat`) / **Cloudflare KV** / **Cron Triggers**
- **Cloudflare Zero Trust (Access)** (本人認証・アクセス制限)
- **Cloudflare Email Send** (`mimetext`) / **Web Push** (VAPID / Service Worker)
- **Vitest** (`@cloudflare/vitest-pool-workers`)

---

## 🛠 クイックスタート・コマンド一覧

```bash
# 1. 依存パッケージのインストール
pnpm install

# 2. KV ネームスペース作成（出力された ID を wrangler.toml へ設定）
pnpm wrangler kv:namespace create DMS_KV

# 3. シークレット（PING_SECRET_TOKEN, OWNER_EMAIL_ADDRESS, KIN_EMAIL_ADDRESS, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY）の設定
# ※設定コマンドの詳細リストについては「docs/進め方.md」の 3. 環境設定 & デプロイ を参照してください。

# 4. 型チェック・リント・テスト実行
pnpm typecheck
pnpm lint
pnpm test

# 5. ローカル開発サーバー起動
pnpm dev

# 6. 本番デプロイ
pnpm deploy
```

> **[!IMPORTANT]**
>
> - **Cloudflare Email Send**: 送信先の親族アドレス（`KIN_EMAIL_ADDRESS`）はあらかじめ **Cloudflare Dashboard > Email Routing > Destination addresses** で受信承認（Verify）を済ませておいてください。また、差出人として所有ドメインの `SENDER_EMAIL_ADDRESS` を `wrangler.toml` に指定してください。
> - **Cloudflare Zero Trust**: デプロイ後、**Zero Trust > Access > Applications** で `/checkin` パスに対し本人のメールアドレスのみ許可するポリシーを設定してください。

---

## 📄 ライセンス

[MIT License](LICENSE)
