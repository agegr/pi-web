# Structured-ask adapter for question-asking tools

Pi has no wire protocol for "ask the user a question". Extensions that ask
questions, such as the `ask_user` tool from `pi-ask-user`, build a terminal
component and pass it to `ctx.ui.custom()`.

Pi Web runs that component headless, renders it to text lines, and streams the
lines to the browser with raw keystrokes forwarded back
(`AgentSessionWrapper.requestExtensionCustomUi` and `ExtensionCustomPanel`).
That bridge is correct for arbitrary extension UIs, but a text terminal is not
usable with a pointer, and it is close to unusable on a phone. Answering a
question is a core part of an agent session, so it gets a real interface.

## Decision

Pi Web keeps a small adapter layer in `lib/structured-ask.ts`. An adapter maps
one known tool call onto a `StructuredAskSpec` (question, context, options,
multi-select, freeform, comment), and maps a submitted answer back onto the
value that the extension's `ctx.ui.custom()` promise must resolve with.

The server correlates a custom UI request with the tool call that is running
when the request arrives (`AgentSessionWrapper.detectStructuredAsk`). The
extension API supplies no tool identity with `ctx.ui.custom()`, and a
question-asking tool blocks while its question is open, so the running tool
calls are both the only correlation available and a sufficient one.

When an adapter matches, the `extension_ui_request` event carries an `ask`
field and the browser renders `AskCard`, a pointer-first form. The browser
sends back an `extension_ui_ask_response` command. The server checks the
submission against the question it answers, then resolves the extension's
promise. A submission that does not fit leaves the question open.

Finished questions render as `AskAnswerCard` in the transcript, rebuilt from
the tool result details, so a decision stays visible in session history.

## Consequences

- Pi Web holds knowledge of one extension's argument and result shapes. That
  knowledge is confined to one adapter entry, and adding another
  question-asking extension means adding another entry.
- Every unrecognized custom UI keeps the existing terminal panel. The panel is
  also available for a recognized question through the terminal-view button, so
  a shape change in the extension cannot lock a user out of an answer.
- The native form never synthesizes keystrokes, so a change in the extension's
  key handling cannot corrupt an answer.
