"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./SearchableSelect.module.css";

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  value: string;
  options: readonly SearchableSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  noResultsLabel?: string;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

export function SearchableSelect({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Select…",
  searchPlaceholder = "Search options…",
  noResultsLabel = "No matching options",
  ariaLabel,
  className,
  style,
}: SearchableSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return options;
    return options.filter((option) => normalize(`${option.label} ${option.value} ${option.searchText ?? ""}`).includes(needle));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = filtered.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : Math.max(0, filtered.findIndex((option) => !option.disabled)));
  }, [filtered, open, value]);

  useEffect(() => {
    if (activeIndex >= filtered.length || filtered[activeIndex]?.disabled) {
      setActiveIndex(Math.max(0, filtered.findIndex((option) => !option.disabled)));
    }
  }, [activeIndex, filtered]);

  const choose = (option: SearchableSelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const moveActive = (direction: 1 | -1) => {
    if (!filtered.length) return;
    let next = activeIndex;
    for (let count = 0; count < filtered.length; count += 1) {
      next = (next + direction + filtered.length) % filtered.length;
      if (!filtered[next].disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const handleListKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) choose(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`${styles.root}${className ? ` ${className}` : ""}`} style={style}>
      <button
        type="button"
        className={styles.trigger}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={selected ? styles.value : styles.placeholder}>{selected?.label ?? (value || placeholder)}</span>
        <svg className={styles.chevron} viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div className={styles.popover}>
          <div className={styles.searchWrap}>
            <svg className={styles.searchIcon} viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.25" />
              <path d="m10.2 10.2 3.1 3.1" />
            </svg>
            <input
              ref={inputRef}
              className={styles.search}
              value={query}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleListKeys}
            />
          </div>
          <div id={listboxId} className={styles.options} role="listbox" aria-label={ariaLabel}>
            {filtered.length ? filtered.map((option, index) => (
              <button
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                key={option.value}
                className={styles.option}
                data-active={index === activeIndex}
                data-selected={option.value === value}
                disabled={option.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span className={styles.optionCopy}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  {option.description && <span className={styles.optionDescription}>{option.description}</span>}
                </span>
                {option.value === value && (
                  <svg className={styles.check} viewBox="0 0 12 12" aria-hidden="true">
                    <path d="m2.3 6.2 2.2 2.2 5.2-5.2" />
                  </svg>
                )}
              </button>
            )) : <div className={styles.empty}>{noResultsLabel}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
