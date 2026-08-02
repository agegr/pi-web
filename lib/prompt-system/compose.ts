// compose 单入口 —— 开关过滤 → 按需选择 → 拼接（优先压缩文本）。
//
// 本模块刻意 @/-free（相对导入 ./registry、./switches、./select、./tokenize），
// 以便纯 node:test 单测覆盖完整管线。LLM 精排经 ./select-llm 在服务侧异步补充。

import type { ComposeOptions, SelectionResult } from "./types";
import { getModules } from "./registry";
import { isModuleActive, effectiveText } from "./switches";
import { selectModules } from "./select";

/** compose 结果：最终拼接的 systemPrompt + 选择明细。 */
export interface ComposeResult {
  prompt: string;
  selection: SelectionResult;
}

/**
 * 根据选项组装最终系统提示词：
 *  1. 取指定来源（或全部）模块；
 *  2. 按开关（alwaysOn 恒真 + 持久化开关 + enabledOverride）过滤为候选；
 *  3. 按需选择（无查询则全量，保语义；有查询则启发式筛选）；
 *  4. 拼接选中模块的「有效文本」（压缩覆盖 > 压缩文本 > 原文），以空行分隔。
 */
export function composeSystemPrompt(opts: ComposeOptions = {}): ComposeResult {
  const all = getModules(opts.source);
  const candidates = all.filter((m) => isModuleActive(m, opts.enabledOverride));
  const selection = selectModules(candidates, {
    userInput: opts.userInput,
    context: opts.context,
    tags: opts.tags,
  });
  const prompt = selection.selected
    .map((m) => effectiveText(m))
    .filter((t) => t && t.length > 0)
    .join("\n\n");
  return { prompt, selection };
}
