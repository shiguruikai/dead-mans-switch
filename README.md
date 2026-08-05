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
- **Cloudflare Email Send** / **Web Push** (VAPID / Service Worker)
- **Vitest** (`@cloudflare/vitest-pool-workers`)

---

## 🛠 クイックスタート・コマンド一覧

```bash
# 1. 依存パッケージのインストール
pnpm install

# 2. KV ネームスペース作成（出力された ID を wrangler.jsonc へ設定）
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
> - **Cloudflare Email Send（完全無料 $0）**: 送信先の親族アドレス（`KIN_EMAIL_ADDRESS`）および本人警告アドレス（`OWNER_EMAIL_ADDRESS`）は、あらかじめ **Cloudflare Dashboard > Email Routing > Destination addresses** で事前登録・受信承認（Verify）を済ませておいてください。Cloudflare の仕様により、**事前認証済みの Destination address 宛てへのメール送信は Workers Free プランを含む全プランで完全無料（$0・クォータ制限なし）** で利用できます。また、差出人として所有ドメインの `SENDER_EMAIL_ADDRESS` を `wrangler.jsonc` に指定してください。
> - **ドメイン維持・クレカ解約リスクへの対策（最悪の想定）**: 本人が死亡した際、親族がクレジットカードを解約または口座を凍結することで、ドメインの自動更新が失敗し死後通知前にドメインが失効するリスクがあります。不活動期間（`DEAD_DAYS`）を2ヶ月以上の長期に設定する場合は、**ドメインを5年〜10年分まとめて前払い（一括更新）しておくか、不活動期間を30日以内に設定する運用**を強く推奨します。
> - **Cloudflare Zero Trust**: デプロイ後、**Zero Trust > Access > Applications** で `/checkin` パスに対し本人のメールアドレスのみ許可するポリシーを設定してください。

---

## 📄 ライセンス

[MIT License](LICENSE)
