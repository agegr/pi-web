"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  currentWorktreeOf,
  describeProjectChoices,
  projectChoices,
  type NewSessionTarget,
  type ProjectChoice,
  type ProjectWorktreeContext,
  type WorktreeChoice,
} from "@/lib/new-session-context";
import { projectNameOf } from "@/lib/session-tree";
import { ActivitySummary } from "./SessionTree";
import { SidebarMenu, type SidebarMenuAnchor, type SidebarMenuItem } from "./SidebarMenu";
import { BranchIcon, ChevronIcon, FolderIcon, FolderPlusIcon, PlusIcon, TrashIcon } from "./SidebarIcons";
import { WorktreeCreateForm } from "./WorktreeCreateForm";

/** The picker's two controls. A pick names the one it came from. */
export type ProjectWorktreeControl = "project" | "worktree";

/** How a linked checkout's removal went: a checkout with changes waits for a force. */
export type WorktreeRemoval = "removed" | "dirty" | { error: string };

/** What the owner reaches through `handleRef`. */
export interface ProjectWorktreePickerHandle {
  /** The control's button, while it is shown. */
  button(control: ProjectWorktreeControl): HTMLButtonElement | null;
  /** Opens the control's menu below its button (the sessions tab's "Open another project…"). */
  openMenu(control: ProjectWorktreeControl): void;
}

type MenuBody =
  | { kind: "create"; busy: boolean; error: string | null }
  /** A removal that needs an answer: a checkout with changes (force?), or one that failed. */
  | { kind: "remove"; worktree: WorktreeChoice; dirty: boolean; busy: boolean; error: string | null };

interface MenuState {
  /**
   * One per opening, and a new one for the "New worktree…" form: an answer
   * for an older one changes nothing. A removal's question keeps the id of
   * the list it came from.
   */
  id: number;
  kind: ProjectWorktreeControl;
  anchor: SidebarMenuAnchor;
  opener: HTMLElement;
  width: number;
  /** In place of the worktree list (classic: below it, or in the checkout's row). */
  body: MenuBody | null;
  /** A checkout is being removed from the list: the remove buttons wait. */
  removing: boolean;
}

interface Props {
  /**
   * "inline": the bar above a fresh composer, the project's name and the
   * worktree's branch as text on the page (no path, no notes).
   * The files' own: "stacked", full width, one under the other (the files
   * tab); "row", side by side in one row (the files below the sessions).
   * Both have the files' boxes (the whole path, the worktree's notes) and
   * extras: the activity dot, the worktree hint, the menus' minimum width.
   */
  layout: "inline" | "stacked" | "row";
  context: ProjectWorktreeContext;
  mobile: boolean;
  /** The group's accessible name. */
  label: string;
  /** The project button's text while there is no project. */
  placeholder?: string;
  /** Shown as ~ in the boxes' paths. */
  homeDir?: string;
  /** Running and unread counts by project key: badges in the project menu, and a dot in the files' project box for activity elsewhere. */
  projectActivity?: ReadonlyMap<string, { running: number; unread: number }>;
  /** The files' (stacked or row), without a worktree list: a disabled box saying why (a subdirectory of a checkout, still checking). None for a folder outside git: the project box alone. */
  worktreeHint?: { label: string; title: string } | null;
  /** The "New worktree…" form's title. */
  newWorktreeTitle: string;
  handleRef?: Ref<ProjectWorktreePickerHandle>;
  /** A project or checkout other than the one in use was picked, or a checkout was just created. */
  onPick: (target: NewSessionTarget, from: ProjectWorktreeControl) => void;
  onUseDefaultDirectory: () => void;
  /** "Open another project…": the folder picker. Focus goes back to `opener` when nothing moves. */
  onOpenFolder: (opener: HTMLElement | null) => void;
  onRefreshWorktrees: () => void;
  onCreateWorktree: (project: ProjectChoice, branch: string) => Promise<{ path: string } | { error: string }>;
  /** Given, each linked checkout has a remove button (the files tab). */
  onRemoveWorktree?: (project: ProjectChoice, path: string, force: boolean) => Promise<WorktreeRemoval>;
}

/** Narrower than this, a files box's menu keeps this width instead of the box's. */
const STACKED_MENU_MIN_WIDTH = 220;

/** Substitute the home dir prefix with ~ (display only; the boxes cut the path at its left). */
function displayPath(path: string, homeDir?: string): string {
  return homeDir && path.startsWith(homeDir) ? `~${path.slice(homeDir.length)}` : path;
}

function worktreeLabel(worktree: WorktreeChoice): string {
  return worktree.branch ?? projectNameOf(worktree.path);
}

