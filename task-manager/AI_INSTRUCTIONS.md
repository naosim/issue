# AI_INSTRUCTIONS.md

> このファイルは `server.js` 内のマスター定義から自動生成されます。手動で編集しないでください。

## 1. 概要

このプロジェクトは、人間とAIが協働するためのファイルベースの課題管理システムです。
1課題 = 1つのJSONファイルとして管理します。

**重要（単一ファイル方針）**: Webサーバー機能と人間用のシングルページUIは、
**すべて `server.js` の1ファイルに統合**されています。`public/` や `index.html` などの
別ファイルは存在しません（UIのHTML/CSS/JSは `server.js` 内の `INDEX_HTML` 定数に埋め込み）。

## 2. ディレクトリ構造

```
task-manager/
├── server.js              # Webサーバー・UI・同期処理をすべて含む単一ファイル（Node.js標準モジュールのみ）
├── issues/                # アクティブな課題データ
│   ├── ISSUE-001.json
│   └── archive/           # アーカイブ済み課題
│       └── ISSUE-000.json
└── AI_INSTRUCTIONS.md     # このファイル（自動生成）
```

## 3. データフォーマット

1ファイル（`ISSUE-xxx.json`）の構造:

```json
{
  "id": "ISSUE-001",
  "title": "課題のタイトル",
  "description": "課題の詳細な説明や背景",
  "status": "todo",
  "priority": "medium",
  "labels": ["frontend", "bug"],
  "createdAt": "2026-10-14T06:00:00.000Z",
  "updatedAt": "2026-10-14T06:30:00.000Z",
  "comments": [
    {
      "author": "AI",
      "text": "対応方針についてのコメント",
      "createdAt": "2026-10-14T06:30:00.000Z"
    }
  ]
}
```

## 4. ステータスのマスター定義（Single Source of Truth）

| 識別子 | ラベル | 説明 |
| --- | --- | --- |
| `todo` | 未着手 | まだ作業に着手していない状態。 |
| `in_progress` | 進行中 | 現在作業を行っている状態。 |
| `review` | レビュー待ち | 実装が完了し、確認・レビュー待ちの状態。AIが実装したら必ず「レビュー待ち状態にする」 |
| `done` | 完了 | 作業が完了し、アーカイブ可能な状態。 |

**重要**: `status` には上記の識別子のみが使用できます。マスターに存在しない値を書き込んだ場合、サーバー側で不正値として弾かれます。

## 5. 優先度のマスター定義

| 識別子 | ラベル | 説明 |
| --- | --- | --- |
| `low` | 低 | 急ぎではない。 |
| `medium` | 中 | 通常の優先度。 |
| `high` | 高 | 優先して対応する。 |

## 6. AIの操作手順

### タスク確認
`./issues/` 内のJSONファイルを走査し、現在のタスク一覧とステータスを把握する。

### 新規作成
既存の最大ID（`./issues/` および `./issues/archive/`）を確認し、
次の3桁ゼロ埋め番号（例: `ISSUE-003`）を採番して `./issues/` 直下にJSONファイルを作成する。

### 更新・コメント追加
該当するJSONファイルを読み込み、`status` や `updatedAt` の更新、
`comments` 配列への追記を行って上書き保存する。
`updatedAt` はISO 8601形式（`new Date().toISOString()`）で更新すること。

### アーカイブ
完了して不要になったタスクのファイルは、`./issues/archive/` ディレクトリへ移動させる。
アーカイブ後は通常の一覧（`GET /api/issues`）には表示されなくなる。

## 7. 利用可能なAPI（任意）

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/meta` | ステータス／優先度マスターの取得 |
| GET | `/api/issues` | アクティブな課題一覧 |
| GET | `/api/issues/archive` | アーカイブ済み課題一覧 |
| GET | `/api/issues/:id` | 課題の取得 |
| POST | `/api/issues` | 課題の新規作成 |
| PUT | `/api/issues/:id` | 課題の更新 |
| POST | `/api/issues/:id/comments` | コメント追加 |
| POST | `/api/issues/:id/archive` | アーカイブ（ファイル移動） |
| POST | `/api/issues/:id/unarchive` | アーカイブから復元 |
| DELETE | `/api/issues/:id` | 完全削除（アーカイブ済みのみ） |

AIはファイルを直接読み書きしても、APIを利用してもよい。
