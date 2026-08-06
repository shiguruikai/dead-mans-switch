# AGENTS.md

## Dead Man's Switch プロジェクト概要

Cloudflare Workers 上で稼働する、個人専用のセルフホスト型死後通知システムです。

指定した期間アクセスや更新がない場合、死後通知のメールを事前に設定した送信先へ自動送信します。手動での生存報告や状況確認は Cloudflare Zero Trust で保護された生存確認画面（`/`）から安全に行えます。

## 技術スタック

- **言語・実行基盤**: TypeScript (v6), Cloudflare Workers (`nodejs_compat`)
- **フレームワーク**: Hono / Hono JSX (v4), Vite (v8), Zod (v4)
- **ストレージ・定時実行**: Cloudflare KV, Cron Triggers
- **認証**: Cloudflare Zero Trust
- **通知**: Cloudflare Email Service, Web Push
- **テスト・ツール**: Vitest, ESLint, Wrangler, pnpm

## コマンド

- `pnpm install`: 依存パッケージのインストール
- `pnpm dev`: Vite + Wrangler によるローカル開発サーバー起動 (`vite`)
- `pnpm build`: Vite による本番ビルド (`vite build`)
- `pnpm typecheck`: 型定義自動生成（`cf-typegen`）および TypeScript 型チェック (`tsc --noEmit`)
- `pnpm lint:fix`: `eslint --fix .`
- `pnpm test`: Vitest による全単体テスト実行
- `pnpm deploy`: Cloudflare Workers への本番デプロイ (`pnpm build && wrangler deploy --minify`)
- `pnpm wrangler kv namespace create DMS_KV`: KV ネームスペースの作成

## 設計・開発ルール

### 1. ドキュメント参照・更新ルール

作業対象に応じた関連ドキュメントを参照・更新すること。

| 作業対象・変更内容 | 参照・更新すべきドキュメント |
| :--- | :--- |
| **全般的な要件・ステート遷移の変更** | [REQUIREMENTS.md](docs/REQUIREMENTS.md) |
| **アーキテクチャ・API・KV設計・設定等の変更** | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **概要・セットアップ・デプロイ手順の変更** | [README.md](README.md) |

### 2. ドキュメント記述ルール

- ドキュメント内リンクは相対パスを使用し、絶対パス（`file:///`）を使用しないこと。
- 日本語の文章においては、半角括弧 `()` ではなく全角括弧 `（）` を使用し、前後にスペースを含めないこと（半角括弧の前後は半角スペース）。

### 3. タスク完了の定義（DoD: Definition of Done）

タスク完了には以下の全条件を満たすこと：

1. **実装**: 仕様に沿ったモジュール実装
2. **検証成功**: ESLint の自動修正が型表現を変形させるリスクを考慮し、必ず `pnpm lint:fix` ➔ `pnpm typecheck` ➔ `pnpm test`（必要に応じて `pnpm build`）の順序で全コマンドを実行し成功させること。
3. **ドキュメント同期**: 仕様・構造変更に伴う関連ドキュメントの最新化

### 4. 仕様不整合・トラブル発生時の原則

- **不具合隠蔽の禁止**: 仕様との不整合が発生した場合、原因と変更案を提示しユーザーと合意形成を行うこと。
- **デグレード防止**: 変更の破棄や復元時は `git stash` や一時退避を行い、既存の合格状態を破壊しないこと。

## Gitルール

- **事前検証**: コミット前に必ず `pnpm lint:fix` ➔ `pnpm typecheck` ➔ `pnpm test` の順序で全コマンドを実行し成功させること。
- **コミットメッセージ**: `Conventional Commits` 形式（`<type>: <description>`）に準拠し、`<description>` は簡潔な日本語で記述すること。
- **ユーザー確認**: ユーザーの明示的な指示がない限り、自動で `git commit` や `git push` を行わず事前に許可を得ること。

## 禁止事項

- **不要な検証コマンド実行の禁止**: 変更ファイルが Markdown（`*.md`）のみの場合、型チェック・ビルド・テスト等のコマンドを実行しないこと。
- **秘密情報のGitコミット禁止**: API トークン等の機密情報を Git 管理対象ファイル（wrangler.jsonc.example 等）に直接含めないこと。
