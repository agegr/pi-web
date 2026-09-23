/**
 * A pretend terminal for the right-hand panel: echoes keystrokes, supports
 * basic line editing and runs the simulated shell from ./shell.
 */
import type { MockEventSource } from "./event-source";
import type { MockRequest } from "./http";
import { error, json } from "./http";
import { currentDemoLocale } from "./locale";
import { HOME } from "./paths";
import { runShellCommand } from "./shell";

interface FakeTerminal {
  cwd: string;
  line: string;
  backlog: string;
  offset: number;
  listeners: Set<MockEventSource>;
}

const terminals = new Map<string, FakeTerminal>();

function prompt(terminal: FakeTerminal): string {
  const dir = terminal.cwd.startsWith(HOME) ? `~${terminal.cwd.slice(HOME.length)}` : terminal.cwd;
  return `\x1b[32mdemo@pi-web\x1b[0m:\x1b[34m${dir}\x1b[0m$ `;
}

function write(terminal: FakeTerminal, data: string): void {
  terminal.backlog += data;
  terminal.offset += data.length;
  for (const source of terminal.listeners) source.send({ type: "output", data, offset: terminal.offset });
}

function banner(): string {
  return currentDemoLocale() === "zh"
    ? "\x1b[2m这是演示用的模拟终端：可以试试 ls、cat README.md、git status、git log。\x1b[0m\r\n"
    : "\x1b[2mThis is a simulated terminal for the demo. Try ls, cat README.md, git status or git log.\x1b[0m\r\n";
}

async function handleInput(terminal: FakeTerminal, data: string): Promise<void> {
  for (const char of data) {
    if (char === "\r") {
      const command = terminal.line.trim();
      terminal.line = "";
      write(terminal, "\r\n");
      if (command === "clear") {
        write(terminal, "\x1b[2J\x1b[H");
      } else if (command.startsWith("cd")) {
        const target = command.slice(2).trim();
        if (!target || target === "~") terminal.cwd = HOME;
        else if (target === "..") terminal.cwd = terminal.cwd.slice(0, terminal.cwd.lastIndexOf("/")) || "/";
        else terminal.cwd = target.startsWith("/") ? target : `${terminal.cwd}/${target}`;
      } else if (command) {
        const result = await runShellCommand(command, terminal.cwd);
        if (result.output) write(terminal, `${result.output.replace(/\n/g, "\r\n")}\r\n`);
      }
      write(terminal, prompt(terminal));
    } else if (char === "\x7f") {
      if (terminal.line) {
        terminal.line = terminal.line.slice(0, -1);
        write(terminal, "\b \b");
      }
    } else if (char === "\x03") {
      terminal.line = "";
      write(terminal, `^C\r\n${prompt(terminal)}`);
    } else if (char >= " " || char === "\t") {
      terminal.line += char;
      write(terminal, char);
    }
  }
}

export async function terminalRoutes(request: MockRequest): Promise<Response> {
  const id = request.segments[2];
  if (!id) {
    const body = await request.json<{ id?: string; cwd?: string }>();
    const terminalId = body.id ?? Math.random().toString(16).slice(2).padEnd(32, "0");
    const terminal: FakeTerminal = { cwd: body.cwd ?? HOME, line: "", backlog: "", offset: 0, listeners: new Set() };
    terminals.set(terminalId, terminal);
    write(terminal, banner() + prompt(terminal));
    return json({ id: terminalId });
  }
  const terminal = terminals.get(id);
  if (request.method === "DELETE") {
    terminals.delete(id);
    return json({ success: true });
  }
  if (!terminal) return error("Terminal expired or closed", 404);
  if (request.method === "GET") return json({ id, cwd: terminal.cwd });
  const body = await request.json<{ type?: string; data?: string }>();
  if (body.type === "input" && typeof body.data === "string") void handleInput(terminal, body.data);
  return json({ success: true });
}

export function attachTerminalStream(id: string, source: MockEventSource, url: URL): () => void {
  const terminal = terminals.get(id);
  if (!terminal) {
    source.fail();
    return () => {};
  }
  terminal.listeners.add(source);
  const after = Number(url.searchParams.get("after"));
  if (!Number.isFinite(after) || after < terminal.offset) {
    source.send({ type: "output", data: terminal.backlog, offset: terminal.offset, reset: true });
  }
  return () => terminal.listeners.delete(source);
}
