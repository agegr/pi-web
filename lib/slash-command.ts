export interface SlashQuery {
  query: string;
  start: number;
  inline: boolean;
}

/** 识别输入末尾的斜杠命令；已有正文时仅用于选择 skill。 */
export function findSlashQuery(value: string): SlashQuery | null {
  let queryStart = value.length;
  while (queryStart > 0 && !/[/\s]/.test(value[queryStart - 1])) queryStart--;
  if (queryStart === 0 || value[queryStart - 1] !== "/") return null;

  let start = queryStart - 1;
  while (start > 0 && value[start - 1] === "/") start--;

  let tokenStart = start;
  while (tokenStart > 0 && !/\s/.test(value[tokenStart - 1])) tokenStart--;
  if (value.slice(tokenStart, start).includes("/")) return null;

  let inline = start > 0;
  if (inline) {
    let previous = start - 1;
    while (previous >= 0 && /\s/.test(value[previous])) previous--;
    inline = previous >= 0;
  }
  return {
    query: value.slice(queryStart).toLowerCase(),
    start,
    inline,
  };
}

/** 把行尾选择的 skill 调整到开头，保持 pi 的 /skill:name 参数语义。 */
export function applySlashSelection(value: string, slash: SlashQuery, commandName: string): string {
  if (!slash.inline) return `/${commandName} `;
  const beforeSelection = value.slice(0, slash.start);
  const existingSkills = [...beforeSelection.matchAll(/(?:^|\s)(\/skill:[^\s]+)/g)].map((match) => match[1]);
  const selectedSkill = `/${commandName}`;
  const skills = existingSkills.includes(selectedSkill)
    ? existingSkills
    : [...existingSkills, selectedSkill];
  const existingText = beforeSelection.replace(/(?:^|\s)\/skill:[^\s]+/g, " ").trim();
  return `${skills.join(" ")}${existingText ? ` ${existingText}` : ""} `;
}
