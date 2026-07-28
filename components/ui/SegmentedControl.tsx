"use client";

import type { MouseEvent, ReactElement, ReactNode } from "react";

/**
 * SegmentedControl 的单个互斥选项。
 */
export interface SegmentedControlOption {
  /** 选项值，点击时传给 onChange。 */
  value: string;
  /** 选项显示内容。 */
  label: ReactNode;
  /** 是否禁用该选项；禁用后不触发 onChange。 */
  disabled?: boolean;
  /** 悬停提示，用于说明禁用原因等。 */
  title?: string;
  /** 追加到选项按钮上的额外 class，用于选中态语义变体（如 danger）。 */
  className?: string;
}

/**
 * SegmentedControl 的受控属性。
 */
export interface SegmentedControlProps {
  /** 当前选中值；不匹配任何选项时不渲染选中态。 */
  value: string;
  /** 可选项列表，按数组顺序渲染。 */
  options: readonly SegmentedControlOption[];
  /** 选择新值时的回调；重复点击当前值或禁用项不触发。 */
  onChange: (value: string, event: MouseEvent<HTMLButtonElement>) => void;
  /** 按钮组的无障碍名称。 */
  ariaLabel?: string;
}

/**
 * 渲染项目级互斥按钮组，统一设置中心、模型页和技能页的 segmented button group。
 *
 * @param props - 控件属性。
 * @param props.value - 当前选中值。
 * @param props.options - 可选项列表。
 * @param props.onChange - 选择新值时的回调，第二个参数为原始点击事件（供调用方取坐标）。
 * @param props.ariaLabel - 按钮组的无障碍名称。
 * @returns 使用 `role="group"` 与 `aria-pressed` 的原生按钮组。
 * @throws 不抛出异常；禁用与重复点击在组件内被忽略。
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
