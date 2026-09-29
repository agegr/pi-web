// Demo copy: only the event type TerminalPanel reads. The real module spawns
// shells with node-pty on the server; the demo's terminal is mock/terminal.ts.
export type TerminalEvent =
  | { type: "output"; data: string; offset: number; reset?: boolean }
  | { type: "exit"; exitCode: number }
  | { type: "closed" };
