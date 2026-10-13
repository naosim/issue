# ファイルベースの課題管理アプリ

人間とAIが一緒に課題を管理するための、軽量なWebアプリです。課題は1件につき1つのJSONファイルとして保存し、人間はブラウザーから、AIはファイルシステムまたはAPIから操作できます。

> このアプリはGitHub Issuesとは連携しません。GitHubで公開したリポジトリ上で利用できる、独立した課題管理アプリです。

## 特長

- Node.jsの標準モジュールのみで動作し、外部ライブラリやビルド手順は不要
- Webサーバーと人間向けUIを `server.js` 1ファイルに集約
- 課題の作成・編集、ステータスや優先度の設定、コメント追加に対応
- 課題データはJSONファイルなので、AIやほかのツールから直接読み書き可能
- 完了した課題をアーカイブし、必要なときに復元可能
- ステータス定義をサーバー側で一元管理し、AI向けの `AI_INSTRUCTIONS.md` を起動時に自動生成

## 必要なもの

- Node.js（Node.js 18以降を推奨）

## 起動方法

リポジトリを取得したあと、アプリのディレクトリでサーバーを起動します。

```sh
cd task-manager
node server.js
```

ブラウザーで <http://localhost:3000> を開いてください。ポートを変更する場合は、`PORT` 環境変数を指定します。

PowerShellの例:

```powershell
$env:PORT = "3001"
node server.js
```

終了するには、起動したターミナルで `Ctrl+C` を押します。

## 使い方

### 人間

ブラウザーの画面から課題を一覧・検索し、作成、編集、コメント追加、アーカイブ、復元を行えます。通常の一覧にはアクティブな課題が表示され、アーカイブ済みの課題はアーカイブ一覧から確認できます。

### AI

AI向けの操作手順とデータ形式は [`task-manager/AI_INSTRUCTIONS.md`](task-manager/AI_INSTRUCTIONS.md) にあります。このファイルは `server.js` のマスター定義から生成されるため、手動編集しても次回起動時に上書きされます。

AIは `task-manager/issues/` 内のJSONファイルを直接読み書きできます。アーカイブ済み課題は `task-manager/issues/archive/` に保存されます。課題のステータスや優先度を更新するときは、以下の有効値を使用してください。

| 項目 | 有効値 |
| --- | --- |
| ステータス | `todo`（未着手）、`in_progress`（進行中）、`review`（レビュー待ち）、`done`（完了） |
| 優先度 | `low`（低）、`medium`（中）、`high`（高） |

## データの保存場所

```text
task-manager/
├── server.js
├── AI_INSTRUCTIONS.md   # 起動時に自動生成
└── issues/
    ├── ISSUE-001.json   # アクティブな課題
    └── archive/         # アーカイブ済み課題
```

課題データはリポジトリ内に保存されます。バックアップや共有を行う場合は `task-manager/issues/` を保護してください。GitHubにリポジトリを公開する際、課題データもリポジトリに含めるかどうかを確認してください。

## API

サーバーは以下のHTTP APIを提供します。AIやスクリプトから利用できます。

| メソッド | パス | 説明 |
| --- | --- | --- |
| `GET` | `/api/meta` | ステータスと優先度のマスター定義 |
| `GET` | `/api/issues` | アクティブな課題一覧 |
| `GET` | `/api/issues/archive` | アーカイブ済み課題一覧 |
| `GET` | `/api/issues/:id` | 課題の取得 |
| `POST` | `/api/issues` | 課題の新規作成 |
| `PUT` | `/api/issues/:id` | 課題の更新 |
| `POST` | `/api/issues/:id/comments` | コメントの追加 |
| `POST` | `/api/issues/:id/archive` | 課題のアーカイブ |
| `POST` | `/api/issues/:id/unarchive` | 課題の復元 |
| `DELETE` | `/api/issues/:id` | アーカイブ済み課題の完全削除 |

課題のJSON形式や操作の詳細は [`task-manager/AI_INSTRUCTIONS.md`](task-manager/AI_INSTRUCTIONS.md) を参照してください。

## 公開・セキュリティ上の注意

このアプリには認証機能がありません。サーバーを起動すると、同じネットワーク上からアクセス可能になる場合があります。信頼できないネットワークやインターネットに、認証やアクセス制御なしで直接公開しないでください。

## ライセンス

ライセンスはまだ設定されていません。再利用・改変・再配布を許可する場合は、公開前にリポジトリへ適切なライセンスを追加してください。
