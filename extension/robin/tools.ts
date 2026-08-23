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
  "todo_update",
  "todo_delete",
  "todo_complete",
  "calendar_create_event",
  "calendar_list_events",
  "link_add",
  "link_list",
  "gmail_list",
  "gmail_get",
  "provider_usage",
  "job_list",
  "job_profile",
  "job_pending",
  "job_score",
  "job_status",
  "job_scan",
] as const;

export const ROBIN_READ_ONLY_TOOL_NAMES = [
  "todo_list",
  "calendar_list_events",
  "job_list",
  "gmail_list",
  "gmail_get",
] as const;

/**
 * The email-review turn's tool set.
 *
 * Reads mail, writes the categorised review, and — for confirmations,
 * appointments, and deadlines — creates the todo or calendar event the user
 * asked to have surfaced. Nothing else: no shell, no filesystem, no links, no
 * job tools. Email is untrusted text, so this turn holds the narrowest set
 * that can still do the job it exists for.
 */
export const ROBIN_MAIL_TOOL_NAMES = [
  "gmail_list",
  "gmail_get",
  "gmail_review",
  "todo_add",
  "todo_list",
  "calendar_create_event",
  "calendar_list_events",
] as const;

/**
 * The scoring turn's tool set — deliberately the narrowest of the four.
 *
 * This is the one turn that feeds the model text an employer wrote. A job
 * description is data, but nothing stops it containing a sentence addressed to
 * whatever reads it, so the turn that reads one holds no tool that could act
 * on such a sentence: no todos, no calendar, no links, no scan. It can read
 * the profile, read the unscored queue, and write a number and a reason back
 * onto a job it was given. An injected instruction has nothing to reach for.
 *
 * Kept last: a test pins this as the final declaration and asserts nothing
 * after it widens the scoring set.
 */
export const ROBIN_SCORING_TOOL_NAMES = [
  "job_profile",
  "job_pending",
  "job_score",
] as const;
