# Session Details Collapse Design

## Goal

Keep completed session history compact and visually stable while preserving live visibility into the currently running turn.

## Behavior

- Completed and historical turns render their `Process details` group collapsed by default.
- Thinking and tool-call blocks in completed and historical messages render collapsed by default.
- Thinking and tool-call blocks belonging to the current running turn render expanded by default.
- Users can still expand or collapse every disclosure manually.
- Deferred historical thinking is requested only after its thinking block is expanded.

## State Ownership

`ChatWindow` owns the decision about whether a message belongs to the live tail. It already identifies the current running turn using the active session state, streaming state, last group anchor, and the turn's position at the end of the message list.

`ChatWindow` passes an explicit default-details flag to `MessageView`. `MessageView` passes that value to thinking and tool-call blocks instead of those blocks inferring activity independently. The streaming message receives the expanded default directly.

Completed process groups do not receive an expanded default, so they retain their collapsed component default.

## Loading And Layout Stability

Collapsed historical thinking blocks do not mount Markdown content and do not request deferred thinking. This prevents a session open from mounting and asynchronously resizing a large number of historical blocks.

The live turn stays expanded because its changing height represents current work and is already handled by the existing live-tail scroll anchoring.

No page-level loading mask, artificial delay, or new animation is introduced.

## Testing

- Verify completed process groups default to collapsed.
- Verify historical thinking and tool calls default to collapsed.
- Verify a current running message defaults its thinking and tool calls to expanded.
- Verify deferred thinking remains unloaded while collapsed and loads after expansion.
- Run focused component tests, TypeScript, and lint.
- Build and browser-test a real long session at desktop and narrow widths.
- Compare initial-load scroll height and layout-shift evidence against the expanded baseline.

## Scope

Only session process-detail disclosure defaults and their tests are changed. Sidebar, file explorer, persistence, message content formatting, and unrelated layout behavior remain unchanged.
