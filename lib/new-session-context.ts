/**
 * Where a new session starts, and what the bar above a fresh composer offers
 * to change it: the project and, at the top of a git checkout, its worktrees.
 * The sidebar owns the cwd and the project identity; it reports a
 * `NewSessionContext` for its cwd, and every move goes back through it
 * (`SessionSidebarControl`). Pure and client-safe, so the rules are testable
 * without a DOM.
 */

import { projectNameOf } from "./session-tree";

export interface WorktreeChoice {
  path: string;
  branch: string | null;
  isMain: boolean;
}

/** A project by its stable server key and its root (the `RecentProject` shape). */
export interface ProjectChoice {
  key: string;
  root: string;
  /** The display name the user gave it (a group menu's Rename…), shown in place of its path or folder name. */
  alias?: string;
}

/** Where a new session starts: the header "+", a group's "+", the composer's bar. */
export interface NewSessionTarget {
  cwd: string;
  /** The target's project identity, handed to the shell so it adopts that project. */
  projectKey?: string;
  /** Server-resolved root of that identity: installed before the cwd changes. */
  projectRoot?: string;
  /** The composer's bar: the fresh composer's draft and model picks move along. */
  carryComposer?: boolean;
}

/** How the shell starts a new session (`onNewSession`'s last argument). */
export interface NewSessionOptions {
  /** Move the fresh composer's draft and model picks to the new one instead of parking the draft. */
  carryComposer?: boolean;
}

/** What the sidebar reports for its cwd, for the bar above a fresh composer. */
export interface NewSessionContext {
  cwd: string;
  project: ProjectChoice;
  /**
   * The project's checkouts, only at the top of a git checkout (the files
   * tab's switcher rule): a subdirectory keeps its own identity. Else null.
   */
  worktrees: WorktreeChoice[] | null;
  /** The checkout of `cwd`, server-resolved: one of `worktrees` verbatim. */
  currentWorktreePath: string | null;
  /** Every project the sidebar knows, in its group order. */
  projects: readonly ProjectChoice[];
}

/**
 * What a project/worktree picker shows (components/ProjectWorktreePicker.tsx):
 * a context without its cwd, or no project yet (a sidebar with no cwd, whose
 * files tab still offers every project).
 */
export type ProjectWorktreeContext = Omit<NewSessionContext, "cwd" | "project"> & { project: ProjectChoice | null };

/** A move the shell made from the bar, kept until the sidebar reports its cwd. */
export interface NewSessionMove {
  cwd: string;
  project: ProjectChoice;
  /** The branch of a worktree the bar just created at `cwd`, which no report lists yet. */
  branch: string | null;
}

/**
 * The context for the composer's cwd. The sidebar reports after the commit
 * that moved it, so for one render the report can still be the previous
 * cwd's: a sibling worktree keeps the project and its list, any other folder
 * gets a known project of that root (or one of its own) and no worktree list
 * until the sidebar has fetched it. The bar's own `move` names the project
 * at once: a checkout of the reported project the list lacks (a worktree just
 * created) joins that list, so the bar is right from its first frame.
 */
export function contextForCwd(
  context: NewSessionContext | null,
  cwd: string,
  move: NewSessionMove | null = null,
): NewSessionContext {
  if (context?.cwd === cwd) return context;
  if (context?.worktrees?.some((worktree) => worktree.path === cwd)) {
    return { ...context, cwd, currentWorktreePath: cwd };
  }
  const moved = move?.cwd === cwd ? move : null;
  if (moved && context?.worktrees && context.project.key === moved.project.key) {
    return {
      ...context,
      cwd,
      worktrees: [...context.worktrees, { path: cwd, branch: moved.branch, isMain: false }],
      currentWorktreePath: cwd,
    };
  }
  const projects = context?.projects ?? [];
  const project = moved?.project ?? projects.find((choice) => choice.root === cwd) ?? { key: cwd, root: cwd };
  // A move names its project by key and root: its display name is the list's.
  const alias = project.alias ?? projects.find((choice) => choice.key === project.key)?.alias;
  return {
    cwd,
    project: alias === undefined ? project : { ...project, alias },
    worktrees: null,
    currentWorktreePath: null,
    projects,
  };
}

/** A picker's project list: the current project first when the list does not have it (a folder just opened). */
export function projectChoices(context: ProjectWorktreeContext): ProjectChoice[] {
  const current = context.project;
  return !current || context.projects.some((project) => project.key === current.key)
    ? [...context.projects]
    : [current, ...context.projects];
}

/** `choice` as a picker takes it: its key and root, and the display name `names` holds for its key. */
export function withProjectAlias(choice: ProjectChoice, names: Readonly<Record<string, string>> | undefined): ProjectChoice {
  const { key, root } = choice;
  const alias = names && Object.hasOwn(names, key) ? names[key] : undefined;
  return alias === undefined ? { key, root } : { key, root, alias };
}

/** `first` in order, then whatever of `more` it does not list yet (by key), each with its display name from `names`. */
export function mergeProjectChoices(
  first: readonly ProjectChoice[],
  more: readonly ProjectChoice[],
  names?: Readonly<Record<string, string>>,
): ProjectChoice[] {
  const seen = new Set<string>();
  const merged: ProjectChoice[] = [];
  for (const choice of [...first, ...more]) {
    if (seen.has(choice.key)) continue;
    seen.add(choice.key);
    merged.push(withProjectAlias(choice, names));
  }
  return merged;
}

function parentFolderName(root: string): string | null {
  const trimmed = root.replace(/[\\/]+$/, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return separator > 0 ? projectNameOf(trimmed.slice(0, separator)) : null;
}

/**
 * Each choice's folder name, and its parent folder's name as a note only
 * where two choices share a name: a full path would be cut at its tail, the
 * part that tells them apart. A project the user named shows that name alone:
 * the path tooltip tells it apart.
 */
export function describeProjectChoices(choices: readonly ProjectChoice[]): Array<{ choice: ProjectChoice; name: string; note: string | null }> {
  const named = choices.map((choice) => ({ choice, name: choice.alias ?? projectNameOf(choice.root) }));
  const counts = new Map<string, number>();
  for (const { name } of named) counts.set(name, (counts.get(name) ?? 0) + 1);
  return named.map(({ choice, name }) => ({
    choice,
    name,
    note: choice.alias === undefined && (counts.get(name) ?? 0) > 1 ? parentFolderName(choice.root) : null,
  }));
}

/** The checkout a picker shows: `currentWorktreePath`'s, else the main one. */
export function currentWorktreeOf(context: ProjectWorktreeContext): WorktreeChoice | null {
  const worktrees = context.worktrees ?? [];
  return worktrees.find((worktree) => worktree.path === context.currentWorktreePath)
    ?? worktrees.find((worktree) => worktree.isMain)
    ?? null;
}

/**
 * Equal for contexts that show the same: the sidebar rebuilds its context on
 * every session-list refresh and running poll, and reports it only when this
 * changes.
 */
export function newSessionContextKey(context: NewSessionContext | null): string {
  if (!context) return "";
  return JSON.stringify([
    context.cwd,
    context.project.key,
    context.project.root,
    context.project.alias ?? null,
    context.currentWorktreePath,
    context.worktrees?.map((worktree) => [worktree.path, worktree.branch, worktree.isMain]) ?? null,
    context.projects.map((project) => [project.key, project.root, project.alias ?? null]),
  ]);
}
