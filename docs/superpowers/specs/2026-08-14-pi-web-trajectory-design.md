# Pi Web Trajectory Design

**Date:** 2026-08-14
**Status:** Approved for implementation planning

## Goal

将 DeepSeek Harness 的 Trajectory 能力移植到 Pi Web，同时吸收 `icesixgod/codex-trajectory` 的日志投影、隐私分级和事件账本设计。目标是让 Pi-web 在该功能发布后创建的新会话具备可刷新、可回放、可检查的请求级轨迹。

## Confirmed Product Decisions

- Trajectory 是会话区域内与 Chat 同级的视图标签，采用 `Chat / Trajectory` 布局。
- 桌面端使用完整工作区宽度：顶部 timing overview，中部事件账本，右侧详情检查器；composer 始终可用。
- 移动端使用事件账本和底部详情面板。
- 新会话显示精确采集的轨迹；没有 sidecar 的旧会话显示明确的“不支持轨迹”，不从历史消息猜测 TTFT 或请求边界。
- 默认显示安全摘要。完整 system prompt、工具参数、工具输出和请求快照需要显式确认后加载。
- 子代理默认显示调用占位；用户展开后才加载并嵌入对应子会话轨迹。
- Trajectory 只显示当前 Pi `leafId` 对应的分支，分支切换与 Chat 同步。
- 轨迹采集失败不能阻断模型请求。

## Scope

### Included

- Provider request start/end and TTFT.
- Turn/request/step projection.
- Model, provider, thinking level and request context snapshot.
- Assistant response and reasoning summary metadata.
- Tool call start/end, duration, status and call id.
- Retry, compaction, abort and failure lifecycle.
- Token usage and cumulative session statistics.
- Current-branch filtering and on-demand subagent expansion.
- Summary/full detail API and privacy filtering.
- Desktop and mobile React UI with timeline, ledger, search, filters and inspector.

### Excluded

- No changes to Pi upstream packages or `node_modules`.
- No Python runtime, MCP server or MCP Apps iframe.
- No historical backfill for sessions created before trajectory recording.
- No all-branches audit view in the first version.
- No raw API keys, authentication headers, absolute session paths or encrypted reasoning in trajectory output.

## Architecture

### Recorder

Add a `TrajectoryRecorder` owned by `AgentSessionWrapper`. It writes versioned append-only JSONL files under:

```text
<PI_CODING_AGENT_DIR>/trajectories/<sessionId>.jsonl
```

The recorder is initialized for sessions created by Pi-web after this feature is released. Existing sessions without a sidecar remain unsupported. It uses the existing `getAgentDir()` and safe session id handling; callers cannot provide an arbitrary output path.

The recorder exposes a small lifecycle API:

```text
startTurn / endTurn
startRequest / markFirstToken / finishRequest
startTool / finishTool
startRetry / finishRetry
startCompaction / finishCompaction
recordSubagentLink
flush / close
```

Writes are serialized through one in-memory append queue. A write error marks the recorder unavailable, emits a non-blocking diagnostic, and leaves the agent run unaffected.

### Provider instrumentation

After `createAgentSessionFromServices()` returns, wrap the public `inner.agent.streamFunction` reference. The wrapper:

1. Allocates a trajectory request id.
2. Records provider/model, thinking level, request context snapshot and start time.
3. Marks TTFT on the first text, thinking or tool-call stream delta.
4. Records completion or error when the stream resolves.
5. Keeps compaction requests separate when the compaction lifecycle is active.

The wrapper must not retain API key or auth header values. Request context snapshots are kept locally in the sidecar but are omitted by summary responses and bounded in full responses.

### Session event instrumentation

Reuse the existing `AgentSessionWrapper` subscription path for:

- `agent_start`, `agent_end`, `agent_settled`
- `turn_start`, `turn_end`
- `message_start`, `message_end`
- `tool_execution_start`, `tool_execution_end`
- `auto_retry_start`, `auto_retry_end`
- `compaction_start`, `compaction_end`
- `entry_appended`

Milestone events are forwarded through the existing SSE connection. The client does not open a second agent event stream.

### Branch anchoring

Every sidecar event carries the closest known Pi entry id or leaf id. The server loads the selected `SessionManager` branch and filters trajectory events against that branch. Events that cannot be associated with a branch remain diagnostic-only and are not rendered as current-branch records.

