# Dead Man's Switch アーキテクチャ・詳細設計書

## 1. 技術スタック

| 区分                   | 採用技術 / サービス                   | 用途・詳細                                              |
| :--------------------- | :------------------------------------ | :------------------------------------------------------ |
| **開発言語**           | TypeScript (v6.x)                     | 型安全なWorker実装                                      |
| **フレームワーク**     | Hono (v4.x)                           | 軽量Webフレームワーク                                   |
| **認証・アクセス制御** | Cloudflare Zero Trust (Access)        | `/checkin` ページの本人認証・保護（Google/Passkey）     |
| **実行基盤**           | Cloudflare Workers                    | サーバーレスランタイム (Wrangler v4, `nodejs_compat`)   |
| **静的アセット配信**   | Cloudflare Workers Static Assets      | `public/sw.js` (Service Worker) の静的自動配信          |
| **ストレージ**         | Cloudflare KV (`DMS_KV`)              | 状態・タイムスタンプ・複数端末 Web Push サブスク保存    |
| **定時実行**           | Cloudflare Cron Triggers              | 日次判定処理 (`0 0 * * *`)                              |
| **本人通知**           | Email Send + Web Push (VAPID / SW)    | 一次警告配信（メール + 全端末への Web Push 同時配信）   |
| **死後通知**           | Cloudflare Email Send (Email Routing) | 親族宛て死後通知自動送信                                |
| **テスト**             | Vitest + Workers Pool                 | 状態遷移・API自動テスト                                 |

## 2. ディレクトリ構成

```text
dead-mans-switch/
├── README.md                 # 概要と環境構築・デプロイ手順
├── docs/
│   ├── REQUIREMENTS.md       # 要件定義書
│   └── ARCHITECTURE.md       # アーキテクチャ・詳細設計書（本書）
├── package.json              # 依存関係定義
├── tsconfig.json             # TypeScript設定
├── wrangler.jsonc            # 設定・非機密環境変数（Cloudflare 推奨形式）
├── vitest.config.ts          # Vitest 設定
├── public/
│   └── sw.js                 # Service Worker（Web Push 受信 & /checkin 画面起動、Workers Assets で自動配信）
├── src/
│   ├── index.ts              # メインエントリポイント（Hono API + Cron）
│   ├── types.ts              # 型定義
│   ├── templates/
│   │   └── checkin.ts        # ダッシュボード・ロックアウト画面 HTML テンプレート
│   └── services/
│       ├── push.ts           # Web Push (VAPID) 送信モジュール
│       ├── email.ts          # メール送信モジュール（Cloudflare Email Send）
│       ├── kv.ts             # KV 操作モジュール
│       └── cron.ts           # 定時チェック・判定・無効端末クリーンアップモジュール
└── test/
    └── index.test.ts         # 自動テスト
```

## 3. KV データ設計（`DMS_KV`）

| キー                 | 型 / 値の範囲                         | 説明                                       |
| :------------------- | :------------------------------------ | :----------------------------------------- |
| `status`             | `"NORMAL"` \| `"WARNING"` \| `"DEAD"` | システムの現在状態                         |
| `last_active_at`     | ISO 8601 文字列                       | 最終アクティブ日時                         |
| `warning_sent_at`    | ISO 8601 文字列 \| `null`             | 一次警告通知成功日時                       |
| `dead_sent_at`       | ISO 8601 文字列 \| `null`             | 死後通知送信成功日時（リトライ判定用）     |
| `push_subscriptions` | JSON 配列 (`PushSubscription[]`)      | 登録済み複数端末の Web Push 購読情報リスト |

## 4. エンドポイント & Cloudflare Zero Trust ルーティング設計

### 4.1. Access ルーティング定義

Cloudflare Dashboard > **Zero Trust** > **Access** 設定にて以下のルールを適用します。

| パス / エンドポイント            | 認証制御                       | 詳細                                                                      |
| :------------------------------- | :----------------------------- | :------------------------------------------------------------------------ |
| **`GET /checkin`**               | **Protect (Access 認証必須)**  | 本人の Google アカウント / Passkey 認証を通したユーザーのみアクセス許可。 |
| **`POST /checkin/ping`**         | **Protect (Access 認証必須)**  | ダッシュボードからの手動 Ping 用。PING_SECRET_TOKEN 不要。                |
| **`POST /api/push/subscribe`**   | **Protect (Access 認証必須)**  | 本人端末からのみ Web Push 登録を許可。                                    |
| **`DELETE /api/push/subscribe`** | **Protect (Access 認証必須)**  | 本人端末からの Web Push 登録解除を許可。                                  |
| **`POST /api/ping`**             | **Bypass (X-Ping-Token 認証)** | 外部スクリプト等からの自動 Ping 用に Bypass 設定。ヘッダーで認証。        |
| **`GET /api/status`**            | **Bypass (X-Ping-Token 認証)** | デバッグ・外部状態監視用。ヘッダー認証。                                  |

