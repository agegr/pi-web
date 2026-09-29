import { PROJECT_ROOT } from "../../paths";
import { FORMAT_DURATION_TEST_OUTPUT } from "../../data/project-files";
import { SESSION_IDS } from "../ids";
import type { SessionScript } from "../types";

const RG_OUTPUT = `components/AppShell.tsx:2102:                    const formatDuration = (ms: number) => {
components/AppShell.tsx:2118:                       ...(totalActiveMs > 0 ? [{ label: translate("session.totalActive"), value: formatDuration(totalActiveMs), copyField: null }] : []),
components/FileViewer.tsx:595:function formatDuration(seconds: number): string {
components/FileViewer.tsx:705:        {duration != null && <span>{formatDuration(duration)}</span>}
components/FileViewer.tsx:858:        {duration != null && <span>{formatDuration(duration)}</span>}
components/FileViewer.state.test.mjs:21:  ["ImageViewer", "formatDuration"],`;

export const featureSession: SessionScript = {
  id: SESSION_IDS.feature,
  cwd: PROJECT_ROOT,
  startedMinutesAgo: 2 * 24 * 60 + 70,
  name: { en: "Refactor: extract formatDuration with tests", zh: "重构：抽出 formatDuration 并补测试" },
  steps: [
    { kind: "model", provider: "claude-gateway", modelId: "claude-opus-5" },
    { kind: "thinking", level: "high" },
    {
      kind: "user",
      gapMinutes: 0.1,
      text: {
        en: "The session stats popover in AppShell.tsx has its own inline `formatDuration`. Move it into `lib/` with unit tests.",
        zh: "AppShell.tsx 里会话统计弹窗有一个内联的 `formatDuration`，把它挪到 `lib/` 里，并补上单元测试。",
      },
    },
    {
      kind: "assistant",
      rounds: [
        {
          thinking: {
            en: "First find every formatDuration so I don't merge two helpers that mean different things.",
            zh: "先找出所有叫 formatDuration 的地方，避免把含义不同的两个函数合并。",
          },
          seconds: 4,
          tools: [{ name: "bash", args: { command: "rg -n \"formatDuration\" components lib" }, result: RG_OUTPUT, seconds: 1 }],
        },
        {
          thinking: {
            en: "FileViewer's formatDuration formats media time as m:ss from seconds — a different helper. Only the AppShell one takes milliseconds. Read it to preserve its exact behaviour (floor, \"0s\" for non-positive).",
            zh: "FileViewer 里的 formatDuration 是把秒数格式化成 m:ss 的媒体时长，是另一个函数。只有 AppShell 里那个接收毫秒。读一下它，保证行为完全一致（向下取整、非正数返回 \"0s\"）。",
          },
          seconds: 5,
          tools: [{
            name: "read",
            args: { path: "components/AppShell.tsx" },
            result: { readFile: "components/AppShell.tsx", anchor: "const formatDuration = (ms: number)", limit: 12 },
          }],
        },
        {
          text: {
            en: "`FileViewer.tsx` has an unrelated `formatDuration(seconds)` for audio/video time, so I'll leave it alone and only extract the millisecond version from `AppShell.tsx`.",
            zh: "`FileViewer.tsx` 里的 `formatDuration(seconds)` 是给音视频时长用的，和这个无关，我不动它，只把 `AppShell.tsx` 里按毫秒计算的版本抽出来。",
          },
          seconds: 14,
          tools: [
            { name: "write", args: {}, result: { writePath: "lib/format-duration.ts" } },
            { name: "write", args: {}, result: { writePath: "lib/format-duration.test.mjs" } },
          ],
        },
        {
          seconds: 7,
          tools: [{ name: "edit", args: {}, result: { editKey: "appshell-format-duration" } }],
        },
        {
          seconds: 3,
          tools: [{ name: "bash", args: { command: "node --test lib/format-duration.test.mjs" }, result: FORMAT_DURATION_TEST_OUTPUT, seconds: 2 }],
        },
        {
          seconds: 9,
          text: {
            en: `Done — the helper now lives in \`lib/format-duration.ts\` and all 3 tests pass.

| File | Change |
| --- | --- |
| \`lib/format-duration.ts\` | New: \`formatDuration(ms)\` → \`"42s"\`, \`"5m 3s"\`, \`"1h 5m"\` |
| \`lib/format-duration.test.mjs\` | New: normal values, partial seconds, and \`0\` / negative / \`NaN\` / \`Infinity\` |
| \`components/AppShell.tsx\` | Imports the helper and drops the inline copy |

Behaviour is unchanged (floor to whole seconds, \`"0s"\` for anything ≤ 0), except that \`NaN\` and \`Infinity\` now also render as \`"0s"\` instead of garbage like \`"NaNs"\`.

The written files are listed under this reply — click one to open it. The explorer's **changed files** view shows all three with diffs.`,
            zh: `完成——这个函数现在放在 \`lib/format-duration.ts\`，3 个测试全部通过。

| 文件 | 改动 |
| --- | --- |
| \`lib/format-duration.ts\` | 新增：\`formatDuration(ms)\` → \`"42s"\`、\`"5m 3s"\`、\`"1h 5m"\` |
| \`lib/format-duration.test.mjs\` | 新增：常规值、不足一秒，以及 \`0\` / 负数 / \`NaN\` / \`Infinity\` |
| \`components/AppShell.tsx\` | 改为导入该函数，删除内联实现 |

行为保持不变（按整秒向下取整，≤ 0 时返回 \`"0s"\`），唯一的区别是 \`NaN\` 和 \`Infinity\` 现在也返回 \`"0s"\`，而不是 \`"NaNs"\` 这样的乱码。

这次写入的文件列在回复下方，点击即可打开。文件浏览器的 **变更文件** 视图里能看到这三个文件的 diff。`,
          },
        },
      ],
    },
  ],
};
