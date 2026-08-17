# Robin — a personal dashboard for pi-web

[中文文档](./README.zh-CN.md)

Todos, a calendar, and saved links, all driven by pi. Everything lives in plain
JSON files under `~/.pi/robin`, and the agent that touches them is restricted to
eight tools — no shell, no filesystem.

- **Dashboard** at `/dashboard` — assistant box, calendar (agenda / week / month), todos, links.
- **Agent tools** usable from the dashboard, the `pi` CLI, and Telegram.
- **Google Calendar** read-only, merged into the calendar views.
- **Telegram bridge** so the same assistant works when you are away from the machine.

---

## Setup

### 1. The extension

pi loads extensions from `~/.pi/agent/extensions`. Symlink this directory there:

```bash
ln -sfn "$PWD/extension/robin" ~/.pi/agent/extensions/robin
```

No build step — jiti imports the TypeScript directly.

> **Editing anything under `extension/robin` requires restarting pi-web** (or the
> `pi` CLI). Extensions are loaded and cached when a session starts, so a running
> session keeps the old tool definitions. React components under
> `components/robin` hot-reload normally.

### 2. Run pi-web

```bash
npm run dev
```

Then open <http://localhost:30141/dashboard>, or use the grid icon in the sidebar
header, next to **+ New**.

> Do **not** run `npm run build` during development — see AGENTS.md; it pollutes
> `.next/` and breaks `npm run dev`.

### 3. Credentials (optional)

Google and Telegram are configured at **/dashboard/settings**, not in `.env.local`.
Values are stored in `~/.pi/robin/secrets.json` with mode `0600` and are read per
request, so a change takes effect without restarting the server. An environment
variable of the same name still works as a fallback, and the settings page says
when a value is coming from one.

The page never displays a stored secret — only whether it is set and its last four
characters. The server does not send secrets back to the browser.

---

## What the agent can do

Eight tools, registered in `index.ts` and listed in `tools.ts`:

| Tool | Say something like |
| --- | --- |
| `todo_add` | "remember to pay rent tomorrow" |
| `todo_complete` | "I finished washing the car" |
| `todo_list` | "what's left to do?" |
| `calendar_create_event` | "design review Thursday 3–4pm in room B" |
| `calendar_list_events` | "what's on today?" |
| `link_add` | paste a bare URL |
| `link_list` | "what did I save?" |
| `provider_usage` | "how much OpenAI and Anthropic quota is left?" |

Details worth knowing:

- **A date range is one event.** "19th to the 22nd in Chicago" becomes a single
  event with `endDate`, not four separate ones.
- **Pasted links get their real title.** `link_add` fetches the page `<title>`
  rather than guessing from the URL, and the tool result says which happened.
- **`calendar_list_events` includes Google events**, matching what the dashboard
  shows. They are marked read-only.
- **Relative dates resolve against your local date**, which the list tools state
  explicitly in their output.
- **Subscription usage comes directly from the providers.** `provider_usage`
  resolves the OpenAI Codex and Anthropic OAuth logins already managed by Pi,
  returns only percentages and reset times, and never exposes the tokens. These
  provider-specific usage endpoints are not a stable standard and may change.

### What it deliberately cannot do

- **No shell, no filesystem.** The assistant session activates only the eight
  tools above; pi's `bash`, `read`, `write`, and `edit` stay inactive. This is a
  tool-registration boundary, not a prompt instruction.
- **No writing to Google.** The integration is read-only: it can show your Google
  events but cannot create, change, or delete them.
- **No deleting.** There are no delete tools. Removing a todo, event, or link is a
  click on the dashboard. Remote deletion is a risk that buys little.

---

## The dashboard

**Assistant box** — type a sentence, the agent acts, and the panels refresh
immediately. The line under the reply ("added a todo") comes from tool calls that
actually executed, not from the model's prose.

**Calendar** — three views, remembered per browser:

- **Agenda** — the next three days in full, then one line per remaining day.
- **Week** — a time grid with an all-day band on top. Overlapping events share the
  day's width. The grid is sized to its content (07:00–22:00 by default, widening
  to cover every event) so it never traps the page's scroll.
- **Month** — a rolling four-week window starting from the current week, not a
  calendar month. Multi-day events draw as one continuous bar across the row.

**Todos** — grouped Overdue / Today / Tomorrow / Later / Someday, with completed
items collapsed.

**Links** — grouped, opened with `rel="noopener noreferrer"`.

The UI follows the language selected in pi-web's top bar, including date
formatting.

---

## Google Calendar (read-only)

The OAuth client must be your own; a shared client secret cannot ship in an open
repository.

