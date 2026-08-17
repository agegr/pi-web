import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./TerminalPanel.tsx", import.meta.url), "utf8");

/** Perceived brightness, 0 (black) to 255 (white). */
function luminance(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return 0.299 * ((value >> 16) & 0xff) + 0.587 * ((value >> 8) & 0xff) + 0.114 * (value & 0xff);
}

function palette(name) {
  const block = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\} satisfies ITheme;`).exec(source);
  assert.ok(block, `${name} must be declared`);
  return Object.fromEntries(
    [...block[1].matchAll(/(\w+):\s*"(#[0-9a-f]{6})"/g)].map((match) => [match[1], match[2]]),
  );
}

test("terminal client uses xterm without link or clipboard addons", () => {
  assert.match(source, /import\("@xterm\/xterm"\)/);
  assert.match(source, /import\("@xterm\/addon-fit"\)/);
  assert.doesNotMatch(source, /WebLinksAddon|ClipboardAddon|allowProposedApi:\s*true/);
  // screenReaderMode rebuilds a live region per row; it is a real cost on a
  // terminal that streams build output, so it stays off.
  assert.doesNotMatch(source, /screenReaderMode:\s*true/);
});

test("both themes ship a full ANSI palette that contrasts with their background", () => {
  const light = palette("LIGHT_ANSI");
  const dark = palette("DARK_ANSI");
  const names = [
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue",
    "brightMagenta", "brightCyan", "brightWhite",
  ];
  assert.deepEqual(Object.keys(light).sort(), [...names].sort());
  assert.deepEqual(Object.keys(dark).sort(), [...names].sort());

  // xterm's stock palette puts near-white on the light theme's white --bg.
  for (const [name, hex] of Object.entries(light)) {
    assert.ok(luminance(hex) < 160, `light ${name} (${hex}) is too pale for a white background`);
  }
  // "black" is legitimately dark on a dark background; everything else must read.
  for (const [name, hex] of Object.entries(dark)) {
    if (name === "black") continue;
    assert.ok(luminance(hex) > 100, `dark ${name} (${hex}) is too dark for a #1a1a1a background`);
  }
});

test("only the visible terminal holds a stream, and it resumes where it left off", () => {
  // Browsers allow six concurrent HTTP/1.1 requests per origin and an SSE
  // response never ends, so a stream per open terminal would deadlock the app.
  assert.match(source, /if \(!ready \|\| !active \|\| exitedRef\.current\) return;/);
  assert.match(source, /\/events\?after=\$\{lastSeqRef\.current\}/);
  assert.match(source, /return \(\) => \{\s*closed = true;\s*source\.close\(\);/);
  assert.equal(source.match(/new EventSource\(/g)?.length, 1);
});

test("a replay gap resets the screen instead of writing into a torn escape sequence", () => {
  assert.match(source, /message\.type === "reset"/);
  assert.match(source, /terminal\.reset\(\)/);
});

test("an ended shell stops accepting input", () => {
  assert.match(source, /terminal\.options\.disableStdin = true/);
  assert.match(source, /source\.readyState === EventSource\.CLOSED/);
  assert.match(source, /onExitRef\.current\?\.\(\)/);
});

test("terminal commands are JSON, serialized, and bounded by the server", () => {
  assert.match(source, /commandQueue = commandQueue\.then/);
  assert.match(source, /headers: \{ "Content-Type": "application\/json" \}/);
  assert.match(source, /send\(\{ type: "input", data: data\.slice\(0, end\) \}\)/);
  assert.match(source, /Math\.min\(data\.length, 16_384\)/);
  assert.match(source, /send\(\{ type: "resize", columns: cols, rows \}\)/);
  // A recovered request has to clear the banner it raised, or one blip leaves
  // the panel looking broken for the rest of its life.
  assert.match(source, /if \(!disposed\) clearError\(\);/);
});

test("a soft keyboard can reach the keys a shell is driven with", () => {
  // A phone keyboard has no Esc, Tab, Ctrl or arrows, which rules out most of
  // what a shell needs. The sequences come from the agent's own key table so
  // there is one definition of what "arrow up" means.
  assert.match(source, /import \{ toTerminalKeyData \} from "@\/lib\/terminal-input"/);
  for (const key of ["Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    assert.match(source, new RegExp(`key: "${key}"`), `${key} must be reachable`);
  }
  assert.match(source, /\{ label: "\^C", key: "c", ctrl: true \}/);
  // Routed through xterm so soft keys share the batching path with real ones.
  assert.match(source, /terminalRef\.current\?\.input\(data\)/);
});

test("copy and paste use the shifted bindings, since Ctrl+C is SIGINT", () => {
  assert.match(source, /attachCustomKeyEventHandler/);
  assert.match(source, /!event\.ctrlKey \|\| !event\.shiftKey/);
  assert.match(source, /terminal\.getSelection\(\)/);
  assert.match(source, /terminal\.paste\(text\)/);
});

test("locale changes re-render labels without recreating the terminal", () => {
  const streamEffect = /\}, \[sessionId, terminalId, active, ready, clearError, markExited, reportError\]\);/;
  assert.match(source, streamEffect);
  assert.match(source, /\}, \[sessionId, terminalId, clearError, reportError\]\);/);
  assert.match(source, /translateRef\.current = t;/);
});
