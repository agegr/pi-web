import type { ReactNode } from "react";

/**
 * Small stroke icons for the session sidebar: rows, group headers, menus and
 * the files tab. One 24 grid, stroked with `currentColor`, so the parent's
 * color (muted, dim, accent, danger) decides how they look. Decorative by
 * default (`aria-hidden`); pass `label` when the icon is the only thing that
 * says what it means (the running spinner in a row's status slot).
 */
export interface SidebarIconProps {
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
  /** Accessible name; makes the icon an image instead of decoration. */
  label?: string;
}

function SidebarIcon({ size = 13, className, label, strokeWidth = 2, children }: SidebarIconProps & { strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {children}
    </svg>
  );
}

export function PlusIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="M12 5v14M5 12h14" /></SidebarIcon>;
}

/** Horizontal dots: the "⋯" of a row or group. */
export function MoreIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </SidebarIcon>
  );
}

export function ArchiveIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </SidebarIcon>
  );
}

export function RestoreIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </SidebarIcon>
  );
}

export function PinIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M12 17v5" />
      <path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </SidebarIcon>
  );
}

export function PinOffIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M12 17v5" />
      <path d="M15 9.3V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8.5" />
      <path d="m2 2 20 20" />
      <path d="M9 9v1.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h11" />
    </SidebarIcon>
  );
}

/**
 * Points right; a class on it turns it down for an expanded section. Section
 * headers pass `strokeWidth={3}`: at their 12px that is a 1.5px line, as
 * firm as their bold label. Elsewhere (menus, the archive's Back, the
 * pickers) it keeps the stroke of the icons beside it.
 */
export function ChevronIcon({ strokeWidth, ...props }: SidebarIconProps & { strokeWidth?: number }) {
  return <SidebarIcon {...props} strokeWidth={strokeWidth}><path d="m9 6 6 6-6 6" /></SidebarIcon>;
}

export function BranchIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </SidebarIcon>
  );
}

/** Two branches from one stem: a row's "Fork" (BranchIcon stands for a worktree's branch). */
export function ForkIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="12" cy="19" r="2.5" />
      <path d="M6 7.5v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.5" />
      <path d="M12 12v4.5" />
    </SidebarIcon>
  );
}

export function TrashIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </SidebarIcon>
  );
}

export function PencilIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></SidebarIcon>;
}

/** Filled dot: "mark as unread". */
export function DotIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" /></SidebarIcon>;
}

/** Hollow dot: "mark as read". */
export function DotOutlineIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><circle cx="12" cy="12" r="4.5" /></SidebarIcon>;
}

export function CheckIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="M20 6 9 17l-5-5" /></SidebarIcon>;
}

export function CloseIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="M18 6 6 18M6 6l12 12" /></SidebarIcon>;
}

export function FolderIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="M3 8a2 2 0 0 1 2-2h3.4l1.9 1.9H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></SidebarIcon>;
}

export function FolderPlusIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M3 8a2 2 0 0 1 2-2h3.4l1.9 1.9H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </SidebarIcon>
  );
}

export function TerminalIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </SidebarIcon>
  );
}

export function SearchIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </SidebarIcon>
  );
}

export function UploadIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </SidebarIcon>
  );
}

export function RefreshIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </SidebarIcon>
  );
}

/** Git changes: a commit on a line. */
export function ChangesIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6M15 12h6" />
    </SidebarIcon>
  );
}

/** What the file tree lists: the files tab's ignored-files switch. */
export function EyeIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </SidebarIcon>
  );
}

export function MessageIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></SidebarIcon>;
}

/**
 * The running-agent spinner. It turns through the `sidebar-spin` class
 * (app/sidebar-menu.css), which stands still under prefers-reduced-motion.
 */
export function SpinnerIcon({ className, ...props }: SidebarIconProps) {
  return (
    <SidebarIcon {...props} strokeWidth={2.8} className={className ? `sidebar-spin ${className}` : "sidebar-spin"}>
      <path d="M21 12a9 9 0 1 1-3.8-7.4" />
    </SidebarIcon>
  );
}