1. In the [Google Cloud console](https://console.cloud.google.com/), create or
   pick a project.
2. Enable the **Google Calendar API**.
3. Configure the OAuth consent screen as **External** and add your own account
   under **Test users**.
4. Create credentials → **OAuth client ID** → **Web application**.
5. Add the **Authorized redirect URI** exactly as shown on the settings page —
   for the default port, `http://localhost:30141/api/robin/google/callback`.
6. Paste the client ID and secret into **/dashboard/settings**, then press
   **Connect** under the calendar.

> While the app stays in "Testing", Google expires refresh tokens after **7 days**,
> so you will reconnect weekly until you publish it.

Pulled events are never written to `events.json` — they are fetched per request,
so disconnecting removes them immediately.

---

## Telegram

A standalone process, deliberately not a pi extension: extensions load per
session, so every `pi -p` run and every pi-web session would start its own
poller, and concurrent pollers on one token steal each other's messages.

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the
   token.
2. Paste it into **/dashboard/settings** → Telegram.
3. Add your chat id to the allow-list. Press **Detect chat id** after messaging
   your bot — or start the bridge with an empty allow-list, which puts it in
   discovery mode: it reports the ids it sees and acts on nothing.
4. Run it:

```bash
npm run telegram
```

**The allow-list is the only gate.** Bot usernames are searchable, so anyone can
find your bot; a message from an unlisted chat produces no agent call and no
reply at all — silence rather than an error, which would confirm the bot exists.

Other properties:

- **Long polling, never webhooks.** Nothing listens on a public port; no
  certificate or tunnel is involved.
- The bridge talks to pi-web over HTTP and reuses `/api/robin/assistant`, so it
  inherits the same tool boundary rather than defining a second one.
- Replies follow the sender's Telegram client language.
- **Daily briefings.** Configure a machine-local send time and language in
  **Settings → Telegram**. Delivery state is persisted per chat, so restarting
  the bridge or retrying a partial broadcast does not send duplicates.
- **pi-web must be running.** The bridge is its client; if pi-web is down, every
  message answers with an error.
- Changing Telegram settings requires restarting the bridge — it reads them at
  startup.

Known gap: there is no rate limiting. The allow-list keeps strangers out, so this
is a cost concern for rapid messages rather than an exposure.

---

## Data

Everything is in `~/.pi/robin` (override with `ROBIN_DATA_DIR`):

| File | Contents |
| --- | --- |
| `todos.json` | todo list |
| `events.json` | locally created calendar events |
| `links.json` | saved links |
| `assistant.json` | pi session ids for the interactive and read-only briefing assistants |
| `telegram-state.json` | successful daily-briefing deliveries for the current date |
| `secrets.json` | Google and Telegram credentials plus Telegram settings — **mode 0600** |
| `google.json` | Google refresh token — **a long-lived credential, mode 0600** |

The first five are plain JSON on purpose: `grep` them, put them in git, back them
up like any other file.

`secrets.json` and `google.json` are the exception — they hold standing
credentials for your calendar and your messaging account. Keep them out of any
repository or sync folder you would not put a password in.

---

## Working on Robin

### Module boundary

Client components may import only from the pure modules. A `node:fs` import
anywhere in an imported module's graph breaks the browser bundle — Turbopack
fails the build rather than warning.

| Module | Client-safe | Contains |
| --- | --- | --- |
| `dates.ts` | yes | local calendar dates, week/month grid maths |
| `events.ts` | yes | event model, ordering, grouping |
| `layout.ts` | yes | overlap columns, multi-day bar lanes |
| `links.ts` | yes | link model, URL normalisation, grouping |
| `tools.ts` | yes | the assistant's tool allow-list |
| `store.ts` | **no** | file-backed reads and writes |
| `paths.ts` | **no** | data directory and atomic JSON I/O |
| `settings.ts` | **no** | credential storage |
| `fetch-title.ts` | **no** | outbound page-title lookup |
| `google-calendar.ts` | **no** | OAuth and the Google Calendar feed |

Importing a *type* from a server-only module is fine — type imports are erased.

### Time

Two kinds of value, never mixed (see the comment at the top of `dates.ts`):

- **Local calendar dates** (`YYYY-MM-DD`) and **wall-clock times** (`HH:MM`) —
  `Todo.due`, `CalendarEvent.date` / `endDate` / `start` / `end`. What the user
  means by "tomorrow at 3pm". Never converted.
- **Instants** (UTC ISO) — `createdAt`, `completedAt`. When something happened.

Deriving "today" with `new Date().toISOString().slice(0, 10)` is the bug this
split exists to prevent: west of UTC it flips a day early each afternoon. Use
`localDate()`.

`endDate` is **inclusive** — "the 19th to the 22nd" means through the 22nd.
Google's all-day API end is exclusive, so `google-calendar.ts` converts.

### Tests

```bash
npm test
```

The date maths, layout algorithms, Google event mapping, Telegram protocol, and
the settings store are all covered directly, because they fail in ways that are
hard to see in the UI.

---

## Changes to upstream pi-web

Robin is almost entirely additive. New directories: `extension/robin`,
`components/robin`, `app/api/robin`, `app/dashboard`, `scripts/telegram`.

Eight existing files were touched:

| File | Why |
| --- | --- |
| `README.md` | a pointer to this document |
| `components/SessionSidebar.tsx` | dashboard link in the sidebar header |
| `lib/i18n/messages/en.ts`, `zh-CN.ts` | dashboard message catalogue |
| `lib/request-security.ts` | exempt the Google OAuth callback from the same-origin check — a cross-site redirect can never pass it, and the `state` nonce authenticates it instead |
| `lib/request-security.test.mjs` | pin that exemption to one path and one method |
| `tsconfig.json` | `allowImportingTsExtensions`, because these modules are imported by jiti, webpack, and Node's ESM test runner, and Node requires the explicit `.ts` |
| `package.json` | `npm run telegram`, `typebox` for typechecking, `scripts/**` in the test glob |

`package-lock.json` changes with the `typebox` devDependency. Upstream's own
`README.ja.md` and `README.ru.md` are left untouched — those are upstream's
languages; this fork keeps Robin's documentation in English and Chinese only.
