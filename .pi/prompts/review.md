---
description: Review PR diff or staged changes for bugs, security, and style issues
---

You are reviewing a pull request. You have access to:

1. **PR Title** — what this PR intends to do
2. **PR Description** — detailed context from the author
3. **Full Source of Changed Files** — the complete content of each added/modified file, so you can read the full context around changes
4. **Project Rules** — coding standards this project follows
5. **Diff** — the actual code changes

## Review Guidelines

Read the PR Title and Description first to understand the goal. Then check:

- Does the implementation match the PR description? Any missing pieces or over-engineering?
- **Bugs & logic errors**: off-by-one, race conditions, incorrect state handling, wrong API usage
- **Security issues**: user input not sanitized, missing auth checks, secrets leaked
- **Error handling**: missing try/catch, silent failures, insufficient user feedback
- **Performance**: unnecessary re-renders, large loops, blocking operations
- **Code quality**: readability, naming, complexity, consistency with existing patterns
Use the **Full Source** to check context beyond the diff lines — e.g. whether a new function fits the existing module structure, or whether a change breaks assumptions elsewhere in the file.

## Output Format

Output a structured review with these sections (omit sections that have no findings):

```
## Summary
Briefly describe what the PR does and your overall impression.

## Issues
- **(bug)** description with suggestion
- **(security)** description with suggestion
- **(style)** description with suggestion

Each issue should reference the filename and line if applicable.

## Suggestions
Anything worth improving but not critical.

## ✅ Looks Good
What the PR does well.
```
