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
 * OptionSelect 的单个选项。
 */
export interface OptionSelectOption {
  /** 选项值，选择时传给 onChange。 */
  value: string;
  /** 选项显示内容。 */
  label: ReactNode;
  /** 是否禁用该选项；禁用项不可获得焦点也不可被选中。 */
  disabled?: boolean;
}

/**
 * OptionSelect 的受控属性。
 */
export interface OptionSelectProps {
  /** 当前值；不在 options 中时触发器原样显示该值且不伪造选中项。 */
  value: string;
  /** 可选项列表；为空时触发器禁用。 */
  options: readonly OptionSelectOption[];
  /** 选择新值时的回调。 */
  onChange: (value: string) => void;
  /** 触发器与列表面板的无障碍名称。 */
  ariaLabel: string;
  /** 是否禁用整个控件。 */
  disabled?: boolean;
}

/**
 * 渲染项目级通用下拉选择控件，与模型选择、项目路径选择的视觉模式一致。
 *
 * 面板渲染在控件根容器内（不使用 portal），因此不会逃出父级 dialog 的焦点约束；
 * Escape 关闭面板并阻止冒泡，不会误关闭父级设置中心。
 *
 * @param props - 控件属性。
 * @param props.value - 当前值。
 * @param props.options - 可选项列表。
 * @param props.onChange - 选择新值时的回调。
 * @param props.ariaLabel - 触发器与面板的无障碍名称。
 * @param props.disabled - 是否禁用整个控件。
 * @returns 带触发按钮、listbox 面板和勾号选中态的下拉选择控件。
 * @throws 不抛出异常；外部点击、卸载与禁用态均在组件内处理。
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

  // 打开期间监听外部点击、窗口尺寸与滚动；卸载时清理全部监听器。
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

  // 打开后把焦点移入当前选中项或第一个可用项（roving focus）。
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
