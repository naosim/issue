'use strict';

/*
 * 課題管理アプリ（GitHub Issue風・ファイルベース）
 * Node.js 標準モジュールのみで動作するWebサーバー。
 *
 * 起動時:
 *   - issues/ と issues/archive/ を用意する
 *   - STATUS_MASTER を元に AI_INSTRUCTIONS.md を自動生成・上書きする
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ISSUES_DIR = path.join(ROOT, 'issues');
const ARCHIVE_DIR = path.join(ISSUES_DIR, 'archive');
const INSTRUCTIONS_PATH = path.join(ROOT, 'AI_INSTRUCTIONS.md');
const PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------------------
// マスター定義（Single Source of Truth）
// ---------------------------------------------------------------------------

const STATUS_MASTER = [
  { id: 'todo', label: '未着手', description: 'まだ作業に着手していない状態。' },
  { id: 'in_progress', label: '進行中', description: '現在作業を行っている状態。' },
  { id: 'review', label: 'レビュー待ち', description: '実装が完了し、確認・レビュー待ちの状態。AIが実装したら必ず「レビュー待ち状態にする」' },
  { id: 'done', label: '完了', description: '作業が完了し、アーカイブ可能な状態。' },
];

const PRIORITY_MASTER = [
  { id: 'low', label: '低', description: '急ぎではない。' },
  { id: 'medium', label: '中', description: '通常の優先度。' },
  { id: 'high', label: '高', description: '優先して対応する。' },
];

const DEFAULT_STATUS = 'todo';
const DEFAULT_PRIORITY = 'medium';
const ID_PATTERN = /^ISSUE-\d{3,}$/;

function isKnownStatus(value) {
  return STATUS_MASTER.some((s) => s.id === value);
}

function isKnownPriority(value) {
  return PRIORITY_MASTER.some((p) => p.id === value);
}

// ---------------------------------------------------------------------------
// ファイルシステム操作
// ---------------------------------------------------------------------------

function ensureDirs() {
  fs.mkdirSync(ISSUES_DIR, { recursive: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

function listIssueFilenames(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^ISSUE-\d+\.json$/.test(name))
    .sort();
}

function readIssueFile(dir, filename) {
  const raw = fs.readFileSync(path.join(dir, filename), 'utf8');
  return JSON.parse(raw);
}

function readIssues(dir) {
  const issues = [];
  for (const filename of listIssueFilenames(dir)) {
    try {
      issues.push(readIssueFile(dir, filename));
    } catch (err) {
      console.error(`[warn] 読み込みに失敗しました: ${filename} (${err.message})`);
    }
  }
  issues.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return issues;
}

function writeJsonAtomic(filePath, obj) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function locateIssue(id) {
  const filename = `${id}.json`;
  const activePath = path.join(ISSUES_DIR, filename);
  if (fs.existsSync(activePath)) {
    return { dir: ISSUES_DIR, archived: false, filename, filePath: activePath };
  }
  const archivedPath = path.join(ARCHIVE_DIR, filename);
  if (fs.existsSync(archivedPath)) {
    return { dir: ARCHIVE_DIR, archived: true, filename, filePath: archivedPath };
  }
  return null;
}

function collectAllIds() {
  const ids = [];
  for (const dir of [ISSUES_DIR, ARCHIVE_DIR]) {
    for (const filename of listIssueFilenames(dir)) {
      ids.push(filename.replace(/\.json$/, ''));
    }
  }
  return ids;
}

function nextIssueId() {
  let max = 0;
  for (const id of collectAllIds()) {
    const match = id.match(/^ISSUE-(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `ISSUE-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------------

function toTrimmedString(value, maxLength = 20000) {
  if (typeof value !== 'string') return null;
  return value.slice(0, maxLength).trim();
}

function normalizeLabels(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push('labels は配列である必要があります。');
    return [];
  }
  return value
    .filter((label) => typeof label === 'string')
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .slice(0, 50);
}

function buildNewIssue(input) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};

  const title = toTrimmedString(src.title, 200);
  if (!title) errors.push('title は必須です。');

  const description = toTrimmedString(src.description, 20000) || '';

  const status = src.status === undefined || src.status === null ? DEFAULT_STATUS : src.status;
  if (!isKnownStatus(status)) {
    errors.push(`status が不正です。有効値: ${STATUS_MASTER.map((s) => s.id).join(', ')}`);
  }

  const priority =
    src.priority === undefined || src.priority === null ? DEFAULT_PRIORITY : src.priority;
  if (!isKnownPriority(priority)) {
    errors.push(`priority が不正です。有効値: ${PRIORITY_MASTER.map((p) => p.id).join(', ')}`);
  }

  const labels = normalizeLabels(src.labels, errors);

  if (errors.length > 0) return { ok: false, errors };

  const now = new Date().toISOString();
  const issue = {
    id: nextIssueId(),
    title,
    description,
    status,
    priority,
    labels,
    createdAt: now,
    updatedAt: now,
    comments: [],
  };
  return { ok: true, issue };
}

function applyUpdate(existing, input) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};
  const updated = { ...existing };

  if (src.title !== undefined) {
    const title = toTrimmedString(src.title, 200);
    if (!title) errors.push('title を空にはできません。');
    else updated.title = title;
  }

  if (src.description !== undefined) {
    updated.description = toTrimmedString(src.description, 20000) || '';
  }

  if (src.status !== undefined) {
    if (!isKnownStatus(src.status)) {
      errors.push(`status が不正です。有効値: ${STATUS_MASTER.map((s) => s.id).join(', ')}`);
    } else {
      updated.status = src.status;
    }
  }

  if (src.priority !== undefined) {
    if (!isKnownPriority(src.priority)) {
      errors.push(`priority が不正です。有効値: ${PRIORITY_MASTER.map((p) => p.id).join(', ')}`);
    } else {
      updated.priority = src.priority;
    }
  }

  if (src.labels !== undefined) {
    updated.labels = normalizeLabels(src.labels, errors);
  }

  if (errors.length > 0) return { ok: false, errors };

  updated.updatedAt = new Date().toISOString();
  return { ok: true, issue: updated };
}

// ---------------------------------------------------------------------------
// AI_INSTRUCTIONS.md 自動生成
// ---------------------------------------------------------------------------

function buildInstructionsMarkdown() {
  const statusRows = STATUS_MASTER.map(
    (s) => `| \`${s.id}\` | ${s.label} | ${s.description} |`
  ).join('\n');
  const priorityRows = PRIORITY_MASTER.map(
    (p) => `| \`${p.id}\` | ${p.label} | ${p.description} |`
  ).join('\n');

  return `# AI_INSTRUCTIONS.md

> このファイルは \`server.js\` 内のマスター定義から自動生成されます。手動で編集しないでください。

## 1. 概要

このプロジェクトは、人間とAIが協働するためのファイルベースの課題管理システムです。
1課題 = 1つのJSONファイルとして管理します。

**重要（単一ファイル方針）**: Webサーバー機能と人間用のシングルページUIは、
**すべて \`server.js\` の1ファイルに統合**されています。\`public/\` や \`index.html\` などの
別ファイルは存在しません（UIのHTML/CSS/JSは \`server.js\` 内の \`INDEX_HTML\` 定数に埋め込み）。

## 2. ディレクトリ構造

\`\`\`
task-manager/
├── server.js              # Webサーバー・UI・同期処理をすべて含む単一ファイル（Node.js標準モジュールのみ）
├── issues/                # アクティブな課題データ
│   ├── ISSUE-001.json
│   └── archive/           # アーカイブ済み課題
│       └── ISSUE-000.json
└── AI_INSTRUCTIONS.md     # このファイル（自動生成）
\`\`\`

## 3. データフォーマット

1ファイル（\`ISSUE-xxx.json\`）の構造:

\`\`\`json
{
  "id": "ISSUE-001",
  "title": "課題のタイトル",
  "description": "課題の詳細な説明や背景",
  "status": "${DEFAULT_STATUS}",
  "priority": "${DEFAULT_PRIORITY}",
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
\`\`\`

## 4. ステータスのマスター定義（Single Source of Truth）

| 識別子 | ラベル | 説明 |
| --- | --- | --- |
${statusRows}

**重要**: \`status\` には上記の識別子のみが使用できます。マスターに存在しない値を書き込んだ場合、サーバー側で不正値として弾かれます。

## 5. 優先度のマスター定義

| 識別子 | ラベル | 説明 |
| --- | --- | --- |
${priorityRows}

## 6. AIの操作手順

### タスク確認
\`./issues/\` 内のJSONファイルを走査し、現在のタスク一覧とステータスを把握する。

### 新規作成
既存の最大ID（\`./issues/\` および \`./issues/archive/\`）を確認し、
次の3桁ゼロ埋め番号（例: \`ISSUE-003\`）を採番して \`./issues/\` 直下にJSONファイルを作成する。

### 更新・コメント追加
該当するJSONファイルを読み込み、\`status\` や \`updatedAt\` の更新、
\`comments\` 配列への追記を行って上書き保存する。
\`updatedAt\` はISO 8601形式（\`new Date().toISOString()\`）で更新すること。

### アーカイブ
完了して不要になったタスクのファイルは、\`./issues/archive/\` ディレクトリへ移動させる。
アーカイブ後は通常の一覧（\`GET /api/issues\`）には表示されなくなる。

## 7. 利用可能なAPI（任意）

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | \`/api/meta\` | ステータス／優先度マスターの取得 |
| GET | \`/api/issues\` | アクティブな課題一覧 |
| GET | \`/api/issues/archive\` | アーカイブ済み課題一覧 |
| GET | \`/api/issues/:id\` | 課題の取得 |
| POST | \`/api/issues\` | 課題の新規作成 |
| PUT | \`/api/issues/:id\` | 課題の更新 |
| POST | \`/api/issues/:id/comments\` | コメント追加 |
| POST | \`/api/issues/:id/archive\` | アーカイブ（ファイル移動） |
| POST | \`/api/issues/:id/unarchive\` | アーカイブから復元 |
| DELETE | \`/api/issues/:id\` | 完全削除（アーカイブ済みのみ） |

AIはファイルを直接読み書きしても、APIを利用してもよい。
`;
}

function syncInstructions() {
  const markdown = buildInstructionsMarkdown();
  let current = null;
  try {
    current = fs.readFileSync(INSTRUCTIONS_PATH, 'utf8');
  } catch {
    current = null;
  }
  if (current !== markdown) {
    fs.writeFileSync(INSTRUCTIONS_PATH, markdown, 'utf8');
    console.log('AI_INSTRUCTIONS.md を自動生成しました。');
  }
}

// ---------------------------------------------------------------------------
// HTTPヘルパー
// ---------------------------------------------------------------------------

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('リクエストボディが大きすぎます。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('不正なJSONです。'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// ルーティング
// ---------------------------------------------------------------------------

async function handleApi(req, res, pathname) {
  const method = req.method.toUpperCase();

  if (pathname === '/api/meta' && method === 'GET') {
    return sendJson(res, 200, {
      statuses: STATUS_MASTER,
      priorities: PRIORITY_MASTER,
      defaultStatus: DEFAULT_STATUS,
      defaultPriority: DEFAULT_PRIORITY,
    });
  }

  if (pathname === '/api/instructions' && method === 'GET') {
    return sendText(res, 200, buildInstructionsMarkdown(), 'text/markdown; charset=utf-8');
  }

  if (pathname === '/api/issues' && method === 'GET') {
    return sendJson(res, 200, { issues: readIssues(ISSUES_DIR) });
  }

  if (pathname === '/api/issues' && method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const result = buildNewIssue(body);
    if (!result.ok) return sendJson(res, 400, { errors: result.errors });
    writeJsonAtomic(path.join(ISSUES_DIR, `${result.issue.id}.json`), result.issue);
    return sendJson(res, 201, { issue: result.issue });
  }

  if (pathname === '/api/issues/archive' && method === 'GET') {
    return sendJson(res, 200, { issues: readIssues(ARCHIVE_DIR) });
  }

  const issueMatch = pathname.match(/^\/api\/issues\/(ISSUE-\d{3,})$/);
  if (issueMatch) {
    const id = issueMatch[1];
    const located = locateIssue(id);
    if (!located) return sendJson(res, 404, { error: `課題が見つかりません: ${id}` });

    if (method === 'GET') {
      return sendJson(res, 200, { issue: readIssueFile(located.dir, located.filename) });
    }

    if (method === 'PUT') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
      const existing = readIssueFile(located.dir, located.filename);
      const result = applyUpdate(existing, body);
      if (!result.ok) return sendJson(res, 400, { errors: result.errors });
      writeJsonAtomic(located.filePath, result.issue);
      return sendJson(res, 200, { issue: result.issue });
    }

    if (method === 'DELETE') {
      if (!located.archived) {
        return sendJson(res, 409, {
          error: 'アクティブな課題は削除できません。まずアーカイブしてください。',
        });
      }
      fs.unlinkSync(located.filePath);
      return sendJson(res, 200, { ok: true, id });
    }
  }

  const commentMatch = pathname.match(/^\/api\/issues\/(ISSUE-\d{3,})\/comments$/);
  if (commentMatch && method === 'POST') {
    const id = commentMatch[1];
    const located = locateIssue(id);
    if (!located) return sendJson(res, 404, { error: `課題が見つかりません: ${id}` });

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const errors = [];
    const text = toTrimmedString(body.text, 10000);
    if (!text) errors.push('text は必須です。');
    const author = toTrimmedString(body.author, 100) || 'human';
    if (errors.length > 0) return sendJson(res, 400, { errors });

    const issue = readIssueFile(located.dir, located.filename);
    if (!Array.isArray(issue.comments)) issue.comments = [];
    const now = new Date().toISOString();
    issue.comments.push({ author, text, createdAt: now });
    issue.updatedAt = now;
    writeJsonAtomic(located.filePath, issue);
    return sendJson(res, 201, { issue });
  }

  const archiveActionMatch = pathname.match(
    /^\/api\/issues\/(ISSUE-\d{3,})\/(archive|unarchive)$/
  );
  if (archiveActionMatch && method === 'POST') {
    const [, id, action] = archiveActionMatch;
    const located = locateIssue(id);
    if (!located) return sendJson(res, 404, { error: `課題が見つかりません: ${id}` });

    const targetDir = action === 'archive' ? ARCHIVE_DIR : ISSUES_DIR;
    const destPath = path.join(targetDir, located.filename);

    if (located.filePath === destPath) {
      return sendJson(res, 200, { ok: true, id, archived: action === 'archive' });
    }
    if (fs.existsSync(destPath)) {
      return sendJson(res, 409, { error: `移動先に同名ファイルが存在します: ${located.filename}` });
    }

    fs.renameSync(located.filePath, destPath);
    const issue = readIssueFile(targetDir, located.filename);
    issue.updatedAt = new Date().toISOString();
    writeJsonAtomic(destPath, issue);
    return sendJson(res, 200, { ok: true, id, archived: action === 'archive', issue });
  }

  return sendJson(res, 404, { error: 'エンドポイントが見つかりません。' });
}

// 埋め込みシングルページUI（外部ファイルは使用しない）
const INDEX_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>課題管理</title>
<style>
  :root {
    --bg: #0d1117;
    --panel: #161b22;
    --panel-2: #1f2630;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #2f81f7;
    --danger: #f85149;
    --ok: #3fb950;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  header h1 { font-size: 16px; margin: 0; }
  header .spacer { flex: 1; }
  button {
    font: inherit;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    padding: 6px 12px;
    border-radius: 6px;
    transition: background .15s, border-color .15s;
  }
  button:hover { background: #2d333b; }
  button.primary { background: #238636; border-color: #2ea043; }
  button.primary:hover { background: #2ea043; }
  button.danger { background: #4a1f1f; border-color: #7a2b2b; }
  button.danger:hover { background: #6b2323; }
  button.ghost { background: transparent; }
  input, select, textarea {
    font: inherit;
    width: 100%;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 9px;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 80px; }
  .layout { display: grid; grid-template-columns: minmax(280px, 380px) 1fr; gap: 16px; padding: 16px; align-items: start; }
  @media (max-width: 820px) { .layout { grid-template-columns: 1fr; } }
  .col-title { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 8px; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 10px; }
  .toolbar input { flex: 1; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    cursor: pointer;
  }
  .card:hover { border-color: var(--accent); }
  .card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .card .id { color: var(--muted); font-family: ui-monospace, monospace; font-size: 12px; }
  .card .title { margin: 4px 0 6px; font-weight: 600; }
  .card .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid transparent; }
  .badge.status-todo { background: #30363d; color: #c9d1d9; }
  .badge.status-in_progress { background: #1f3a5f; color: #79c0ff; }
  .badge.status-review { background: #4a3a12; color: #e3b341; }
  .badge.status-done { background: #1b3a24; color: #56d364; }
  .badge.priority-low { background: #30363d; color: #8b949e; }
  .badge.priority-medium { background: #3a2f10; color: #d4a72c; }
  .badge.priority-high { background: #4a1f1f; color: #ff7b72; }
  .label-chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #1f2937; color: #a5b4fc; border: 1px solid #3730a3; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
  }
  #detail { scroll-margin-top: 72px; }
  .empty { color: var(--muted); padding: 24px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; }
  .field { margin-bottom: 12px; }
  .field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .row { display: flex; gap: 12px; }
  .row > .field { flex: 1; }
  .detail-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .detail-head .id { color: var(--muted); font-family: ui-monospace, monospace; }
  .detail-head .spacer { flex: 1; }
  .comments { margin-top: 16px; border-top: 1px solid var(--border); padding-top: 12px; }
  .comment { background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
  .comment .head { display: flex; gap: 8px; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .comment .head .author { color: var(--text); font-weight: 600; }
  .comment .body { white-space: pre-wrap; word-break: break-word; }
  .toast {
    position: fixed; bottom: 20px; right: 20px;
    background: var(--panel-2); border: 1px solid var(--border);
    padding: 10px 14px; border-radius: 8px; opacity: 0;
    transition: opacity .2s; pointer-events: none; max-width: 320px;
  }
  .toast.show { opacity: 1; }
  .toast.error { border-color: var(--danger); color: #ffb4ae; }
  .hidden { display: none !important; }
  .tabs { display: flex; gap: 6px; }
  .tabs button.active { border-color: var(--accent); color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>課題管理</h1>
  <div class="tabs">
    <button id="tab-active" class="active">アクティブ</button>
    <button id="tab-archive">アーカイブ</button>
  </div>
  <div class="spacer"></div>
  <button id="new-btn" class="primary">＋ 新規課題</button>
</header>

<div class="layout">
  <section>
    <div class="toolbar">
      <input id="filter" type="search" placeholder="タイトル・ラベルで絞り込み">
      <select id="status-filter">
        <option value="">すべてのステータス</option>
      </select>
    </div>
    <div id="list" class="list"></div>
  </section>

  <section id="detail-col">
    <div id="detail" class="panel empty">課題を選択してください。</div>
  </section>
</div>

<div id="toast" class="toast"></div>

<script>
(function () {
  'use strict';

  const api = {
    async req(method, url, body) {
      const opts = { method, headers: {} };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(url, opts);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!res.ok) {
        const msg = (data && (data.error || (data.errors && data.errors.join(' / ')))) || ('HTTP ' + res.status);
        throw new Error(msg);
      }
      return data;
    },
    meta() { return this.req('GET', '/api/meta'); },
    listActive() { return this.req('GET', '/api/issues'); },
    listArchive() { return this.req('GET', '/api/issues/archive'); },
    create(payload) { return this.req('POST', '/api/issues', payload); },
    update(id, payload) { return this.req('PUT', '/api/issues/' + id, payload); },
    addComment(id, payload) { return this.req('POST', '/api/issues/' + id + '/comments', payload); },
    archive(id) { return this.req('POST', '/api/issues/' + id + '/archive'); },
    unarchive(id) { return this.req('POST', '/api/issues/' + id + '/unarchive'); },
    remove(id) { return this.req('DELETE', '/api/issues/' + id); },
  };

  const state = {
    meta: null,
    view: 'active',
    filter: '',
    statusFilter: '',
    issues: [],
    selectedId: null,
  };

  function parseIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      const id = url.searchParams.get('id') || url.hash.replace(/^#/, '');
      if (id && /^ISSUE-\\d{3,}$/i.test(id)) {
        return id.toUpperCase();
      }
    } catch (e) {}
    return null;
  }

  function updateUrl(id) {
    try {
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set('id', id);
        url.hash = '';
      } else {
        url.searchParams.delete('id');
      }
      const newUrl = url.pathname + url.search + (url.hash || '');
      history.replaceState({}, '', newUrl);
    } catch (e) {}
  }

  const els = {
    list: document.getElementById('list'),
    detail: document.getElementById('detail'),
    filter: document.getElementById('filter'),
    statusFilter: document.getElementById('status-filter'),
    tabActive: document.getElementById('tab-active'),
    tabArchive: document.getElementById('tab-archive'),
    newBtn: document.getElementById('new-btn'),
    toast: document.getElementById('toast'),
  };

  function statusInfo(id) {
    return (state.meta.statuses.find((s) => s.id === id)) || { id, label: id };
  }
  function priorityInfo(id) {
    return (state.meta.priorities.find((p) => p.id === id)) || { id, label: id };
  }

  let toastTimer = null;
  function toast(message, isError) {
    els.toast.textContent = message;
    els.toast.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.className = 'toast'; }, 2800);
  }

  function el(tag, opts, children) {
    const node = document.createElement(tag);
    if (opts) {
      if (opts.className) node.className = opts.className;
      if (opts.text !== undefined) node.textContent = opts.text;
      if (opts.attrs) for (const k in opts.attrs) node.setAttribute(k, opts.attrs[k]);
      if (opts.on) for (const k in opts.on) node.addEventListener(k, opts.on[k]);
    }
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('ja-JP');
  }

  function currentIssues() {
    const q = state.filter.toLowerCase();
    return state.issues.filter((it) => {
      if (state.statusFilter && it.status !== state.statusFilter) return false;
      if (!q) return true;
      const hay = [it.id, it.title, (it.labels || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderList() {
    els.list.textContent = '';
    const items = currentIssues();
    if (items.length === 0) {
      els.list.appendChild(el('div', { className: 'empty', text: '課題がありません。' }));
      return;
    }
    for (const issue of items) {
      const meta = el('div', { className: 'meta' }, [
        el('span', { className: 'badge status-' + issue.status, text: statusInfo(issue.status).label }),
        el('span', { className: 'badge priority-' + issue.priority, text: '優先度: ' + priorityInfo(issue.priority).label }),
        ...(issue.labels || []).slice(0, 3).map((l) => el('span', { className: 'label-chip', text: l })),
      ]);
      const card = el('div', {
        className: 'card' + (issue.id === state.selectedId ? ' active' : ''),
        on: { click: () => selectIssue(issue.id) },
      }, [
        el('div', { className: 'id', text: issue.id }),
        el('div', { className: 'title', text: issue.title }),
        meta,
      ]);
      els.list.appendChild(card);
    }
  }

  function selectIssue(id) {
    state.selectedId = id;
    updateUrl(id);
    renderList();
    renderDetail();
  }

  function findIssue(id) {
    return state.issues.find((i) => i.id === id) || null;
  }

  function renderDetail() {
    els.detail.textContent = '';
    els.detail.className = 'panel';
    const issue = findIssue(state.selectedId);

    if (!issue) {
      els.detail.className = 'panel empty';
      els.detail.textContent = '課題を選択してください。';
      return;
    }

    const archived = state.view === 'archive';

    const head = el('div', { className: 'detail-head' }, [
      el('span', { className: 'id', text: issue.id }),
    ]);

    if (archived) {
      head.appendChild(el('button', { text: '復元', on: { click: () => doUnarchive(issue.id) } }));
      head.appendChild(el('button', { className: 'danger', text: '完全削除', on: { click: () => doDelete(issue.id) } }));
    } else {
      head.appendChild(el('button', { text: 'アーカイブ', on: { click: () => doArchive(issue.id) } }));
    }

    const titleInput = el('input', { attrs: { type: 'text', value: issue.title } });
    const descInput = el('textarea', { attrs: {} });
    descInput.value = issue.description || '';
    function adjustDescHeight() {
      descInput.style.height = 'auto';
      descInput.style.height = Math.max(descInput.scrollHeight, 80) + 'px';
    }
    descInput.addEventListener('input', adjustDescHeight);
    setTimeout(adjustDescHeight, 0);

    const statusSel = el('select', {}, state.meta.statuses.map((s) =>
      el('option', { text: s.label, attrs: { value: s.id, ...(s.id === issue.status ? { selected: 'selected' } : {}) } })
    ));
    const prioSel = el('select', {}, state.meta.priorities.map((p) =>
      el('option', { text: p.label, attrs: { value: p.id, ...(p.id === issue.priority ? { selected: 'selected' } : {}) } })
    ));
    const labelsInput = el('input', { attrs: { type: 'text', value: (issue.labels || []).join(', ') } });

    const saveBtn = el('button', {
      className: 'primary',
      text: '保存',
      on: {
        click: async () => {
          const labels = labelsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
          await withError(async () => {
            await api.update(issue.id, {
              title: titleInput.value,
              description: descInput.value,
              status: statusSel.value,
              priority: prioSel.value,
              labels,
            });
            toast('保存しました。');
            await reload();
          });
        },
      },
    });

    const form = el('div', {}, [
      el('div', { className: 'field' }, [el('label', { text: 'タイトル' }), titleInput]),
      el('div', { className: 'field' }, [el('label', { text: '説明' }), descInput]),
      el('div', { className: 'row' }, [
        el('div', { className: 'field' }, [el('label', { text: 'ステータス' }), statusSel]),
        el('div', { className: 'field' }, [el('label', { text: '優先度' }), prioSel]),
      ]),
      el('div', { className: 'field' }, [el('label', { text: 'ラベル（カンマ区切り）' }), labelsInput]),
      el('div', { className: 'row' }, [
        el('span', { className: 'id', text: '作成: ' + fmtDate(issue.createdAt) }),
        el('span', { className: 'id', text: '更新: ' + fmtDate(issue.updatedAt) }),
      ]),
      el('div', { className: 'toolbar', attrs: { style: 'margin-top:12px' } }, [saveBtn]),
    ]);

    const commentInput = el('textarea', { attrs: { placeholder: 'コメントを入力…' } });
    const commentBtn = el('button', {
      text: 'コメント追加',
      on: {
        click: async () => {
          if (!commentInput.value.trim()) return;
          await withError(async () => {
            await api.addComment(issue.id, { author: 'human', text: commentInput.value });
            commentInput.value = '';
            toast('コメントを追加しました。');
            await reload();
            renderDetail();
          });
        },
      },
    });

    const commentNodes = (issue.comments || []).map((c, idx) => {
      const body = el('div', { className: 'body', text: c.text });
      const editBtn = el('button', {
        className: 'ghost',
        text: '編集',
        on: {
          click: () => {
            if (body.querySelector('textarea')) return;
            const ta = el('textarea', { attrs: { value: c.text } });
            body.textContent = '';
            body.appendChild(ta);
            const save = el('button', {
              className: 'primary',
              text: '保存',
              on: {
                click: async () => {
                  const newText = ta.value.trim();
                  if (!newText) return;
                  const newComments = (issue.comments || []).map((cc, i) => (i === idx ? { ...cc, text: newText, updatedAt: new Date().toISOString() } : cc));
                  await withError(async () => {
                    await api.update(issue.id, { comments: newComments });
                    toast('コメントを更新しました。');
                    await reload();
                    renderDetail();
                  });
                },
              },
            });
            const cancel = el('button', {
              text: 'キャンセル',
              on: {
                click: () => {
                  body.textContent = c.text;
                },
              },
            });
            body.appendChild(el('div', { className: 'toolbar', attrs: { style: 'margin-top:8px' } }, [save, cancel]));
            ta.focus();
          },
        },
      });
      return el('div', { className: 'comment' }, [
        el('div', { className: 'head' }, [
          el('span', { className: 'author', text: c.author || '不明' }),
          el('span', { text: fmtDate(c.createdAt) }),
          el('span', { className: 'spacer' }),
          editBtn,
        ]),
        body,
      ]);
    });

    const comments = el('div', { className: 'comments' }, [
      el('p', { className: 'col-title', text: 'コメント (' + (issue.comments || []).length + ')' }),
      ...commentNodes,
      commentInput,
      el('div', { className: 'toolbar', attrs: { style: 'margin-top:8px' } }, [commentBtn]),
    ]);

    els.detail.appendChild(head);
    els.detail.appendChild(form);
    els.detail.appendChild(comments);
  }

  function renderNewForm() {
    state.selectedId = null;
    updateUrl(null);
    renderList();
    els.detail.className = 'panel';
    els.detail.textContent = '';

    const titleInput = el('input', { attrs: { type: 'text', placeholder: 'タイトル（必須）' } });
    const descInput = el('textarea', { attrs: { placeholder: '説明' } });
    function adjustDescHeight() {
      descInput.style.height = 'auto';
      descInput.style.height = Math.max(descInput.scrollHeight, 80) + 'px';
    }
    descInput.addEventListener('input', adjustDescHeight);
    setTimeout(adjustDescHeight, 0);
    const statusSel = el('select', {}, state.meta.statuses.map((s) =>
      el('option', { text: s.label, attrs: { value: s.id, ...(s.id === state.meta.defaultStatus ? { selected: 'selected' } : {}) } })
    ));
    const prioSel = el('select', {}, state.meta.priorities.map((p) =>
      el('option', { text: p.label, attrs: { value: p.id, ...(p.id === state.meta.defaultPriority ? { selected: 'selected' } : {}) } })
    ));
    const labelsInput = el('input', { attrs: { type: 'text', placeholder: 'frontend, bug' } });

    const createBtn = el('button', {
      className: 'primary',
      text: '作成',
      on: {
        click: async () => {
          if (!titleInput.value.trim()) { toast('タイトルは必須です。', true); return; }
          const labels = labelsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
          await withError(async () => {
            const data = await api.create({
              title: titleInput.value,
              description: descInput.value,
              status: statusSel.value,
              priority: prioSel.value,
              labels,
            });
            toast('課題を作成しました。');
            state.view = 'active';
            await reload();
            if (data && data.issue) selectIssue(data.issue.id);
          });
        },
      },
    });
    const cancelBtn = el('button', {
      text: 'キャンセル',
      on: { click: () => { renderList(); renderDetail(); } },
    });

    els.detail.appendChild(el('p', { className: 'col-title', text: '新規課題' }));
    els.detail.appendChild(el('div', { className: 'field' }, [el('label', { text: 'タイトル' }), titleInput]));
    els.detail.appendChild(el('div', { className: 'field' }, [el('label', { text: '説明' }), descInput]));
    els.detail.appendChild(el('div', { className: 'row' }, [
      el('div', { className: 'field' }, [el('label', { text: 'ステータス' }), statusSel]),
      el('div', { className: 'field' }, [el('label', { text: '優先度' }), prioSel]),
    ]));
    els.detail.appendChild(el('div', { className: 'field' }, [el('label', { text: 'ラベル（カンマ区切り）' }), labelsInput]));
    els.detail.appendChild(el('div', { className: 'toolbar' }, [createBtn, cancelBtn]));
    titleInput.focus();
  }

  async function doArchive(id) {
    await withError(async () => {
      await api.archive(id);
      state.selectedId = null;
      updateUrl(null);
      toast('アーカイブしました。');
      await reload();
      renderDetail();
    });
  }
  async function doUnarchive(id) {
    await withError(async () => {
      await api.unarchive(id);
      state.selectedId = null;
      updateUrl(null);
      toast('復元しました。');
      await reload();
      renderDetail();
    });
  }
  async function doDelete(id) {
    if (!confirm('完全に削除します。よろしいですか？')) return;
    await withError(async () => {
      await api.remove(id);
      state.selectedId = null;
      updateUrl(null);
      toast('削除しました。');
      await reload();
      renderDetail();
    });
  }

  async function withError(fn) {
    try { await fn(); } catch (err) { toast(err.message, true); }
  }

  async function reload() {
    const data = state.view === 'archive' ? await api.listArchive() : await api.listActive();
    state.issues = data.issues;
    if (state.selectedId && !findIssue(state.selectedId)) state.selectedId = null;
    renderList();
  }

  function setView(view) {
    state.view = view;
    state.selectedId = null;
    updateUrl(null);
    els.tabActive.classList.toggle('active', view === 'active');
    els.tabArchive.classList.toggle('active', view === 'archive');
    els.newBtn.classList.toggle('hidden', view === 'archive');
    els.statusFilter.classList.toggle('hidden', view === 'archive');
    withError(async () => { await reload(); renderDetail(); });
  }

  function populateStatusFilter() {
    for (const s of state.meta.statuses) {
      els.statusFilter.appendChild(el('option', { text: s.label, attrs: { value: s.id } }));
    }
  }

  function bind() {
    els.tabActive.addEventListener('click', () => setView('active'));
    els.tabArchive.addEventListener('click', () => setView('archive'));
    els.newBtn.addEventListener('click', renderNewForm);
    els.filter.addEventListener('input', () => { state.filter = els.filter.value; renderList(); });
    els.statusFilter.addEventListener('change', () => { state.statusFilter = els.statusFilter.value; renderList(); });
  }

  async function init() {
    await withError(async () => {
      state.meta = await api.meta();
      populateStatusFilter();
      await reload();
      const urlId = parseIdFromUrl();
      if (urlId) {
        if (!findIssue(urlId)) {
          const archivedData = await api.listArchive();
          if (archivedData.issues.some((issue) => issue.id === urlId)) {
            state.view = 'archive';
            state.issues = archivedData.issues;
            els.tabActive.classList.remove('active');
            els.tabArchive.classList.add('active');
            els.newBtn.classList.add('hidden');
            els.statusFilter.classList.add('hidden');
          }
        }
        if (findIssue(urlId)) {
          state.selectedId = urlId;
        } else {
          updateUrl(null);
          toast('URLで指定された課題が見つかりません。', true);
        }
      }
      renderList();
      renderDetail();
      if (state.selectedId) {
        requestAnimationFrame(() => els.detail.scrollIntoView({ block: 'start' }));
      }
    });
    bind();
    setInterval(() => { withError(() => reload()); }, 10000);
  }

  init();
})();
</script>
</body>
</html>`;

function sendIndexHtml(res) {
  const body = Buffer.from(INDEX_HTML, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  } catch {
    return sendText(res, 400, 'Bad Request');
  }

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((err) => {
      console.error(err);
      sendJson(res, 500, { error: 'サーバー内部エラーが発生しました。' });
    });
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    return sendIndexHtml(res);
  }

  sendText(res, 404, 'Not Found');
});

ensureDirs();
syncInstructions();
server.listen(PORT, () => {
  console.log(`課題管理アプリ: http://localhost:${PORT}`);
  console.log(`  issues/        : ${ISSUES_DIR}`);
  console.log(`  issues/archive/: ${ARCHIVE_DIR}`);
});