/**
 * A removal's body: the question for a checkout with changes, else what went
 * wrong. Focus starts on a Cancel, so Enter does not discard the checkout's
 * changes: this one on a desktop, the sheet's own on a phone (`focusCancel`).
 */
export function WorktreeRemoveForm({
  heading,
  dirty,
  busy,
  error,
  showCancel,
  onForce,
  onCancel,
}: {
  heading: string | null;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  showCancel: boolean;
  onForce: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sidebar-worktree-form">
      {heading && <div className="sidebar-menu-header">{heading}</div>}
      {dirty && <div className="sidebar-worktree-message">{t("sidebar.forceRemoveCheckout")}</div>}
      {(dirty || showCancel) && (
        <div className="sidebar-worktree-form-buttons">
          {dirty && (
            <button type="button" className="sidebar-worktree-force" disabled={busy} onClick={onForce}>
              {t("sidebar.force")}
            </button>
          )}
          {showCancel && (
            <button type="button" className="sidebar-worktree-cancel" data-sidebar-menu-autofocus="" onClick={onCancel}>
              {t("sidebar.cancel")}
            </button>
          )}
        </div>
      )}
      {error && <div className="sidebar-worktree-error" role="alert">{error}</div>}
    </div>
  );
}

/**
 * A classic worktree menu's question for a checkout with changes, in that
 * checkout's row as on main. Its buttons are the menu's items (arrow keys
 * reach them); Cancel takes focus, so Enter does not discard the changes,
 * and goes back to the list.
 */
