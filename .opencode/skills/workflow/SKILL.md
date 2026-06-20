---
name: workflow
description: Load for ANY new task. Defines the flow: new task → openspec proposal → human review → apply → lint → archive. UI changes → invoke ui-ux-pro-max first. Every task ends with `npm run lint`. Auto-load when user says "add a feature" / "fix a bug" / "restyle" / "change UI" / "what should I do".
---

# Workflow

## New Task — Always Run OpenSpec First

```
1. /opsx:propose <name>       # AI drafts proposal.md + design.md + tasks.md
2. HUMAN reviews 3 md files   # 15-30 min, must approve before apply
3. /opsx:apply                # AI implements per tasks.md
4. After each task → npm run lint
5. npm run dev smoke test
6. /opsx:archive              # When all tasks done
7. git commit (use git-commit skill for message)
```

**Never write code without a proposal. No proposal, no code.**

## UI Change — Invoke ui-ux-pro-max First

```
1. /ui-ux-pro-max             # Generate / validate design tokens
2. Write code using globals.css tokens (bg-bg / text-text / etc.)
3. Test light + dark mode
4. npm run lint
```

**Never hardcode colors (#fff, rgb(...), Tailwind default palette).**
**Never use gradient backgrounds or glassmorphism in this project.**

## Every Task — End With

```bash
npm run lint                  # MUST pass before declaring done
```

If lint fails → fix → re-run. Don't ship broken lint.

## Lint Errors — Quick Fixes

| Error | Fix |
|-------|-----|
| Hardcoded color | Replace with `bg-bg` / `text-text` etc. from globals.css |
| File > 400 lines | Split into `components/[Name]/*` subdirectory (load `architecture`) |
| `any` type | Use `unknown` + type guard, or define proper type |
| `// @ts-ignore` | Replace with `// @ts-expect-error <reason>` |
| Import from outside directory | Import only from `[Name]/index.ts` |
| `React.FC` in props | Remove FC, write props as plain type |

## Red Lines (AI must never violate)

- ❌ Delete any file under `~/.pi/agent/sessions/`
- ❌ Modify `lib/rpc-manager.ts` without explicit human ack
- ❌ Change `package.json` dependency versions without human ack
- ❌ `git push` (human does it)
- ❌ Skip `/opsx:propose` and start coding directly
- ❌ Write code without running `npm run lint` at the end

## Quick Decision Tree

```
User says "add X" / "build X" / "fix X"
  → Run /opsx:propose X
  → Wait for human review
  → Run /opsx:apply

User says "restyle" / "change UI" / "make it look better"
  → Run /ui-ux-pro-max FIRST
  → Then write code

User says "refactor" / "split this file" / "too big"
  → Load architecture skill
  → Propose split plan, get human ack

User says "something broke" / "AI messed up"
  → STOP all AI work
  → Report to human
  → Read incident-response in AGENTS.md
```