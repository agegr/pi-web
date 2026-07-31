export const LONG_USER_MESSAGE_CHAR_LIMIT = 8_000;
export const LONG_USER_MESSAGE_LINE_LIMIT = 120;

export interface LongUserMessageStats {
  characters: number;
  lines: number;
  compact: boolean;
}

/** 只遍历一次正文，避免为统计行数创建完整字符串数组。 */
export function getLongUserMessageStats(content: string): LongUserMessageStats {
  let lines = 1;
  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) === 10) lines++;
  }
  return {
    characters: content.length,
    lines,
    compact: content.length > LONG_USER_MESSAGE_CHAR_LIMIT || lines > LONG_USER_MESSAGE_LINE_LIMIT,
  };
}
