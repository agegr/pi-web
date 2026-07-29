export interface SlashQuery {
  query: string;
  start: number;
  inline: boolean;
}

/** 识别输入末尾的斜杠命令；已有正文时仅用于选择 skill。 */
export function findSlashQuery(value: string): SlashQuery | null {
  const match = /(^|\s)\/([^\s/]*)$/.exec(value);
  if (!match) return null;
  const start = match.index + match[1].length;
  return {
    query: match[2].toLowerCase(),
    start,
    inline: value.slice(0, start).trim().length > 0,
  };
}

/** 把行尾选择的 skill 调整到开头，保持 pi 的 /skill:name 参数语义。 */
export function applySlashSelection(value: string, slash: SlashQuery, commandName: string): string {
  if (!slash.inline) return `/${commandName} `;
  const existingText = value.slice(0, slash.start).trim();
  return `/${commandName}${existingText ? ` ${existingText}` : ""} `;
}
