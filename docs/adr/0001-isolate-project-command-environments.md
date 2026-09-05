# Isolate project command environments from the web host

Pi Web sanitizes the environment of its built-in project shells instead of exposing the Next.js host runtime wholesale. The agent `bash` tool and direct user shell commands remove `PORT`, `NODE_ENV`, and `NEXT_*` variables while preserving the SDK-managed PATH, Pi session metadata, and all other inherited values; explicit variables set by a project command still take effect. Third-party extensions retain control of their own tools and subprocesses so existing overrides and remote execution integrations are not intercepted.
