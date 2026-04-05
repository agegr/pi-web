# pi-web

A web interface for the [pi coding agent](https://github.com/badlogic/pi-mono). Browse sessions, chat with the agent, fork conversations, and navigate message branches — all in the browser.

## Installation

```bash
npm install -g @agegr/pi-web
pi-web
```

Open [http://localhost:3355](http://localhost:3355).

Set a custom port with the `PORT` environment variable:

```bash
PORT=8080 pi-web
```

## Development Setup

```bash
npm install
npm run dev
```

## Features

- **Session browser** — lists all pi sessions grouped by working directory
- **Live chat** — sends messages to the agent with real-time streaming via SSE
- **Fork** — branch a session from any user message into a new independent session
- **In-session branching** — navigate back to any point and continue from there, creating a branch in the same session file
- **Branch navigator** — visual switcher for branch points within a session
- **Model selector** — switch models mid-session
- **Tool panel** — toggle which tools the agent can use
- **Compact** — summarize long sessions to save context window
- **Steer / Follow-up** — interrupt the agent mid-run or queue a message for after it finishes

## Notes

- **Agent data directory** — reads sessions from `~/.pi/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to use another agent directory.
- **Models** — reads available models from `models.json` in the agent directory. You can edit them from the sidebar `Models` panel.
- **Files** — the sidebar includes a file explorer for the current working directory and can open files in tabs.

## Project structure

```
app/
  api/
    sessions/      # read/write session files
    agent/         # send commands, stream events via SSE
    files/         # read file contents for the in-app viewer
    models/        # list available models + default model
    models-config/ # read and write models.json
components/        # UI components
lib/
  session-reader.ts  # parse .jsonl session files
  rpc-manager.ts     # manage AgentSession lifecycle
  normalize.ts       # normalize toolCall field names (file vs. stream format)
  types.ts
```

Sessions are stored as `.jsonl` files at `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