※ `public/sw.js` は Workers Static Assets (`assets = { directory = "./public" }`) により Hono 側を経由せず静的に自動配信されます。

### 4.2. API 詳細仕様

#### 1. `GET /checkin`（生存確認・ステータス確認画面）

- **認証**: Cloudflare Zero Trust (Access)
- **処理**:
  - `status === "DEAD"` の場合: 「死後処理完了済み（システムロックアウト中）」のメッセージ画面を返却し、復帰ボタン・Web Push 登録操作を完全に無効化する。
  - `status !== "DEAD"` の場合: 現在のステータス（`status`）、最終アクティブ日時（`last_active_at`）、警告までの経過日数、Web Push 購読状況を表示する HTML 画面を返却。
    - 「手動生存報告（アクティビティ更新）」ボタン押下で `POST /checkin/ping` を呼び出し `NORMAL` へ復帰・`last_active_at` を更新。
    - 「この端末の Web Push 通知を許可 / 更新」ボタン押下で Web Push サブスクリプションを取得し `POST /api/push/subscribe` へ送信。
    - 「この端末の Web Push 通知登録を解除」ボタン押下で `DELETE /api/push/subscribe` へ送信。
- **レスポンス**: `200 OK` (Content-Type: `text/html; charset=utf-8`)

#### 2. `POST /checkin/ping`（ダッシュボード手動生存報告）

- **認証**: Cloudflare Zero Trust (Access 認証内)
- **処理**:
  1. `status === "DEAD"` の場合は `403 Forbidden` (`{"error": "System locked out (status is DEAD)"}`) を返却。
  2. `last_active_at` を現在時刻に更新。
  3. `WARNING` 状態の場合は `NORMAL` へ復帰し、`warning_sent_at` を `null` にクリーンアップ。
- **レスポンス**: `200 OK` (`{"success": true, "status": "NORMAL", "last_active_at": "..."}`)

#### 3. `POST /api/ping`（パッシブアクティビティ更新）

- **認証**: ヘッダー `X-Ping-Token: <PING_SECRET_TOKEN>` または Access 認証
- **認証エラー**: `401 Unauthorized`
- **処理**:
  1. `status === "DEAD"` の場合は `403 Forbidden` (`{"error": "System locked out (status is DEAD)"}`) を返却。
  2. `last_active_at` を現在時刻に更新。
  3. `WARNING` 状態の場合は `NORMAL` へ復帰し、`warning_sent_at` を `null` にクリーンアップ。
- **レスポンス**: `200 OK` (`{"success": true, "status": "NORMAL", "last_active_at": "..."}`)

#### 4. `POST /api/push/subscribe`（Web Push サブスクリプション保存・複数端末対応）

- **認証**: Cloudflare Zero Trust (Access) / ヘッダー認証
- **処理**:
  1. 受信した `PushSubscription` オブジェクトを取得。
  2. KV の `push_subscriptions`（配列）を取得。既存の配列内に同 `endpoint` が存在すれば最新データに更新し、存在しなければ配列に追加（最大20件制限）。
  3. 更新された配列を KV に保存。
- **レスポンス**: `200 OK` (`{"success": true, "total_devices": 2}`)

#### 5. `DELETE /api/push/subscribe`（Web Push サブスクリプション削除）

- **認証**: Cloudflare Zero Trust (Access) / ヘッダー認証
- **処理**:
  1. 受信した JSON 内の `endpoint` を取得。
  2. KV の `push_subscriptions` 配列から対象 `endpoint` のサブスクリプションを削除して KV を更新。
- **レスポンス**: `200 OK` (`{"success": true, "total_devices": 1}`)

#### 6. `GET /api/status`（状態確認 API）

- **認証**: ヘッダー `X-Ping-Token: <PING_SECRET_TOKEN>` または Access 認証
- **レスポンス**: `200 OK` (`{"status": "NORMAL", "days_since_active": 0.5, ...}`)

## 5. 定期実行処理（Cron Trigger）と状態遷移

