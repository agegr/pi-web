/**
 * Project changes the tutorial sessions "made". They are applied on top of the
 * repository snapshot so the explorer, file viewer, Git changes panel and the
 * sessions' tool calls all agree.
 */

export interface ProjectFileEdit {
  key: string;
  path: string;
  edits: { oldText: string; newText: string }[];
}

/** Edits to existing files (shown as "modified" in Git). */
export const PROJECT_FILE_EDITS: ProjectFileEdit[] = [
  {
    key: "readme-help-tip",
    path: "README.md",
    edits: [{ oldText: "## Quick Start\n", newText: "## Quick Start\n\n> **Tip:** run `pi-web --help` to list every startup option before you launch it.\n" }],
  },
  {
    key: "appshell-format-duration",
    path: "components/AppShell.tsx",
    edits: [
      { oldText: "import { copyText } from \"@/lib/clipboard\";\n", newText: "import { copyText } from \"@/lib/clipboard\";\nimport { formatDuration } from \"@/lib/format-duration\";\n" },
      { oldText: "                    const formatDuration = (ms: number) => {\n                      if (ms <= 0) return \"0s\";\n                      const totalSec = Math.floor(ms / 1000);\n                      const h = Math.floor(totalSec / 3600);\n                      const m = Math.floor((totalSec % 3600) / 60);\n                      const s = totalSec % 60;\n                      if (h > 0) return `${h}h ${m}m`;\n                      if (m > 0) return `${m}m ${s}s`;\n                      return `${s}s`;\n                    };\n", newText: "" },
    ],
  },
];

/** New files (shown as "untracked" in Git). */
export const PROJECT_FILE_OVERRIDES: Record<string, string> = {
  "lib/format-duration.ts": "/**\n * Compact duration label for the session stats panel: \"42s\", \"5m 3s\", \"1h 5m\".\n * Anything under a second, and invalid input, renders as \"0s\".\n */\nexport function formatDuration(ms: number): string {\n  if (!Number.isFinite(ms) || ms <= 0) return \"0s\";\n  const totalSeconds = Math.floor(ms / 1000);\n  const hours = Math.floor(totalSeconds / 3600);\n  const minutes = Math.floor((totalSeconds % 3600) / 60);\n  const seconds = totalSeconds % 60;\n  if (hours > 0) return `${hours}h ${minutes}m`;\n  if (minutes > 0) return `${minutes}m ${seconds}s`;\n  return `${seconds}s`;\n}\n",
  "lib/format-duration.test.mjs": "import assert from \"node:assert/strict\";\nimport test from \"node:test\";\nimport { createJiti } from \"jiti\";\n\nconst jiti = createJiti(import.meta.url);\nconst { formatDuration } = await jiti.import(\"./format-duration.ts\");\n\ntest(\"formats seconds, minutes and hours\", () => {\n  assert.equal(formatDuration(42_000), \"42s\");\n  assert.equal(formatDuration(5 * 60_000 + 3_000), \"5m 3s\");\n  assert.equal(formatDuration(65 * 60_000), \"1h 5m\");\n});\n\ntest(\"drops partial seconds like the old inline helper\", () => {\n  assert.equal(formatDuration(1_999), \"1s\");\n  assert.equal(formatDuration(999), \"0s\");\n});\n\ntest(\"renders empty and invalid durations as 0s\", () => {\n  for (const value of [0, -500, Number.NaN, Number.POSITIVE_INFINITY]) {\n    assert.equal(formatDuration(value), \"0s\");\n  }\n});\n",
};

/** Real  output for the feature session. */
export const FORMAT_DURATION_TEST_OUTPUT = "TAP version 13\n# Subtest: formats seconds, minutes and hours\nok 1 - formats seconds, minutes and hours\n  ---\n  duration_ms: 1.027562\n  type: 'test'\n  ...\n# Subtest: drops partial seconds like the old inline helper\nok 2 - drops partial seconds like the old inline helper\n  ---\n  duration_ms: 0.178082\n  type: 'test'\n  ...\n# Subtest: renders empty and invalid durations as 0s\nok 3 - renders empty and invalid durations as 0s\n  ---\n  duration_ms: 0.15196\n  type: 'test'\n  ...\n1..3\n# tests 3\n# suites 0\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 318.133831";

/** The scratch project created with "Use default directory". */
export const SCRATCH_FILES: Record<string, string> = {
  "notes.md": "# Scratch notes\n\nPi Web's **Use default directory** creates a dated folder like this one for quick questions that don't belong to a project.\n\n- Sessions here use the *Chat only* tool preset: no file or shell access.\n- Switch projects with the picker at the top of the sidebar.\n",
  "sse-vs-websocket.md": "# SSE vs WebSocket\n\n| | Server-Sent Events | WebSocket |\n| --- | --- | --- |\n| Direction | server → client | both ways |\n| Protocol | plain HTTP | upgraded connection |\n| Reconnect | built into EventSource | do it yourself |\n| Proxies | usually just work | need upgrade support |\n\nPi Web streams agent events over SSE and sends commands with ordinary POST requests.\n",
};
