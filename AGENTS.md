# AGENTS.md

本リポジトリで開発・保守を行う AI エージェント向けの統合ガイドラインです。

## プロジェクト概要

Cloudflare Workers + Hono + KV 上で稼働する、全自動不活動検知・死後通知システム（セルフホスト型・本人専用）です。

日常のアクセスからアクティビティを自動検知（パッシブハートビート）し、規定の不活動期間（デフォルト: 14日）経過時に指定宛先へ死後通知（メッセージ・手続案内）を自動送信します。手動での状況確認・復帰は Cloudflare Zero Trust (Access) で保護された `/checkin` ページから安全に行えます。

## 技術スタック

- **言語・実行基盤**: TypeScript (v5 / v6), Node.js v24, Cloudflare Workers (`compatibility_flags = ["nodejs_compat"]`)
- **フレームワーク**: Hono (v4.x)
- **パッケージ管理**: pnpm
- **ストレージ・定時実行**: Cloudflare KV (`DMS_KV`), Cloudflare Cron Triggers (`0 0 * * *`)
- **認証・アクセス制御**: Cloudflare Zero Trust (Access)（`/checkin` ページの Google Login / Passkey 認証）
- **通知機能**:
  - **本人警告**: Cloudflare Email Send + Web Push（`web-push`, VAPID, Service Worker `public/sw.js`）※複数端末同時一括配信対応
  - **死後通知**: Cloudflare Email Send（`mimetext`, `cloudflare:email`, `SENDER_EMAIL_ADDRESS`）
- **テスト・ツール**: Vitest (`@cloudflare/vitest-pool-workers`), Wrangler (v3)

## コマンド

- `pnpm install`: 依存パッケージのインストール
- `pnpm dev`: Wrangler によるローカル開発サーバー起動 (`wrangler dev`)
- `pnpm test`: Vitest による全単体テスト実行
- `pnpm exec tsc --noEmit`: TypeScript 型チェック
- `pnpm deploy`: Cloudflare Workers への本番デプロイ
- `pnpm wrangler kv:namespace create DMS_KV`: KV ネームスペースの作成
- `pnpm wrangler secret put <KEY>`: シークレット環境変数の設定

## 設計・開発ルール

### 1. ドキュメント参照・更新ルール（コンテキスト制御）

無駄なコンテキスト消費を防ぐため、作業対象や変更影響範囲に応じて必要なドキュメントを参照・更新してください。

| 作業対象・変更内容                            | 参照・更新すべきドキュメント            |
| :-------------------------------------------- | :-------------------------------------- |
| **全般的な要件・ステート遷移の変更**          | [REQUIREMENTS.md](docs/REQUIREMENTS.md) |
| **アーキテクチャ・API・KV設計・設定等の変更** | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| **セットアップ手順・実装ロードマップの変更**  | [進め方.md](docs/進め方.md)             |
| **概要・クイックスタートコマンド等の変更**    | [README.md](README.md)                  |

### 2. ドキュメント記述ルール

- ドキュメント内リンクは常に**相対パス**を使用し、絶対パス（`file:///`）を使用しないこと。
- 日本語の文章においては、半角括弧 `()` ではなく、**全角括弧 `（）`** を使用し、前後にスペースを含めないこと（半角括弧の前後は半角スペース）。

### 3. タスク完了の定義（DoD: Definition of Done）

コード実装・変更タスクを完了とするには、以下の条件をすべて満たす必要があります：

1. **コード実装**: `docs/進め方.md` のフェーズ規定に沿ったモジュール実装
2. **検証通過**: `pnpm exec tsc --noEmit`（型チェック）および `pnpm test`（単体テスト）がエラーゼロで成功すること
3. **ドキュメント更新**: 仕様・構造の変更に伴う関連ドキュメント（`docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `README.md`, `docs/進め方.md` 等）の最新化

### 4. 仕様不整合・トラブル発生時の原則

- **不具合隠蔽の禁止**: コードと仕様書（`docs/`）の間に不整合や技術制約によるバッティングが発生した場合、独断で例外の隠蔽や無理なコード修正を行わず、原因と変更案を提示してユーザーと合意形成を行うこと。仕様変更が生じた場合はコードとドキュメントを同時に更新すること。
- **デグレード防止**: 試行錯誤やコードの修正・復元を行う際は、`git stash` や一時バックアップによる退避と差分確認を行い、既存機能やテストを破棄・退化させないこと。

## テストルール

- 新機能の追加・バグ修正時は、`test/index.test.ts` にテストケースを追加・更新し、`pnpm test` がすべて PASS することを確認すること。
- モック化（Cloudflare KV / Email / Web Push）を活用し、エッジ環境特有の挙動（12時間マージン判定、410エラー時の無効端末自動削除クリーンアップ、`DEAD` ロックアウト制御）を検証すること。

## Gitルール

- **コミットメッセージ**: `Conventional Commits` 形式（`<type>: <description>`）に準拠した簡潔な日本語。
  - 主な type: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`
- **コミットタイミング**: 原則としてモジュール単位またはロードマップの各フェーズが完了し、型チェックおよび単体テストが成功した段階でコミット提案を行うこと。
- **事前検証**: コミット前に必ず `pnpm exec tsc --noEmit` および `pnpm test` を実行すること。
- **ユーザー確認の必須**: ユーザーの明示的な指示がない限り、自動で `git commit` や `git push` を行ってはならない。必ず事前にユーザーの確認と許可を得ること。

## 禁止事項

- **不要なコマンド実行の禁止**: 変更ファイルが Markdown（`*.md`）のみの場合、型チェック・ビルド・テスト等のコマンドを実行しないでください。
- **無断の秘密情報ハードコーディング**: API トークン、メールアドレス、VAPID 秘密鍵等のシークレットをソースコードや `wrangler.toml` にハードコーディングしないでください。
