# GitHub README Refresh Design

## Scope

Refresh the public GitHub introduction after the TanStack Start migration. Change only `README.md`, `README.zh-CN.md`, and three new screenshots under `docs/`. Keep Japanese and Russian READMEs unchanged and retain `docs/screenshot2.png` because they still reference it.

## Narrative

Use a product-tour-plus-architecture-proof structure. Lead with what Pi Web enables, a one-command start, and a real full-workspace screenshot. Follow with two focused product views, then explain the TanStack Start, Vite, Nitro, framework-neutral API, PWA, security, Windows, and package-verification foundation. Product and architecture coverage should be roughly balanced.

Avoid volatile exact test counts and patch versions in the README. Preserve the remote-access warning, CLI configuration, contributor commands, and repository layout while removing repetition and improving section order.

## Screenshots

Capture three real application views from the exact latest `origin/main` code:

1. `docs/pi-web-workspace.png`: complete desktop workspace with project navigation, a structured conversation, tool activity, and the project file panel.
2. `docs/pi-web-projects.png`: focused project sidebar showing project grouping, running activity, related sessions, archived-project affordance, and a Git worktree.
3. `docs/pi-web-settings.png`: settings center showing Models, Providers, Plugins, and Skills navigation without credentials.

Use the light theme throughout. Run against a temporary `PI_CODING_AGENT_DIR` and a purpose-built demo repository/session dataset. Do not read or copy credentials from `~/.pi`, and do not expose real user paths, project names, session content, model configuration, or API-key state. Commit only PNG files, not the temporary dataset. Capture application content without browser or desktop chrome.

## README Structure

Both English and Simplified Chinese READMEs use the same content order:

1. Language links, concise product description, and quick-start command.
2. Full workspace screenshot.
3. Product workflow overview with project/sidebar screenshot.
4. Configuration overview with settings screenshot.
5. Technical foundation: TanStack Start, Vite, Nitro, framework-neutral handlers, SSE, PWA, security, Windows/package gates.
6. Installation, configuration, remote-access safety, proxy, operational notes, development, repository layout, and license.

## Verification And Integration

Verify the three images are nonblank, correctly framed, free of private paths/data, and legible at GitHub content width. Check Markdown image targets and local links. Run the repository test suite, lint, typecheck, and `git diff --check`. Merge the verified documentation branch into local `main` using a normal merge, verify the merged result, and push `main` to GitHub without force. Do not publish npm, create a tag, or create a GitHub Release.
