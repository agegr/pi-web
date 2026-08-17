/**
 * The tools the dashboard assistant is allowed to use.
 *
 * This list is the security boundary for the assistant session. pi-web starts
 * agent sessions with the coding builtins (bash, read, edit, write, …)
 * available; naming only these here means `setActiveToolsByName` leaves every
 * one of those inactive, so a prompt typed into the dashboard cannot run a
 * shell command or touch the filesystem.
 *
 * The assistant route requests exact tool activation, so tools from other
 * installed extensions are not added to this list implicitly.
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

export const ROBIN_READ_ONLY_TOOL_NAMES = [
  "todo_list",
  "calendar_list_events",
] as const;