### Projection API

Add:

```text
GET /api/sessions/[id]/trajectory
  ?leafId=<optional>
  &detailLevel=summary|full
  &cursor=<optional>
```

The response follows a Pi-web-owned contract inspired by Codex Trajectory:

```text
{
  schemaVersion,
  detailLevel,
  session,
  stats,
  turns,
  requests,
  records,
  warnings,
  hasOlderRecords,
  nextCursor
}
```

`summary` contains event kinds, bounded summaries, timing, status and token counts. `full` adds bounded request, input, output, prompt and tool-schema details after explicit user confirmation.

A session without a trajectory sidecar returns a stable not-supported response rather than silently estimating history.

## UI

### Desktop

- Keep the current project/session sidebar and top bar.
- Add `Chat` and `Trajectory` as sibling view tabs in the active session.
- Render timing overview above the ledger.
- Render a searchable/filterable ledger in the main pane.
- Render the selected record inspector in a resizable right pane.
- Inspector tabs: Overview, Input, Output, Timing, Usage, Schema where data exists.
- Show `Load full details` in the summary state. Confirmation is required before requesting full data.
- Keep the composer fixed at the bottom and reserve its live height in the scroll container.

### Mobile

- Keep the same view tabs and summary metrics.
- Use a horizontally clipped but keyboard-accessible ledger with stable columns.
- Open the inspector as a bottom sheet after selecting a record.
- Keep the composer above the safe-area inset and above the inspector when the sheet is open.
- Subagent records use an expand control; expanding loads the child trajectory in place.

### Interaction

- Search matches event name, bounded summary, call id and loaded detail text.
- Type/status filters apply to the currently loaded branch.
- Timeline supports range selection, wheel zoom and right-click clear, following the reference interaction model.
- Selecting a timeline span selects the corresponding ledger record.
- Running durations remain blank until a completion timestamp exists; the overview may show a start marker but must not invent a duration.
- Initial and live updates follow the tail only while the user remains near the tail. Scrolling upward pauses follow mode.

## Privacy and Error Handling

- Never expose API keys, authorization headers, absolute log paths, Git remotes or encrypted reasoning.
- Summary is the default response and omits raw request and tool payloads.
- Full fields are bounded to a fixed maximum and marked truncated when necessary.
- Malformed complete sidecar lines become warnings; an unfinished final line is ignored while a session is active.
- Missing completion events produce `running` or `aborted` state, never a fabricated duration.
- Sidecar read failure is shown in the trajectory view without changing Chat behavior.
- Recorder write failure is logged once per session and surfaced as a non-blocking warning.
- Existing Pi session files remain untouched by the feature.

## Tests and Verification

### Unit tests

- Stream wrapper records request start, TTFT, completion and provider errors.
- Tool start/end pairing handles parallel calls, missing starts and errors.
- Retry and compaction lifecycles close correctly on success, abort and failure.
- Sidecar append queue remains ordered and tolerates a failed write.
- Projection filters to the current branch and preserves stable record indexes.
- Summary/full projection excludes sensitive fields and bounds detail fields.
- Malformed JSONL and incomplete tail behavior matches the documented contract.
- Old sessions return not-supported without reading fabricated telemetry.

### API tests

- Session path security and session id validation.
- Summary response does not include raw inputs or outputs.
- Full response requires the explicit detail request and returns bounded fields.
- Cursor pagination preserves aggregate stats and original indexes.
- Subagent expansion resolves only related session ids.

### UI tests

- Chat/Trajectory tab switching preserves the active session and composer.
- Ledger selection opens and clears the inspector.
- Search and filters affect both ledger and timeline selection.
- Full-detail confirmation gates the request.
- Branch changes reload the selected trajectory.
- Subagent expansion loads a child trajectory and handles missing children.
- Mobile inspector and composer do not overlap.

### Commands

```sh
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

The development server will be used for desktop and mobile smoke checks. `npm run build` is excluded during development per `AGENTS.md`.

## References

- DeepSeek Harness Trajectory: https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-trajectory
- Codex Trajectory: https://github.com/icesixgod/codex-trajectory
- Pi-web session format and lifecycle notes: `AGENTS.md`
- Pi SDK provider stream entry point: `inner.agent.streamFunction`
