export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage?: string;
}

export interface ParsedSkillMessage {
  skills: ParsedSkillBlock[];
  userMessage?: string;
}

/** 解析一个或多个连续展开的 skill，以及它们共享的附加用户输入。 */
export function parseSkillMessage(text: string): ParsedSkillMessage | null {
  const skills: ParsedSkillBlock[] = [];
  let remaining = text;
  const blockPattern = /^<skill name="([^"]+)" location="([^"]+)">\r?\n([\s\S]*?)\r?\n<\/skill>(?:\r?\n\r?\n|$)/;

  while (remaining.startsWith("<skill ")) {
    const match = remaining.match(blockPattern);
    if (!match) return null;
    skills.push({ name: match[1], location: match[2], content: match[3] });
    remaining = remaining.slice(match[0].length);
  }

  if (skills.length === 0) return null;
  const userMessage = remaining.trim() || undefined;
  return { skills, userMessage };
}

/** 解析 pi 展开 /skill:name 后写入会话的用户消息。 */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const message = parseSkillMessage(text);
  if (!message || message.skills.length !== 1) return null;
  return {
    ...message.skills[0],
    userMessage: message.userMessage,
  };
}
