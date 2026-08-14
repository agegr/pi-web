# GitHub README landing refresh

Date: 2026-08-14

## Goal

Replace the post-migration handbook README with a quiet product landing page. Keep only English and Simplified Chinese. One current dark desktop screenshot.

## Decisions

- Structure B: short landing + install + remote-access warning + data/safety + doc links.
- One hero: 1440×900 dark English UI, sidebar + transcript + context card.
- Delete `README.ja.md`, `README.ru.md`, `docs/pi-web-projects.png`, `docs/pi-web-settings.png`, `docs/screenshot2.png`.
- `package.json#files` and the staged package test drop the Japanese/Russian READMEs.
- GitHub About: `Local browser workspace for the pi coding agent`.

## Out of scope

Architecture dump, repository layout, downstream session-menu recipe, long proxy examples.
