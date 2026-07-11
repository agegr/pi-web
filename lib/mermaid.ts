import type { RenderResult } from "mermaid";

type MermaidModule = typeof import("mermaid");
type MermaidTheme = "dark" | "default";

// Mermaid configuration is global; serialize initialization and rendering so
// a theme change cannot reset config during another diagram's render.
const MAX_CONCURRENT_RENDERS = 1;

let modulePromise: Promise<MermaidModule> | null = null;
let initializedTheme: MermaidTheme | null = null;
let activeRenders = 0;
const pendingRenders: (() => void)[] = [];

function loadMermaid(): Promise<MermaidModule> {
  modulePromise ??= import("mermaid");
  return modulePromise;
}

async function acquireRenderSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1;
    return;
  }
  await new Promise<void>((resolve) => pendingRenders.push(resolve));
}

function releaseRenderSlot(): void {
  const next = pendingRenders.shift();
  if (next) next();
  else activeRenders -= 1;
}

export async function renderMermaid(
  id: string,
  code: string,
  isDark: boolean,
): Promise<RenderResult> {
  await acquireRenderSlot();
  try {
    const { default: mermaid } = await loadMermaid();
    const theme: MermaidTheme = isDark ? "dark" : "default";
    if (initializedTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme,
      });
      initializedTheme = theme;
    }

    const parsed = await mermaid.parse(code, { suppressErrors: true });
    if (!parsed) throw new Error("Invalid Mermaid diagram");
    return await mermaid.render(id, code);
  } finally {
    releaseRenderSlot();
  }
}
