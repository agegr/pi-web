// 离线规则压缩 —— 确定性、零 API 成本、可单测。
//
// 本模块刻意 @/-free（仅相对导入 ./types），以便纯 node:test 直接 import。
// LLM 压缩在 compress-llm.ts（依赖 SDK，服务侧使用）。
//
// 压缩策略（保守，保证语义不变）：
//  1. 行级：去尾空白、折叠连续空行、按「去空白后小写」去重（保留首次出现与顺序）。
//  2. 句级：按中英文句末标点切分，去重完全相同的句子（去空白后比较）。
//  3. 折叠多余空格、去掉首尾空行。
// 不删除任何约束性关键词，只消除冗余/重复表述。

import type { CompressResult } from "./types";

/** 行级去重 + 折叠空行 + 裁掉首尾空行。 */
function dedupeLines(text: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  let blankRun = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, "");
    if (line === "") {
      blankRun++;
      if (blankRun <= 1) out.push("");
      continue;
    }
    blankRun = 0;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** 句级去重（按中英文句末标点切分，去空白后比较完全相同则去重）。 */
function dedupeSentences(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const parts = line.split(/(?<=[。！？.!?])/);
      const seen = new Set<string>();
      const kept: string[] = [];
      for (const p of parts) {
        const t = p.trim();
        if (t === "") {
          kept.push(p);
          continue;
        }
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        kept.push(p);
      }
      return kept.join("");
    })
    .join("\n");
}

/** 离线压缩一段提示词文本，返回压缩结果与比率。 */
export function compressOffline(text: string): CompressResult {
  const before = text.length;
  const lines = dedupeLines(text);
  const sentences = dedupeSentences(lines);
  const collapsed = sentences
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  const after = collapsed.length;
  return {
    text: collapsed,
    charsBefore: before,
    charsAfter: after,
    ratio: before > 0 ? (before - after) / before : 0,
    usedLlm: false,
  };
}
