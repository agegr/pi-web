# Codex-Style Dialog System

## Goal

Unify every Pi Web dialog under a quiet, precise Codex-style system while preserving each workflow's behavior. Dialogs should feel native to the product, make blocking requests immediately understandable, and avoid decorative card styling.

## Scope

This design covers all current dialog and modal surfaces:

- Agent and extension requests: select, confirm, input, editor, and custom terminal UI.
- Confirmation and risk dialogs: project trust, unsaved settings, provider/model deletion, dirty-worktree removal, and session deletion.
- Tool dialogs: directory picker, provider picker, and quick switcher.
- Full-screen viewers: image preview and Mermaid zoom.

The implementation must replace native `window.confirm` calls so every confirmation can follow the same visual and accessibility rules.

## Design Direction

Use the approved “Codex work request” direction:

- Quiet neutral surfaces using existing Pi Web tokens.
- One-pixel borders, 5–8px radii, compact typography, and restrained shadows.
- Clear title, optional source/status line, concise content, and a stable action region.
- No decorative icons, oversized headings, nested cards, gradients, glass effects, or verbose feature descriptions.
- Accent color indicates focus and the primary command; red is reserved for destructive confirmation.

## Dialog Categories

### 1. Confirmation And Risk

Use for deletion, discard, trust, and force operations.

- Desktop shell: `width: min(420px, calc(100vw - 32px))`.
- Header: 13–14px title and an optional semantic icon.
- Body: 12px text with 1.5–1.6 line height.
- Affected paths or item names appear in a compact monospace inset, not a nested card.
- Footer: secondary action first, destructive or primary action last.
- Destructive styling appears only on the final destructive action.

### 2. Agent Work Requests

Use for extension select, confirm, input, and editor requests.

- Select, confirm, and input shell: `width: min(520px, calc(100vw - 32px))`.
- Editor shell: `width: min(680px, calc(100vw - 32px))` with a bounded responsive height.
- Header: request title plus a small source/status line such as “Agent request · Waiting for your input.”
- Select options render as dense list rows with optional numeric key hints, not separate cards.
- Input controls use 34–36px height; editor uses the existing monospace type and remains resizable within viewport limits.
- Footer remains quiet. Select requests complete by choosing a row and therefore need only Cancel; confirm/input/editor requests show Cancel and the primary action.
- Custom terminal UI uses the same header, border, close control, and backdrop but retains its terminal data flow and wider content area.

### 3. Tool Panels

Use for directory selection, provider selection, quick switching, and terminal-oriented custom UI.

- Desktop shell: 820px for directory, provider, and quick-switcher tools; 920px for the custom terminal UI. All use `max-width: calc(100vw - 32px)`.
- Header or toolbar height: 40–48px.
- Search, navigation, content, and footer remain distinct full-width regions separated by one-pixel borders.
- Rows remain dense and scannable. Do not wrap repeated entries in decorative cards.
- The directory picker retains filesystem navigation and creation behavior.
- Provider picker and quick switcher retain native-dialog focus trapping and keyboard navigation.

### 4. Full-Screen Viewers

Image preview and Mermaid zoom remain full-screen because the viewed content needs the space.

- Use the shared backdrop tone and close-button treatment.
- Preserve image containment, Mermaid zoom controls, Escape behavior, and viewport-safe padding.
- Viewer chrome should be limited to the toolbar and familiar icon controls.

## Shared Visual Contract

- Backdrop: `rgba(0, 0, 0, 0.4)` for ordinary dialogs and tools. Image preview retains `rgba(0, 0, 0, 0.72)` for media contrast. Do not blur ordinary dialog backdrops.
- Surface: `var(--bg)` or `var(--bg-panel)` according to existing content hierarchy.
- Border: `1px solid var(--border)`.
- Radius: 8px for dialog shells, 5–6px for controls.
- Shadow: compact defined shadow, no wide soft “floating card” effect.
- Title: 13–14px, weight 600–650.
- Supporting text: 11–12px in `var(--text-muted)` or `var(--text-dim)`.
- Buttons: 30–32px desktop height and at least 44px mobile touch height.
- Icon buttons: familiar Lucide icons with tooltips and accessible names.
- Spacing: 14–16px body padding and 7–8px action gaps.
- Letter spacing remains zero.