Cron 実行時刻とハートビート送信時刻の誤差による判定遅延を防ぐため、一次警告（`WARNING_DAYS * 86400 - 43200` 秒）および死後処理（`DEAD_DAYS * 86400 - 43200` 秒）の両方に **12時間マージン** を適用する。

Web Push 送信時には登録されている全端末（`push_subscriptions`）へ並行一括送信（`Promise.all`）を行い、エラー応答（404 Not Found または 410 Gone）が返った期限切れ無効端末は KV 配列から自動削除（クリーンアップ）する。

```mermaid
flowchart TD
    Start["Cron Trigger（日次 00:00 UTC）"] --> Fetch["KV 状態取得"]
    Fetch --> CheckStatus{"status 判定"}

    CheckStatus -->|"NORMAL"| DiffW{"now - last_active_at\n>= WARNING_DAYS（12時間マージン込）"}
    DiffW -->|"No"| End["終了"]
    DiffW -->|"Yes"| ActionW["1. status=WARNING に更新\n2. メール + 全端末 Web Push 警告一括送信\n3. 無効端末（410/404）を KV から自動削除クリーンアップ\n4. 成功時 warning_sent_at 記録"]

    CheckStatus -->|"WARNING"| DiffD{"now - last_active_at >= DEAD_DAYS（12時間マージン込）\nかつ warning_sent_at !== null"}
    DiffD -->|"No"| CheckWRetry{"warning_sent_at === null"}
    CheckWRetry -->|"Yes（前回失敗）"| ActionW
    CheckWRetry -->|"No"| End
    DiffD -->|"Yes（警告送信完了済み）"| ActionD["1. status=DEAD 更新\n2. 親族へ SENDER_EMAIL_ADDRESS より死後通知送信\n3. 成功時 dead_sent_at 記録"]

    CheckStatus -->|"DEAD"| CheckDeadRetry{"dead_sent_at === null"}
    CheckDeadRetry -->|"Yes（前回失敗）"| ActionD
    CheckDeadRetry -->|"No"| End["終了（ロックアウト中）"]
    ActionW --> End
    ActionD --> End
```

## 6. メール送信モジュール設計

Cloudflare Workers の `send_email` バインディング（`env.EMAIL_SEND`）を利用したメール送信モジュールです。具体的な実装コードについては [src/services/email.ts](../src/services/email.ts) を参照してください。

- **送信元アドレス**: Cloudflare 上で所有・管理（Email Routing 設定済み）しているカスタムドメインのアドレス `SENDER_EMAIL_ADDRESS`（例: `noreply@yourdomain.com`）を使用します。
- **完全無料（$0）仕様**: Cloudflare Dashboard > **Email Routing** > **Destination addresses** にて事前認証（Verify）が完了しているアドレス（`KIN_EMAIL_ADDRESS` / `OWNER_EMAIL_ADDRESS`）宛てに送信する場合、Workers Free プランを含むすべてのプランで送信数上限のカウント対象外（完全無料）で直接送信可能です。
- **単一責任設計**: `sendEmail` 関数は `env.EMAIL_SEND`（送信バインディング）のみを引数として受け取り、環境変数全体（`Env`）に依存しない独立モジュールとして動作します。本文中のプレースホルダー（`${BASE_URL}` 等）の動的置換は呼び出し側で行います。

## 7. 設定・環境変数設計

本プロジェクトの設定および環境変数は [wrangler.jsonc](../wrangler.jsonc) にて管理されます。バインディングや Cron 設定の具体的な構造については [wrangler.jsonc](../wrangler.jsonc) を直接参照してください。

### 7.1. 非機密環境変数（`vars`）

- `BASE_URL`: システムの展開先 URL（チェックインページ URL の組み立てに使用）
- `WARNING_DAYS`: 一次警告を発動する不活動日数（デフォルト: 7日）
- `DEAD_DAYS`: 死後処理を発動する通算不活動日数（デフォルト: 14日）
- `WARNING_EMAIL_SUBJECT` / `WARNING_EMAIL_BODY`: 一次警告メールの件名および本文テンプレート
- `DEAD_EMAIL_SUBJECT`: 死後通知メールの件名
- `VAPID_SUBJECT`: Web Push VAPID 連絡先（例: `mailto:owner@example.com`）
- `SENDER_EMAIL_ADDRESS`: 差出人メールアドレス

### 7.2. 機密環境変数（Secrets）

認証トークンや秘密鍵などの機密情報は [wrangler.jsonc](../wrangler.jsonc) 内に直書きせず、`wrangler secret put` コマンドによって登録・保護します。各種 Secret の登録手順および詳細については [README.md](../README.md) を参照してください。
