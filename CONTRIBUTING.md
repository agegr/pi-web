# Contributing to Pi Web

[中文](./docs/CONTRIBUTING.zh-CN.md)

Pi Web is a light web front end for the [pi coding agent](https://github.com/earendil-works/pi). It reads and writes the same agent directory as the pi CLI and runs sessions through pi's SDK. Most declined pull requests are well built but fall outside that scope, so please read this page before starting on a feature.

## What Pi Web is for

- **Doing in a browser what a terminal does less well.** Browse sessions by project. Read files, diffs and tool output. Configure models, skills, agents, plugins and MCP servers through forms instead of hand-edited JSON. Use pi from a phone or from another machine on your network.
- **Behaving like pi.** A session behaves the same whether it runs in Pi Web or in the pi CLI. Extensions written for the CLI work in Pi Web unchanged, and pi's TUI (`@earendil-works/pi-tui`) shows what an extension's request means.

## Out of scope

These are declined however well they are implemented:

- **Changes to what pi itself does.** This covers the system prompt, tool behavior, prompt template expansion, retries, compaction, and what gets written to session files. Propose these upstream in pi.
- **Features that could be a pi extension.** Examples are scheduled messages, custom commands and new providers. An extension works in pi and in Pi Web; see [#666](https://github.com/agegr/pi-web/issues/666) for scheduled sending done as an extension.
- **Pi Web-only configuration or extension API.** This means new config files only Pi Web reads, new `ctx.ui.*` options or `extension_ui_request` fields, and new meanings for existing fields. The web client decides how to display what pi's protocol already expresses.
- **IDE or Git client features.** This covers editing files, file management (create, rename, delete), commit history and a second diff view. The file viewer is read-only. Editing is left to the agent or to your own editor.
- **New subsystems or operating modes.** Examples are schedulers, long-running background agents, a plugin or UI-slot system, a second "lite" mode, and multi-pane layouts.
- **Visual customization beyond the built-in themes.** That rules out custom themes, skins, chat backgrounds and extra accent colors. Appearance is one of the built-in themes (Light, Mist, Rose, Sand, Lilac, Dark, Pine, Slate, Dusk, Ember, high contrast light or dark, Zenburn, GitHub Light or Dark, One Half Light or Dark, or following the system), plus a few typography settings.
- **More session management.** The sidebar's session management is kept small on purpose: list, pin, archive, rename, fork, delete, and project order. Discuss anything beyond that in an issue first.
- **Patching pi's private methods or internal state.** These change without notice between pi releases. Ask upstream for an API instead.

## What gets merged easily

- Bug fixes that include reproduction steps on `main` and fix the cause, not the symptom.
- Small UX improvements that need no new setting, especially ones that match pi's TUI.
- Better rendering of what pi already produces: tool output, Markdown, extension UI.
- Fixes for mobile, PWA, Windows and older Safari.
- Performance work with before-and-after measurements.

## UI rules

- Show each fact once, in the place where pi produces it.
- One good default beats a setting. Add a switch only when both choices are common.
- Keep the top bar and the composer quiet. Configuration belongs in Settings.
- Use the existing theme tokens in `app/globals.css`. Do not add new colors.

## Before you open a pull request

- **For a feature, open an issue first** that describes the use case. A quick answer on whether it fits can save you from building it.
- **Keep it to one change per pull request.** Split unrelated fixes into separate ones.
- **For a bug fix, explain how to reproduce it** on `main` and why the change fixes the cause.
- **Run the checks:** `npm test`, `node_modules/.bin/tsc --noEmit`, and `npm run lint`. Do not run `next build` during development (see [AGENTS.md](./AGENTS.md)).
- **Translate new UI text.** Add every new string in `en`, `zh-CN` and `zh-TW` ([Internationalization](./docs/i18n.md)).
- **Read the relevant topic notes.** [AGENTS.md](./AGENTS.md) maps each area of the code to a note in `docs/agents/`. Read the notes for every file you change.
- **Avoid new runtime dependencies.** If one is needed, say why.

A declined pull request does not always mean the idea is rejected. When part of it fits, the closing comment says which part, and that part often comes back later in a narrower form.
