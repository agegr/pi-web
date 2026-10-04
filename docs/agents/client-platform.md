# Mobile and browser behavior

## Mobile software keyboard (`hooks/useViewportHeight.ts`)
- While an editor has focus and the visual viewport is more than `KEYBOARD_MIN_HEIGHT_PX` (60px) shorter than `innerHeight / scale`, the hook writes `visualViewport.height` to `--app-viewport-height`; smaller shrinks are Safari toolbars. Always compare against that zoom-corrected height, or iOS auto-zoom and pinch zoom leave the composer behind the keyboard.
- WebKit settles the shrunken height only after the keyboard animation, often without another `resize` (bugs.webkit.org 265578), and an IME candidate bar resizes the keyboard with no viewport event at all. So every trigger, composition/input/keyup events on a focused editor included, starts one non-restarting chain of re-reads (`SETTLE_DELAYS_MS`). Reading once per event keeps the full-screen height, and `scrollTo(0, 0)` then fights the page scrolling to the caret: a jittering composer.
- The same check sets `<html data-keyboard-open>`. Under `(max-width: 640px), (pointer: coarse) and (max-height: 500px)` (phone landscape included; tablets keep their controls) CSS hides `.chat-input-controls` and `.extension-status-shelf` and drops the bottom safe-area padding the keyboard covers. `MobilePwaLayout.test.mjs` asserts each targeted class exists on its component, so a rename cannot leave a rule silently dead.

## Sidebar breakpoint (`components/AppShell.tsx`)
- The mobile drawer starts closed on entering the mobile breakpoint. Desktop open state is remembered separately, seeded from the URL's initial `sidebarCollapsed` value and updated only by explicit desktop toggles. Returning to desktop restores that preference; mobile drawer toggles, backdrop clicks and toolbar actions must not replace it.

## Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`.
- Autoplay policy requires unlocking sound from a user gesture: `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.