## Interaction Contract

- Migrate confirmation, Agent request, directory, provider, quick-switcher, terminal, image, and Mermaid surfaces to native `<dialog>` so focus trapping, inert background behavior, and focus restoration have one platform contract.
- Escape cancels or closes whenever the operation is idle. Busy trust, deletion, filesystem, or save operations remain visible until the operation settles.
- Every Agent request supports its protocol's existing cancellation path: `{ cancelled: true }` for standard requests and Ctrl+C (`\x03`) for custom terminal UI.
- Backdrop click closes only non-destructive, non-busy dialogs where accidental cancellation is safe.
- Every dialog has a visible close or Cancel path. While a destructive or filesystem operation is busy, that control remains visible but disabled.
- Initial focus goes to the primary input, selected option, or safest action depending on the dialog type.
- Closing restores focus to the invoking control.
- Enter submits single-line inputs and confirmations; editor submission keeps the existing Ctrl/Cmd+Enter contract.
- Disabled and busy states retain visible labels and cannot be activated repeatedly.
- Error content appears inside the dialog near the affected control and uses `role="alert"` where appropriate.

## Responsive Behavior

- Confirmation and Agent request dialogs become bottom-aligned sheets on mobile, with safe-area padding and no decorative floating-card gap at the bottom.
- Tool panels become full-screen on mobile.
- Full-screen viewers stay full-screen.
- All interactive controls meet a 44px mobile touch target.
- Long titles, paths, option labels, and errors wrap without horizontal overflow.
- On-screen keyboard appearance must not push the active input or actions outside the visible viewport.

## Implementation Shape

Introduce a minimal shared dialog shell and CSS contract only where it removes real duplication:

- Shared backdrop, shell, header, body, footer, button, close-button, and size classes.
- Specialized request, confirmation, tool, and viewer components retain their own data and behavior.
- Do not introduce a configuration-driven dialog framework or rewrite unrelated state management.
- Replace the two `window.confirm` calls with the shared confirmation surface.

## Migration Map

- `ChatWindow.tsx`: Agent request dialog and custom extension panel.
- `ProjectTrustDialog.tsx`: confirmation/risk shell.
- `DirectoryPicker.tsx`: tool panel shell.
- `SettingsPage.tsx`: unsaved changes confirmation.
- `ModelsConfig.tsx`: provider picker and delete confirmation.
- `CodexSidebar.tsx`: quick switcher plus worktree/session confirmations.
- `ImagePreview.tsx`: viewer chrome.
- `MermaidBlock.tsx`: viewer chrome.

## Accessibility

- Preserve or add `role="dialog"`, `aria-modal`, labelled titles, accessible close labels, and visible focus states.
- Keep keyboard navigation for quick switcher and selection requests.
- Ensure text and controls meet WCAG 2.1 AA contrast.
- Respect reduced-motion preferences; dialog appearance may crossfade but must not depend on motion.
- Screen readers must receive the request title, body, errors, and current busy state in a sensible order.

## Verification

- Add focused tests for the shared shell contract and each dialog category.
- Add behavior tests for Escape, backdrop cancellation rules, focus restoration, primary submission, and destructive confirmation.
- Verify both existing `window.confirm` paths use the styled confirmation surface.
- Run the relevant component tests and production build.
- Use authenticated browser QA at desktop and mobile viewports to inspect selection, confirmation, input, editor, tool, and viewer dialogs.
- Check screenshots for overflow, overlapping controls, consistent dimensions, and mobile safe-area behavior.
