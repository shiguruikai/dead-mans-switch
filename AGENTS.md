# AGENTS.md

本リポジトリで開発・保守を行う AI エージェント向けの統合ガイドラインです。

## プロジェクト概要

Cloudflare Workers + Hono + KV 上で稼働する、全自動不活動検知・死後通知システム（セルフホスト型・本人専用）です。

日常のアクセスからアクティビティを自動検知（パッシブハートビート）し、規定の不活動期間（デフォルト: 14日）経過時に指定宛先へ死後通知（メッセージ・手続案内）を自動送信します。手動での状況確認・復帰は Cloudflare Zero Trust (Access) で保護された `/checkin` ページから安全に行えます。

## 技術スタック

- **言語・実行基盤**: TypeScript (v6.x), Node.js v24, Cloudflare Workers (`compatibility_flags = ["nodejs_compat"]`)
- **フレームワーク**: Hono (v4.x)
- **パッケージ管理**: pnpm
- **ストレージ・定時実行**: Cloudflare KV (`DMS_KV`), Cloudflare Cron Triggers (`0 0 * * *`)
- **認証・アクセス制御**: Cloudflare Zero Trust (Access)（`/checkin` ページの Google Login / Passkey 認証）
- **通知機能**:
  - **本人警告**: Cloudflare Email Send + Web Push（`web-push`, VAPID, Service Worker `public/sw.js`）※複数端末同時一括配信対応
  - **死後通知**: Cloudflare Email Send（`EmailMessageBuilder`, `SENDER_EMAIL_ADDRESS`）
- **品質・テスト・ツール**: Vitest (`@cloudflare/vitest-pool-workers`), ESLint (v10, Flat Config, `@stylistic`), Wrangler (v4)

## コマンド

- `pnpm install`: 依存パッケージのインストール
- `pnpm dev`: Wrangler によるローカル開発サーバー起動 (`wrangler dev`)
- `pnpm typecheck`: 型定義自動生成（`cf-typegen`）および TypeScript 型チェック (`tsc --noEmit`)
- `pnpm lint`: ESLint によるコード静的解析
- `pnpm lint:fix`: ESLint による自動修復
- `pnpm test`: Vitest による全単体テスト実行
- `pnpm deploy`: Cloudflare Workers への本番デプロイ
- `pnpm wrangler kv:namespace create DMS_KV`: KV ネームスペースの作成
- `pnpm wrangler secret put <KEY>`: シークレット環境変数の設定

## 設計・開発ルール

### 1. ドキュメント参照・更新ルール

作業対象に応じた関連ドキュメントを参照・更新すること。

| 作業対象・変更内容                            | 参照・更新すべきドキュメント            |
| :-------------------------------------------- | :-------------------------------------- |
| **全般的な要件・ステート遷移の変更**          | [REQUIREMENTS.md](docs/REQUIREMENTS.md) |
| **アーキテクチャ・API・KV設計・設定等の変更** | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **概要・セットアップ・デプロイ手順の変更**    | [README.md](README.md)                  |

### 2. ドキュメント記述ルール

- ドキュメント内リンクは相対パスを使用し、絶対パス（`file:///`）を使用しないこと。
- 日本語の文章においては、半角括弧 `()` ではなく全角括弧 `（）` を使用し、前後にスペースを含めないこと（半角括弧の前後は半角スペース）。

### 3. タスク完了の定義（DoD: Definition of Done）

タスク完了には以下の全条件を満たすこと：

1. **実装**: 仕様に沿ったモジュール実装
2. **検証成功**: `pnpm typecheck`（型チェック）、`pnpm lint`（ESLint）、`pnpm test`（単体テスト）がすべてエラーゼロで成功すること
3. **ドキュメント同期**: 仕様・構造変更に伴う関連ドキュメントの最新化

### 4. 仕様不整合・トラブル発生時の原則

- **不具合隠蔽の禁止**: 仕様との不整合が発生した場合、原因と変更案を提示しユーザーと合意形成を行うこと。
- **デグレード防止**: 変更の破棄や復元時は `git stash` や一時退避を行い、既存の合格状態を破壊しないこと。

## Gitルール

- **事前検証**: コミット前に必ず `pnpm typecheck`、`pnpm lint`、`pnpm test` をすべて実行し成功させること。
- **コミットメッセージ**: `Conventional Commits` 形式（`<type>: <description>`）に準拠し、`<description>` は簡潔な日本語で記述すること（例: `feat: ESLintの導入`）。
- **ユーザー確認**: ユーザーの明示的な指示がない限り、自動で `git commit` や `git push` を行わず事前に許可を得ること。

## 禁止事項

- **不要な検証コマンド実行の禁止**: 変更ファイルが Markdown（`*.md`）のみの場合、型チェック・ビルド・テスト等のコマンドを実行しないこと。
- **秘密情報のハードコーディング禁止**: API トークン等のシークレットをソースコードや設定ファイルに直書きしないこと。
