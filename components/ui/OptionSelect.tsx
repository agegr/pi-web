"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * A single OptionSelect option.
 */
export interface OptionSelectOption {
  /** Option value passed to onChange when selected. */
  value: string;
  /** Visible option label. */
  label: ReactNode;
  /** Whether the option is disabled; disabled options cannot receive focus or be selected. */
  disabled?: boolean;
}

/**
 * Controlled OptionSelect props.
 */
export interface OptionSelectProps {
  /** Current value; values absent from options are displayed as-is without a fabricated selection. */
  value: string;
  /** Available options; the trigger is disabled when empty. */
  options: readonly OptionSelectOption[];
  /** Callback invoked when a new value is selected. */
  onChange: (value: string) => void;
  /** Accessible name for the trigger and listbox panel. */
  ariaLabel: string;
  /** Whether the entire control is disabled. */
  disabled?: boolean;
}

/**
 * Renders a project-wide dropdown control matching the visual pattern used for model and project-path selection.
 *
 * The panel renders inside the control root (without a portal), so it stays within the parent dialog's focus trap;
 * Escape closes the panel and stops propagation without accidentally closing the parent settings center.
 *
 * @param props - Control props.
 * @param props.value - Current value.
 * @param props.options - Available options.
 * @param props.onChange - Callback invoked when a new value is selected.
 * @param props.ariaLabel - Accessible name for the trigger and panel.
 * @param props.disabled - Whether the entire control is disabled.
 * @returns A dropdown control with a trigger button, listbox panel, and checkmark selection state.
 * @throws Does not throw; outside clicks, unmounting, and disabled state are handled internally.
 */
export function OptionSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: OptionSelectProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [panelPlacement, setPanelPlacement] = useState({
    placement: "bottom" as "bottom" | "top",
    maxWidth: 0,
    offsetX: 0,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedOption = options.find(option => option.value === value);
  const hasEnabledOption = options.some(option => !option.disabled);
  const unusable = disabled || options.length === 0 || !hasEnabledOption;
  const isOpen = open && !unusable;

  const updatePlacement = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const safeInset = 8;
    const viewportWidth = window.innerWidth;
    const offsetX = Math.max(safeInset - rect.left, 0);
    const availableWidth = Math.max(0, viewportWidth - safeInset - (rect.left + offsetX));
    setPanelPlacement({
      placement: spaceBelow < 200 && spaceAbove > spaceBelow ? "top" : "bottom",
      maxWidth: availableWidth,
      offsetX,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Listen for outside clicks, window resize, and scrolling while open; clean up on unmount.
  useEffect(() => {
    if (!isOpen) return;
    updatePlacement();
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [isOpen, updatePlacement]);

  useEffect(() => {
    if (unusable) setOpen(false);
  }, [unusable]);

  // Move focus to the selected option or first enabled option after opening (roving focus).
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const target =
      panel.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not([disabled])')
      ?? panel.querySelector<HTMLButtonElement>('[role="option"]:not([disabled])');
    target?.focus();
  }, [isOpen]);

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (unusable) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      updatePlacement();
      setOpen(true);
    }
  };

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])') ?? [],
    );
    if (items.length === 0) return;
    const currentIndex = items.findIndex(item => item === document.activeElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  };

  return (
    <div className="ui-option-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ui-option-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        disabled={unusable}
        onClick={() => {
          if (unusable) return;
          if (isOpen) {
            setOpen(false);
            return;
          }
          updatePlacement();
          setOpen(true);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="ui-option-select-value">{selectedOption ? selectedOption.label : value}</span>
        <svg className="ui-option-select-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isOpen && (
        <div
          ref={panelRef}
          id={listboxId}
          className="ui-option-select-panel"
          data-placement={panelPlacement.placement}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={handlePanelKeyDown}
          style={{
            width: `${Math.min(rootRef.current?.getBoundingClientRect().width ?? 0, panelPlacement.maxWidth)}px`,
            maxWidth: `${panelPlacement.maxWidth}px`,
            transform: `translateX(${panelPlacement.offsetX}px)`,
          }}
        >
          {options.map(option => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className="ui-option-select-option"
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
              >
                <svg className="ui-option-select-check" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 6.5L5 9.5L10 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
