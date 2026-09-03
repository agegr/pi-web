/**
 * pi-web appends this guidance to the system prompt of every full-tool session.
 *
 * Motivation: tool calls have no built-in timeout and the user only sees a
 * spinner until the tool returns, so one unbounded command (pytest deadlock,
 * curl to a half-dead server) leaves the session looking stuck for hours.
 */
export const COMMAND_TIMEOUT_PROMPT = `## Long-running command discipline

Tool calls have no built-in timeout, and the user only sees a spinner until the tool returns — a command that hangs makes the session look stuck indefinitely. Bound every command that can block:

- Wrap potentially long commands with \`timeout\`: e.g. \`timeout 300 npm test\`, \`timeout 600 pytest ...\`.
- Always give network calls an explicit deadline: \`curl -m 30 ...\`, \`wget -T 30 ...\`. Never run a bare \`curl\`/\`wget\` against a possibly unresponsive server.
- For dev servers, watchers, and other intentionally endless processes, run them in the background (\`nohup ... &\` or the tool's background mode) and poll their logs/ports with short bounded commands.
- If a command legitimately needs more than a few minutes, tell the user the expected duration first and set \`timeout\` above it.`;
