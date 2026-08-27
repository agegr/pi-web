# @pi-web/file-context-menu

Standalone right-click (context) menu for a file/directory row, host-agnostic.
Provided actions:

- **Open** — open the file in the host's default viewer (host callback).
- **Open in app** — reveal in the OS file manager or open a registered URL
  scheme (`vscode://`, `cursor://`, `zed://`, custom editors).
- **Copy relative / absolute path**.
- **Download** (files).

The component is **host-agnostic**: it knows nothing about the host app; the
host injects an `adapter` (launcher + copy + labels). No `@/` alias, no
`components/sidebar` imports — the package only depends on `react`.

## Install / build

```bash
npm install          # in this folder (for local dev; react is a peer dep)
npm run build        # -> dist/ (ESM + .d.ts) via tsc
npm publish          # after build (prepack runs build automatically)
```

Publishes `@pi-web/file-context-menu` with `exports` pointing at `dist`
(ESM only, `"use client"` preserved for Next.js).

## API

```tsx
import { FileRowContextMenu, type FileContextMenuAdapter } from "@pi-web/file-context-menu";

const adapter: FileContextMenuAdapter = {
  launchExternal(payload) { /* reveal | open a URL scheme */ },
  copy(text) { /* clipboard */ },
  labels: {
    open: "打开",
    openInApp: "在应用中打开",
    copyRelative: "复制相对路径",
    copyAbsolute: "复制绝对路径",
    download: "下载文件",
    openWith: { explorer: "资源管理器", vscode: "VS Code", cursor: "Cursor", zed: "Zed" },
  },
};

<FileRowContextMenu
  node={{ name, fullPath, isDir }}
  x={x} y={y}
  cwd={cwd}
  onOpen={() => { /* open in host viewer */ }}
  onClose={() => {}}
  adapter={adapter}
/>
```

When `adapter.launchExternal` is omitted, the "open in app" submenu is hidden
(graceful degradation): only open / copy / download remain.

## Integrate into pi-web

- **Local dev**: `tsconfig.json` maps `@pi-web/file-context-menu` to
  `./file-context-menu/src/index.ts` (source, no build needed).
- **Distribution**: after `npm publish`, add `"@pi-web/file-context-menu":
  "^0.1.0"` to the host app's `dependencies` and **remove** the tsconfig path
  alias — the package resolves from `node_modules`. Then any machine (or an
  `npx`-installed build) that installs the host app gets the menu.
