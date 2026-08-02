// 模块开关与有效文本解析 —— 委托 lib/prompt-modules-state 的持久化状态。
//
// 本模块刻意 @/-free（相对导入 ../prompt-modules-state，后者本身 @/-free），
// 以便纯 node:test 直接 import 与单测。

import type { PromptModule } from "./types";
import { getModuleEnabled, getCompressedOverride } from "../prompt-modules-state";

/** 模块当前是否应参与发送：alwaysOn 恒真；否则取开关状态（可被 override 覆盖）。 */
export function isModuleActive(
  module: PromptModule,
  enabledOverride?: Record<string, boolean>,
): boolean {
  if (module.alwaysOn) return true;
  if (enabledOverride && Object.prototype.hasOwnProperty.call(enabledOverride, module.id)) {
    return enabledOverride[module.id];
  }
  return getModuleEnabled(module.id);
}

/** 取模块当前应发送的文本：压缩覆盖 > 压缩文本 > 原文。 */
export function effectiveText(module: PromptModule): string {
  const override = getCompressedOverride(module.id);
  if (override !== undefined && override !== "") return override;
  return module.compressedText ?? module.text;
}
