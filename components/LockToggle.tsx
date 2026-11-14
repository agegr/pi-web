"use client";

import type { ButtonHTMLAttributes } from "react";
import styles from "./LockToggle.module.css";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed" | "children"> & {
  locked: boolean;
  /** The padlock's width and height in px. */
  iconSize?: number;
};

/**
 * A padlock toggle button: open shackle and dim while off, closed and gold
 * while on (`aria-pressed`). The minimap's hover-preview lock and the Agents
 * strip's lock share it; `className` and `style` place and size it.
 */
export function LockToggle({ locked, iconSize = 16, className, ...button }: Props) {
  return (
    <button
      {...button}
      type="button"
      aria-pressed={locked}
      className={className ? `${styles.lock} ${className}` : styles.lock}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="4" y="11" width="16" height="10" rx="2" />
        {locked ? (
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        ) : (
          <path d="M8 11V7a4 4 0 0 1 7.9-.9" />
        )}
      </svg>
    </button>
  );
}
