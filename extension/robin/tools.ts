/**
 * The tools the dashboard assistant is allowed to use.
 *
 * This list is the security boundary for the assistant session. pi-web starts
 * agent sessions with the coding builtins (bash, read, edit, write, …)
 * available; naming only these here means `setActiveToolsByName` leaves every
 * one of those inactive, so a prompt typed into the dashboard cannot run a
 * shell command or touch the filesystem.
 *
 * Note that pi-web's `withExtensionTools()` also activates any *other* installed
 * extension's tools alongside these. That is upstream behavior, not something
 * this list controls — the guarantee here is specifically about the builtins.
 */
export const ROBIN_TOOL_NAMES = [
  "todo_add",
  "todo_list",
  "todo_complete",
  "calendar_create_event",
  "calendar_list_events",
  "link_add",
  "link_list",
] as const;
