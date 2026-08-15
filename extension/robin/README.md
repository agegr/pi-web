# Robin — personal dashboard for pi-web

Everything under `extension/robin` is loaded two ways:

- **As a pi extension**, from `~/.pi/agent/extensions/robin` (a symlink to this
  directory). jiti imports the TypeScript directly — no build step.
- **As modules imported by the Next.js app**, for the API routes and, for the
  pure modules only, the browser.

```bash
ln -sfn "$PWD/extension/robin" ~/.pi/agent/extensions/robin
```

Editing anything here requires **restarting pi-web** (or the `pi` CLI). Extensions
are loaded and cached when a session starts, so a running session keeps the old
tool definitions.

## Module boundary

Client components may only import from the pure modules. A `node:fs` import
anywhere in an imported module's graph breaks the browser bundle.

| Module | Client-safe | Contains |
| --- | --- | --- |
| `dates.ts` | yes | local calendar dates, week/month grid maths |
| `events.ts` | yes | event model, ordering, grouping |
| `links.ts` | yes | link model, URL normalisation, grouping |
| `tools.ts` | yes | the assistant's tool allow-list |
| `store.ts` | **no** | file-backed reads and writes |
| `paths.ts` | **no** | data directory and atomic JSON I/O |
| `fetch-title.ts` | **no** | outbound page-title lookup |
| `google-calendar.ts` | **no** | OAuth and the Google Calendar feed |

Importing a *type* from a server-only module is fine — type imports are erased.

## Time

Two kinds of value, never mixed (see the comment at the top of `dates.ts`):

- **Local calendar dates** (`YYYY-MM-DD`) and **wall-clock times** (`HH:MM`) —
  `Todo.due`, `CalendarEvent.date/start/end`. What the user means by "tomorrow at
  3pm". Never converted.
- **Instants** (UTC ISO) — `createdAt`, `completedAt`. When something happened.

Deriving "today" with `new Date().toISOString().slice(0, 10)` is the bug this
split exists to prevent. Use `localDate()`.

## Data

Stored in `~/.pi/robin` (override with `ROBIN_DATA_DIR`):

| File | Contents |
| --- | --- |
| `todos.json` | todo list |
| `events.json` | locally created calendar events |
| `links.json` | saved links |
| `assistant.json` | the pi session id the dashboard assistant talks to |
| `google.json` | Google refresh token — **a long-lived credential**, mode 0600 |

## Google Calendar (read-only)

The integration reads the primary calendar and merges it into the dashboard
view. Nothing is written to Google, and pulled events are never saved to
`events.json`.

The OAuth client must be your own — this app runs locally, so there is no shared
client to fall back on.

1. In the [Google Cloud console](https://console.cloud.google.com/), create (or
   pick) a project.
2. Enable **Google Calendar API** for it.
3. Configure the OAuth consent screen: **External**, and add your own Google
   account under **Test users**. Staying in "Testing" is fine for personal use;
   note that refresh tokens for unverified apps expire after 7 days, so you will
   re-connect weekly unless you publish the app.
4. Create credentials → **OAuth client ID** → application type **Web
   application**.
5. Add an **Authorized redirect URI** matching where you run pi-web exactly —
   the dashboard shows the value it expects. For the default port that is
   `http://localhost:30141/api/robin/google/callback`.
6. Put the client id and secret in `.env.local` at the repository root:

   ```
   ROBIN_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   ROBIN_GOOGLE_CLIENT_SECRET=...
   ```

7. Restart pi-web, then press **Connect** under the calendar.

To revoke: press **Disconnect** (drops the stored token), and optionally remove
the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
