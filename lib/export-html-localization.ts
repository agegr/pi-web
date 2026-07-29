import { translateMessage } from "./i18n/format";
import { enLocale } from "./i18n/messages/en";
import { zhCNLocale } from "./i18n/messages/zh-CN";
import type { Locale, TranslationParams } from "./i18n/types";

const exportMessages = {
  en: enLocale.messages,
  "zh-CN": zhCNLocale.messages,
};

/**
 * Resolve an untrusted export locale query parameter to a built-in locale.
 * Exported HTML falls back to English for missing or unsupported values.
 */
export function resolveExportLocale(value: string | null): Locale {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function translateExport(locale: Locale, key: string, params?: TranslationParams): string {
  return translateMessage(locale, key, exportMessages, params);
}

/**
 * Localize the static UI embedded by pi-coding-agent's standalone HTML exporter.
 *
 * The exported document is generated outside Pi Web's React tree, so it cannot
 * call useI18n(). Keep replacements narrowly scoped to exporter-owned UI text:
 * session content, model names, commands, tool descriptions, and tool output
 * must remain untouched.
 */
export function localizeExportHtml(html: string, locale: Locale): string {
  if (locale === "en") return html;

  const t = (key: string, params?: TranslationParams) => translateExport(locale, key, params);
  const replacements: Array<readonly [string, string]> = [
    ['<html lang="en">', `<html lang="${locale}">`],
    ["<title>Session Export</title>", `<title>${t("export.title")}</title>`],
    ['title="Open sidebar"', `title="${t("export.openSidebar")}"`],
    ['placeholder="Search..."', `placeholder="${t("export.search")}"`],
    ['title="Hide settings entries">Default</button>', `title="${t("export.filterDefaultTitle")}">${t("export.filterDefault")}</button>`],
    ['title="Default minus tool results">No-tools</button>', `title="${t("export.filterNoToolsTitle")}">${t("export.filterNoTools")}</button>`],
    ['title="Only user messages">User</button>', `title="${t("export.filterUserTitle")}">${t("export.filterUser")}</button>`],
    ['title="Only labeled entries">Labeled</button>', `title="${t("export.filterLabeledTitle")}">${t("export.filterLabeled")}</button>`],
    ['title="Show everything">All</button>', `title="${t("export.filterAllTitle")}">${t("export.filterAll")}</button>`],
    ['title="Close">✕</button>', `title="${t("export.close")}">✕</button>`],
    ['aria-label="Resize session tree sidebar"', `aria-label="${t("export.resizeSidebar")}"`],
    ["`${filtered.length} / ${flatNodes.length} entries`", `\`${t("export.entries", { visible: "${filtered.length}", total: "${flatNodes.length}" })}\``],
    ['<span class="tree-role-skill">skill:</span>', `<span class="tree-role-skill">${t("export.roleSkill")}：</span>`],
    ['<span class="tree-role-user">user:</span>', `<span class="tree-role-user">${t("export.roleUser")}：</span>`],
    ['<span class="tree-role-assistant">assistant:</span>', `<span class="tree-role-assistant">${t("export.roleAssistant")}：</span>`],
    ['<span class="tree-muted">(aborted)</span>', `<span class="tree-muted">${t("export.abortedParenthetical")}</span>`],
    ['<span class="tree-muted">(no text)</span>', `<span class="tree-muted">${t("export.noText")}</span>`],
    ["[compaction: ${Math.round(entry.tokensBefore/1000)}k tokens]", t("export.compactionTree", { count: "${Math.round(entry.tokensBefore/1000)}" })],
    ["[branch summary]:", t("export.branchSummaryTree")],
    ["[model: ${escapeHtml(entry.modelId)}]", t("export.modelTree", { model: "${escapeHtml(entry.modelId)}" })],
    ["[thinking: ${escapeHtml(entry.thinkingLevel)}]", t("export.thinkingTree", { level: "${escapeHtml(entry.thinkingLevel)}" })],
    ["... (${remaining} more lines, click to expand)", t("export.moreLinesExpand", { count: "${remaining}" })],
    ["... (${remaining} more lines)", t("export.moreLines", { count: "${remaining}" })],
    ["(${lines.length} lines)", t("export.lines", { count: "${lines.length}" })],
    ["[invalid arg]", t("export.invalidArg")],
    ["[invalid content arg - expected string]", t("export.invalidContent")],
    ['title="Copy link to this message"', `title="${t("export.copyLink")}"`],
    ["${escapeHtml(skillBlock.name)} (click to expand)", t("export.clickToExpand", { name: "${escapeHtml(skillBlock.name)}" })],
    ["Thinking ...", t("export.thinking")],
    ['<div class="error-text">Aborted</div>', `<div class="error-text">${t("export.aborted")}</div>`],
    ["Error: ${escapeHtml(msg.errorMessage || 'Unknown error')}", `${t("export.error")}：\${escapeHtml(msg.errorMessage || '${t("export.unknownError")}')}`],
    ["(cancelled)", t("export.cancelled")],
    ["(exit ${msg.exitCode})", t("export.exitCode", { code: "${msg.exitCode}" })],
    ["Switched to model:", `${t("export.switchedModel")}：`],
    ["[compaction]", t("export.compactionLabel")],
    ["Compacted from ${entry.tokensBefore.toLocaleString()} tokens", t("export.compactedFrom", { count: "${entry.tokensBefore.toLocaleString()}" })],
    ['<div class="branch-summary-header">Branch Summary</div>', `<div class="branch-summary-header">${t("export.branchSummary")}</div>`],
    ["`${globalStats.userMessages} user`", `\`${t("export.userMessages", { count: "${globalStats.userMessages}" })}\``],
    ["`${globalStats.assistantMessages} assistant`", `\`${t("export.assistantMessages", { count: "${globalStats.assistantMessages}" })}\``],
    ["`${globalStats.toolResults} tool results`", `\`${t("export.toolResults", { count: "${globalStats.toolResults}" })}\``],
    ["`${globalStats.customMessages} custom`", `\`${t("export.customMessages", { count: "${globalStats.customMessages}" })}\``],
    ["`${globalStats.compactions} compactions`", `\`${t("export.compactions", { count: "${globalStats.compactions}" })}\``],
    ["`${globalStats.branchSummaries} branch summaries`", `\`${t("export.branchSummaries", { count: "${globalStats.branchSummaries}" })}\``],
    ["<h1>Session: ${escapeHtml(header?.id || 'unknown')}</h1>", `<h1>${t("export.session")}：\${escapeHtml(header?.id || '${t("export.unknown")}')}</h1>`],
    ["T toggle thinking · O toggle tools", t("export.helpHint")],
    ['title="Toggle thinking (T)">Toggle thinking</button>', `title="${t("export.toggleThinkingTitle")}">${t("export.toggleThinking")}</button>`],
    ['title="Toggle tools (O)">Toggle tools</button>', `title="${t("export.toggleToolsTitle")}">${t("export.toggleTools")}</button>`],
    ['title="Download session as JSONL"', `title="${t("export.downloadJson")}"`],
    ['<span class="info-label">Date:</span>', `<span class="info-label">${t("export.date")}：</span>`],
    ['<span class="info-label">Models:</span>', `<span class="info-label">${t("export.models")}：</span>`],
    ['<span class="info-label">Messages:</span>', `<span class="info-label">${t("export.messages")}：</span>`],
    ['<span class="info-label">Tool Calls:</span>', `<span class="info-label">${t("export.toolCalls")}：</span>`],
    ['<span class="info-label">Tokens:</span>', `<span class="info-label">${t("export.tokens")}：</span>`],
    ['<span class="info-label">Cost:</span>', `<span class="info-label">${t("export.cost")}：</span>`],
    ["new Date(header.timestamp).toLocaleString() : 'unknown'", `new Date(header.timestamp).toLocaleString('${locale}') : '${t("export.unknown")}'`],
    ["globalStats.models.join(', ') || 'unknown'", `globalStats.models.join(', ') || '${t("export.unknown")}'`],
    ['<div class="system-prompt-header">System Prompt</div>', `<div class="system-prompt-header">${t("export.systemPrompt")}</div>`],
    ['<div class="tools-header">Available Tools</div>', `<div class="tools-header">${t("export.availableTools")}</div>`],
    ['<span class="tool-param-required">required</span>', `<span class="tool-param-required">${t("export.required")}</span>`],
    ['<span class="tool-param-optional">optional</span>', `<span class="tool-param-optional">${t("export.optional")}</span>`],
  ];

  for (const [source, replacement] of replacements) {
    html = html.replaceAll(source, replacement);
  }
  return html;
}
