# Plan: SQLite Session Index

## 问题陈述

Pi Web 会话以 JSONL 格式存储在 `~/.pi/agent/sessions/<cwd>/` 下。文件随对话增长无上限，导致：

| 操作 | 27MB 会话实测 | 根因 |
|------|-------------|------|
| 打开会话 | 273ms | `sm.getEntries()` 全量读文件 |
| 全局搜索 | 225ms (截断) | readline 逐行扫，16MB 上限 |
| 会话列表 | 339ms | readline 逐行扫所有文件 |
| 时间线/导航 | 不支持 | 无索引，无法查询 |

**toolResult 占文件 79.7%**（20.77MB/27MB），是体积增长的主因。

## 目标

1. 打开会话：273ms → ~1ms（SQLite 索引查询）
2. 全局搜索：225ms 截断 → ~5ms 100% 覆盖（FTS5）
3. 会话内搜索：新功能，~1ms
4. 时间线导航：新功能，小地图显示日期 + 角色 + 预览
5. 会话列表：339ms → ~1ms

## 约束

- **不改 JSONL 格式** — SDK/CLI 继续读写原始文件
- **不改 SDK 代码** — pi-web 独立实现索引层
- **零外部依赖** — 使用 `node:sqlite`（Node.js 22 内置，含 FTS5）
- **可开关** — 用户可在常规设置中启用/禁用
- **向后兼容** — 禁用后 fallback 到现有 JSONL 逻辑

## 架构

```
~/.pi/agent/sessions/               ~/.pi/agent/
  --home-workspace-pi-web-main--/    pi-web-index.db     ← 新：SQLite 索引
    session.jsonl    ← SDK 写入，pi-web 不直接读
```

**数据流：**
```
SDK 写 JSONL → pi-web 检测文件变更(mtime) → 增量解析新行 → 写入 SQLite
                                                    ↓
用户操作(打开/搜索/导航) → 查询 SQLite → 返回结果
```

## 数据库 Schema

```sql
-- 会话元数据（对应 sessions 列表）
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  filePath TEXT NOT NULL UNIQUE,
  cwd TEXT NOT NULL,
  name TEXT,
  created TEXT NOT NULL,
  modified TEXT NOT NULL,
  messageCount INTEGER NOT NULL DEFAULT 0,
  firstMessage TEXT,
  fileSize INTEGER NOT NULL,
  lastIndexedLine INTEGER NOT NULL DEFAULT 0,
  lastIndexedMtime REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_modified ON sessions(modified DESC);
CREATE INDEX idx_sessions_cwd ON sessions(cwd);

-- 条目索引（对应每条 JSONL 行）
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL REFERENCES sessions(id),
  lineIndex INTEGER NOT NULL,
  type TEXT NOT NULL,
  role TEXT,
  timestamp TEXT NOT NULL,
  parentId TEXT,
  contentPreview TEXT,
  toolName TEXT,
  contentSizeBytes INTEGER,
  UNIQUE(sessionId, lineIndex)
);
CREATE INDEX idx_entries_session ON entries(sessionId, lineIndex);
CREATE INDEX idx_entries_role ON entries(sessionId, role);
CREATE INDEX idx_entries_time ON entries(sessionId, timestamp);

-- 全文搜索索引
CREATE VIRTUAL TABLE entries_fts USING fts5(
  sessionId UNINDEXED,
  lineIndex UNINDEXED,
  entryId UNINDEXED,
  content,
  tokenize='porter unicode61'
);

-- 触发器：entries 变更时自动同步 FTS
CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(sessionId, lineIndex, entryId, content)
  VALUES (new.sessionId, new.lineIndex, new.id, new.contentPreview);
END;
CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
  DELETE FROM entries_fts WHERE sessionId = old.sessionId AND lineIndex = old.lineIndex;
END;
```

## 实现阶段

### 阶段 1：基础设施（本次实现）

| 任务 | 文件 | 说明 |
|------|------|------|
| 1a. 功能开关 | `lib/index-settings.ts` | 读写 `~/.pi/agent/settings.json` 的 `sessionIndex.enabled` |
| 1b. API 端点 | `app/api/index-settings/route.ts` | GET/PUT 端点 |
| 1c. UI 开关 | `components/SettingsPanel.tsx` | 常规设置中添加开关 |
| 1d. i18n | `lib/i18n/messages/{en,zh-CN,zh-TW}.ts` | 翻译 |
| 2a. SQLite 库 | `lib/session-index.ts` | 连接管理、Schema、索引构建 |
| 2b. 索引器 | `lib/session-index-builder.ts` | JSONL → SQLite 增量解析 |
| 3a. 读取集成 | `lib/session-reader.ts` | SQLite 优先，JSONL fallback |
| 3b. 列表集成 | `lib/session-list-scanner.ts` | SQLite 优先 |
| 3c. 搜索集成 | `lib/session-search.ts` | FTS5 优先 |

### 阶段 2：导航增强（后续）

| 任务 | 说明 |
|------|------|
| 小地图时间线 | 显示日期、角色标记、内容预览 |
| 会话内搜索 | 搜索当前会话所有消息 |
| 按日期跳转 | 快速导航到任意时间点 |

### 阶段 3：内容分层（后续）

| 任务 | 说明 |
|------|------|
| toolResult 外置 | 大内容存 SQLite blob |
| 过期淘汰 | 清理旧 toolResult |
| 压缩归档 | 冷会话自动压缩 |

## 关键实现细节

### 索引构建策略

```
文件首次访问 → 全量解析 → 写入 SQLite（27MB ~300ms，一次性）
后续追加 → stat mtime 检测 → 增量解析新行 → 追加到 SQLite（~1ms/行）
```

### 数据映射

```
JSONL 行 → entries 表字段：
  entry.id         → entries.id
  entry.type       → entries.type
  entry.timestamp  → entries.timestamp
  entry.parentId   → entries.parentId
  entry.message.role    → entries.role (user/assistant/toolResult)
  entry.message.content → entries.contentPreview (前 500 字符)
  entry.message.toolName → entries.toolName
  entry.message.content.length → entries.contentSizeBytes
  行号              → entries.lineIndex
```

### FTS 内容提取

```
user message:     content 数组中 type=text 的块拼接
assistant message: content 数组中 type=text 的块拼接（排除 thinking）
toolResult:       不索引内容（太大），只索引 toolName + isError
compaction:       摘要文本
```

## 风险与回退

| 风险 | 缓解措施 |
|------|---------|
| `node:sqlite` 是实验性 API | 降级：`better-sqlite3` 备选 |
| FTS5 中文分词 | 使用 porter unicode61 tokenizer |
| 索引与 JSONL 不同步 | mtime 检测 + 手动重建按钮 |
| 大文件首次索引慢 | 后台异步构建，不阻塞 UI |

## 验证计划

1. 启用索引 → 打开 27MB 会话 → 验证 <10ms
2. 搜索关键词 → 验证 100% 覆盖（对比 readline 结果）
3. 禁用索引 → 验证 fallback 到现有逻辑
4. 追加消息 → 验证增量索引
5. 删除会话 → 验证索引清理
