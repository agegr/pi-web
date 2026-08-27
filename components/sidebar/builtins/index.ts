/**
 * Built-in registration: the plugin registers its own tab pages and file
 * previewers through the same {@link BetterSidebarService} external plugins
 * use — eating its own dogfood. The descriptors live next to their feature
 * modules (tabs.tsx / viewers.tsx); this module only aggregates them and
 * owns the disposer lifecycle (cordis auto-invokes it on fiber disposal,
 * HMR-safe).
 */
import type { Context } from '../context-types'
import type { BetterSidebarService } from '../service'
import { builtinTabs, type BuiltinTabOptions } from './tabs'
import { builtinViewers } from './viewers'

/**
 * Register all built-in tabs and viewers with the service. Returns a
 * disposer that unregisters everything (cordis auto-invokes it on fiber
 * disposal). The `ctx` is threaded into tab descriptors that need it
 * (EditorHost reads `ctx.betterSidebar` for file-viewer matching).
 */
export function registerBuiltins(
  ctx: Context,
  service: BetterSidebarService,
  options: BuiltinTabOptions = {},
): () => void {
  const disposers: (() => void)[] = []
  for (const tab of builtinTabs(ctx, options)) {
    disposers.push(service.registerTab(tab))
  }
  for (const viewer of builtinViewers()) {
    disposers.push(service.registerFileViewer(viewer))
  }
  return () => {
    for (const d of disposers) {
      try { d() } catch { /* already disposed */ }
    }
  }
}
