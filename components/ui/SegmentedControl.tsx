"use client";

import type { MouseEvent, ReactElement, ReactNode } from "react";

/**
 * A single mutually exclusive SegmentedControl option.
 */
export interface SegmentedControlOption {
  /** Option value passed to onChange when clicked. */
  value: string;
  /** Visible option label. */
  label: ReactNode;
  /** Whether the option is disabled; disabled options do not trigger onChange. */
  disabled?: boolean;
  /** Hover hint, for example to explain why an option is disabled. */
  title?: string;
  /** Extra class appended to the option button for semantic selected-state variants such as danger. */
  className?: string;
}

/**
 * Controlled SegmentedControl props.
 */
export interface SegmentedControlProps {
  /** Current selected value; no selected state is rendered when it matches no option. */
  value: string;
  /** Available options, rendered in array order. */
  options: readonly SegmentedControlOption[];
  /** Callback invoked for a new value; repeated clicks on the current or a disabled value are ignored. */
  onChange: (value: string, event: MouseEvent<HTMLButtonElement>) => void;
  /** Accessible name for the button group. */
  ariaLabel?: string;
}

/**
 * Renders a project-level mutually exclusive button group shared by the settings, model, and skills pages.
 *
 * @param props - Control props.
 * @param props.value - Current selected value.
 * @param props.options - Available options.
 * @param props.onChange - Callback for a new value; the second argument is the native click event for reading coordinates.
 * @param props.ariaLabel - Accessible name for the button group.
 * @returns A native button group using `role="group"` and `aria-pressed`.
 * @throws Does not throw; disabled options and repeated clicks are ignored internally.
 */
export function SegmentedControl({
  value,
  options,
  onChange,
  ariaLabel,
}: SegmentedControlProps): ReactElement {
  return (
    <div className="ui-segmented-control" role="group" aria-label={ariaLabel}>
      {options.map(option => {
        const selected = option.value === value;
        const className = option.className
          ? `ui-segmented-control-option ${option.className}`
          : "ui-segmented-control-option";
        return (
          <button
            key={option.value}
            type="button"
            className={className}
            aria-pressed={selected}
            disabled={option.disabled}
            title={option.title}
            onClick={event => {
              if (option.disabled || selected) return;
              onChange(option.value, event);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