function WorktreeConfirmRow({ busy, onForce, onCancel }: { busy: boolean; onForce: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const questionId = useId();
  return (
    <div className="sidebar-worktree-confirm">
      <span id={questionId} className="sidebar-worktree-confirm-text" title={t("sidebar.forceRemoveCheckout")}>
        {t("sidebar.forceRemoveCheckout")}
      </span>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        data-sidebar-menu-item=""
        aria-describedby={questionId}
        aria-disabled={busy ? true : undefined}
        className="sidebar-worktree-force"
        onClick={() => { if (!busy) onForce(); }}
      >
        {t("sidebar.force")}
      </button>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        data-sidebar-menu-item=""
        data-sidebar-menu-autofocus=""
        className="sidebar-worktree-cancel"
        onClick={onCancel}
      >
        {t("sidebar.cancel")}
      </button>
    </div>
  );
}

/**
 * The project and worktree in use, and the two menus that change them: the
 * files' (stacked in the files tab, a row below the sessions) and the bar's
 * above a fresh composer (inline). The
 * owner keeps the cwd; the picker only reports what was chosen. Picking the
 * checkout in use does nothing, and so does picking the project in use while
 * its worktrees are listed: that would move a worktree back to the root.
 * Without the list (a removed checkout, a subdirectory) the project is the way
 * back to its root.
 */
export function ProjectWorktreePicker({
  layout,
  context,
  mobile,
  label,
  placeholder = "",
  homeDir,
  projectActivity,
  worktreeHint = null,
  newWorktreeTitle,
  handleRef,
  onPick,
  onUseDefaultDirectory,
  onOpenFolder,
  onRefreshWorktrees,
  onCreateWorktree,
  onRemoveWorktree,
}: Props) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const menuIdRef = useRef(0);
  const projectRef = useRef<HTMLButtonElement>(null);
  const worktreeRef = useRef<HTMLButtonElement>(null);
  // An answer that arrives after the picker went away (the composer moved,
  // the first message went out) starts nothing: nobody asks for it any more.
  const mountedRef = useRef(false);
  // The newest props for an answer that arrives later.
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  // The files' picker, either way its boxes are laid out.
  const stacked = layout !== "inline";
  const inline = !stacked;
  // The menus on a desktop look as main's dropdowns did: whole paths,
  // "Custom path…", the "New worktree…" form under the list, a dirty
  // checkout's question in its row. A phone keeps the sheet.
  const classic = !mobile;
  const { project, worktrees } = context;
  const current = currentWorktreeOf(context);
  // Inline, the project's name as the menus name it: its display name, else
  // its folder's, with the parent folder only where two projects share it.
  const projectName = inline && project
    ? describeProjectChoices(projectChoices(context)).find(({ choice }) => choice.key === project.key)
    : undefined;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const nextId = () => {
    menuIdRef.current += 1;
    return menuIdRef.current;
  };
  const closeMenu = () => setMenu(null);

  const openMenu = (kind: ProjectWorktreeControl, opener: HTMLElement) => {
    const rect = opener.getBoundingClientRect();
    // At least as wide as its box, as main's dropdowns were.
    const width = Math.max(stacked ? STACKED_MENU_MIN_WIDTH : kind === "project" ? 260 : 240, Math.round(rect.width));
    // In the row the worktree box is the right one, narrower than its menu:
    // the menu grows leftward from its right edge, over the sidebar rather
    // than past it over the chat.
    const align = layout === "row" && kind === "worktree" ? "end" : "start";
    setMenu({
      id: nextId(),
      kind,
      anchor: { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align },
      opener,
      width,
      body: null,
      removing: false,
    });
    // Worktrees come and go outside this page (the CLI, another window).
    if (kind === "worktree") onRefreshWorktrees();
  };
  const openMenuRef = useRef(openMenu);
  openMenuRef.current = openMenu;

  useImperativeHandle(handleRef, () => ({
    button: (control) => (control === "worktree" ? worktreeRef : projectRef).current,
    openMenu: (control) => {
      const button = (control === "worktree" ? worktreeRef : projectRef).current;
      if (button) openMenuRef.current(control, button);
    },
  }), []);

  /** Changes the menu if it is still the one `id` names. */
  const updateMenu = (id: number, change: (state: MenuState) => MenuState | null) => {
    setMenu((state) => (state?.id === id ? change(state) : state));
  };

  // A new body is a new menu: what the list was still waiting for is dropped.
  const showBody = (body: MenuBody | null) => {
    const id = nextId();
    setMenu((state) => (state?.kind === "worktree" ? { ...state, id, body, removing: false } : state));
  };

  const createWorktree = async (branch: string) => {
    const state = menuRef.current;
    if (!state || state.body?.kind !== "create" || !project) return;
    const { id } = state;
    const setForm = (busy: boolean, error: string | null) => {
      updateMenu(id, (menuState) => ({ ...menuState, body: { kind: "create", busy, error } }));
    };
    setForm(true, null);
    let result: { path: string } | { error: string };
    try {
      result = await onCreateWorktree(project, branch);
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    if (!mountedRef.current) return;
    if ("error" in result) {
      setForm(false, result.error);
      return;
    }
    // Closed meanwhile: the worktree exists, and the sidebar lists it, but
    // nobody asked to move there any more.
    if (menuRef.current?.id !== id) return;
    setMenu(null);
    onPickRef.current({ cwd: result.path, projectKey: project.key, projectRoot: project.root }, "worktree");
  };

  const removeWorktree = async (worktree: WorktreeChoice, force: boolean) => {
    const state = menuRef.current;
    if (!state || !project || !onRemoveWorktree) return;
    const { id } = state;
    updateMenu(id, (menuState) => ({
      ...menuState,
      removing: true,
      body: menuState.body?.kind === "remove" ? { ...menuState.body, busy: true, error: null } : menuState.body,
    }));
    let result: WorktreeRemoval;
    try {
      result = await onRemoveWorktree(project, worktree.path, force);
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    if (!mountedRef.current) return;
    updateMenu(id, (menuState) => {
      // Removed: back to the list, which the owner fetches again.
      if (result === "removed") return { ...menuState, removing: false, body: null };
      const dirty = result === "dirty" || (menuState.body?.kind === "remove" && menuState.body.dirty);
      return {
        ...menuState,
        removing: false,
        body: { kind: "remove", worktree, dirty, busy: false, error: result === "dirty" ? null : result.error },
      };
    });
  };

  const projectItems = (): SidebarMenuItem[] => {
    const choices = describeProjectChoices(projectChoices(context)).map(({ choice, name, note }): SidebarMenuItem => {
      const activity = projectActivity?.get(choice.key);
      // A desktop shows the whole path, unless the user named the project:
      // then that name alone, in the same code type; the tooltip keeps the path.
      const wholePath = classic && choice.alias === undefined;
      return {
        type: "item",
        id: `project:${choice.key}`,
        label: wholePath ? displayPath(choice.root, homeDir) : name,
        note: wholePath ? undefined : note ?? undefined,
        mono: classic,
        path: wholePath,
        title: choice.root,
        checked: choice.key === project?.key,
        badge: activity ? <ActivitySummary running={activity.running} unread={activity.unread} t={t} /> : undefined,
        // The owners ignore a pick of the folder already in use.
        onSelect: () => {
          if (choice.key !== project?.key || !worktrees) onPick({ cwd: choice.root, projectKey: choice.key, projectRoot: choice.root }, "project");
        },
      };
    });
    // No project yet (a first run): the two folder items alone, no line above them.
    const separator: SidebarMenuItem[] = choices.length > 0 ? [{ type: "separator", id: "separator" }] : [];
    return [
      ...choices,
      ...separator,
      {
        type: "item",
        id: "default-directory",
        label: t("sidebar.useDefaultDirectory"),
        icon: <FolderIcon size={13} />,
        onSelect: () => onUseDefaultDirectory(),
      },
      {
        type: "item",
        id: "open-folder",
        label: t(classic ? "sidebar.customPath" : "sidebar.openOtherProject"),
        icon: classic ? <PlusIcon size={13} /> : <FolderPlusIcon size={13} />,
        onSelect: () => onOpenFolder(menu?.opener ?? null),
      },
    ];
  };

  const worktreeItems = (): SidebarMenuItem[] => [
    ...(worktrees ?? []).map((worktree): SidebarMenuItem => classic && body?.kind === "remove" && body.dirty && body.worktree.path === worktree.path ? {
      type: "custom",
      id: `worktree:${worktree.path}`,
      content: (
        <WorktreeConfirmRow
          busy={body.busy}
          onForce={() => { void removeWorktree(worktree, true); }}
          onCancel={() => showBody(null)}
        />
      ),
    } : {
      type: "item",
      id: `worktree:${worktree.path}`,
      label: classic ? worktree.branch ?? displayPath(worktree.path, homeDir) : worktreeLabel(worktree),
      mono: classic,
      path: classic,
      note: worktree.isMain ? t("sidebar.main") : undefined,
      title: worktree.path,
      checked: worktree.path === current?.path,
      secondary: onRemoveWorktree && !worktree.isMain ? {
        label: t("sidebar.removeWorktreeTitle", { path: worktree.path }),
        icon: <TrashIcon size={12} />,
        danger: true,
        disabled: menu?.removing,
        onSelect: ({ keepOpen }) => {
          keepOpen();
          void removeWorktree(worktree, false);
        },
      } : undefined,
      onSelect: () => {
        if (project && worktree.path !== current?.path) {
          onPick({ cwd: worktree.path, projectKey: project.key, projectRoot: project.root }, "worktree");
        }
      },
    }),
    // Classic: no line of its own (the rows have theirs), and gone while its form shows below.
    ...(classic ? [] : [{ type: "separator", id: "separator" } as const]),
    ...(classic && body?.kind === "create" ? [] : [{
      type: "item",
      id: "new-worktree",
      label: t("sidebar.newWorktree"),
      icon: <PlusIcon size={13} />,
      onSelect: ({ keepOpen }) => {
        keepOpen();
        showBody({ kind: "create", busy: false, error: null });
      },
    } satisfies SidebarMenuItem]),
  ];

  const body = menu?.kind === "worktree" ? menu.body : null;
  let menuTitle = "";
  let menuItems: SidebarMenuItem[] | undefined;
  // The form or question in place of the list, as one child that is null for
  // a list: the menu would take two side by side (an array) for a body.
  let menuBody: ReactNode = null;
  // Classic: the form, or what went wrong, under the list.
  let menuFooter: ReactNode = null;
  if (classic && menu?.kind === "worktree") {
    menuTitle = t("sidebar.switchWorktree");
    menuItems = worktreeItems();
    if (body?.kind === "create") {
      menuFooter = (
        <WorktreeCreateForm
          heading={null}
          busy={body.busy}
          error={body.error}
          showCancel
          onCreate={(branch) => { void createWorktree(branch); }}
          onCancel={() => showBody(null)}
        />
      );
    } else if (body?.kind === "remove" && body.error) {
      menuFooter = <div className="sidebar-worktree-error" role="alert">{body.error}</div>;
    }
  } else if (body?.kind === "create") {
    menuTitle = newWorktreeTitle;
    menuBody = (
      <WorktreeCreateForm
        heading={mobile ? null : menuTitle}
        busy={body.busy}
        error={body.error}
        showCancel={!mobile}
        onCreate={(branch) => { void createWorktree(branch); }}
        onCancel={closeMenu}
      />
    );
  } else if (body?.kind === "remove") {
    menuTitle = t("sidebar.removeWorktreeHeading", { name: worktreeLabel(body.worktree) });
    menuBody = (
      <WorktreeRemoveForm
        heading={mobile ? null : menuTitle}
        dirty={body.dirty}
        busy={body.busy}
        error={body.error}
        showCancel={!mobile}
        onForce={() => { void removeWorktree(body.worktree, true); }}
        onCancel={closeMenu}
      />
    );
  } else if (menu?.kind === "project") {
    menuTitle = t("workspace.project");
    menuItems = projectItems();
  } else if (menu?.kind === "worktree") {
    menuTitle = t("sidebar.switchWorktree");
    menuItems = worktreeItems();
  }
  const filter = menu?.kind === "project"
    // Main showed the projects' field only past 8 of them, the worktrees' from 8.
    ? { placeholder: t("sidebar.filterProjects"), emptyLabel: t("sidebar.noMatchingProjects"), minChoices: classic ? 9 : undefined }
    : { placeholder: t("sidebar.filterWorktrees"), emptyLabel: t("sidebar.noMatchingWorktrees") };
  // A dot in the files' project box: something runs or waits in another project.
  const otherActivity = stacked && projectActivity !== undefined && [...projectActivity].some(
    ([key, { running, unread }]) => key !== project?.key && (running > 0 || unread > 0),
  );

  return (
    <div className={`project-picker is-${layout}`} role="group" aria-label={label}>
      <button
        ref={projectRef}
        type="button"
        className={project ? "project-picker-button is-project" : "project-picker-button is-project is-empty"}
        title={project?.root ?? ""}
        aria-haspopup="menu"
        aria-expanded={menu?.kind === "project"}
        onClick={(event) => openMenu("project", event.currentTarget)}
      >
        {/* Inline: a folder icon, the name (cut at its end) and a chevron;
            the tooltip is the path. The files': the whole path, cut at its
            left (the folder name at its end is what tells paths apart), no
            icon and no chevron: the path is the box. A project the user
            named shows that name; the tooltip keeps the path. */}
        {inline && <FolderIcon size={12} className="project-picker-icon" />}
        {/* A twin's parent folder is cut before its name, the "/" never. */}
        {inline && project ? (
          <span className="project-picker-name">
            {project.alias === undefined && projectName?.note && <><span className="project-picker-parent">{projectName.note}</span>/</>}
            <span className="project-picker-leaf">{project.alias ?? projectName?.name ?? projectNameOf(project.root)}</span>
          </span>
        ) : project?.alias !== undefined ? (
          <span className="project-picker-label is-alias">{project.alias}</span>
        ) : project ? (
          <span className="project-picker-path"><span>{displayPath(project.root, homeDir)}</span></span>
        ) : (
          <span className="project-picker-label">{placeholder}</span>
        )}
        {otherActivity && (
          <span className="project-picker-activity" role="img" title={t("sidebar.newActivity")} aria-label={t("sidebar.newActivity")} />
        )}
        {inline && <ChevronIcon size={9} className="project-picker-chevron sidebar-icon-down" />}
      </button>
      {worktrees && (
        <button
          ref={worktreeRef}
          type="button"
          className="project-picker-button"
          title={current ? t("sidebar.worktreePath", { path: current.path }) : t("sidebar.switchWorktree")}
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "worktree"}
          onClick={(event) => openMenu("worktree", event.currentTarget)}
        >
          {/* A linked checkout's branch icon in the accent, as the main checkout's is not. */}
          <BranchIcon size={11} className={current && !current.isMain ? "project-picker-icon is-linked" : "project-picker-icon"} />
          <span className="project-picker-path"><span>{current ? current.branch ?? displayPath(current.path, homeDir) : "…"}</span></span>
          {/* Only in the files tab: in the row the box is a share of a
              narrow sidebar and the branch needs the room; inline the
              branch is text on the page. The icon (the accent only for a
              linked checkout) still tells the main one. */}
          {current?.isMain && layout === "stacked" && <span className="project-picker-note">{t("sidebar.main")}</span>}
          {stacked && worktrees.length > 1 && <span className="project-picker-note">{worktrees.length}</span>}
          <ChevronIcon size={9} className="project-picker-chevron sidebar-icon-down" />
        </button>
      )}
      {!worktrees && stacked && worktreeHint && (
        <button type="button" aria-disabled="true" tabIndex={-1} title={worktreeHint.title} className="project-picker-button is-inactive">
          <BranchIcon size={11} className="project-picker-icon" />
          <span className="project-picker-label">{worktreeHint.label}</span>
        </button>
      )}
      <SidebarMenu
        open={menu !== null}
        anchor={menu?.anchor ?? null}
        sheet={mobile}
        ariaLabel={menuTitle}
        title={menuTitle}
        items={menuItems}
        filter={filter}
        cancelLabel={t("sidebar.cancel")}
        focusCancel={body?.kind === "remove"}
        onClose={closeMenu}
        returnFocusTo={menu?.opener ?? null}
        width={menu?.width}
        classic={classic}
        footer={menuFooter}
        focusKey={body ? `${body.kind}:${body.kind === "remove" && body.dirty}` : "list"}
      >
        {menuBody}
      </SidebarMenu>
    </div>
  );
}
