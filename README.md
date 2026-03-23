# pi-web

A web interface for the [pi coding agent](https://github.com/mariozechner/pi). Browse sessions, chat with the agent, fork conversations, and navigate message branches — all in the browser.

## Setup

```bash
npm install
npm run build
npm start
```

Open [http://localhost:3030](http://localhost:3030).

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

## Project structure

```
app/
  api/
    sessions/     # read session files
    agent/        # send commands, stream events
    models/       # list available models
components/       # UI components
lib/
  session-reader.ts   # parse .jsonl session files
  rpc-manager.ts      # manage AgentSession lifecycle
  types.ts
```

Sessions are stored as `.jsonl` files at `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
