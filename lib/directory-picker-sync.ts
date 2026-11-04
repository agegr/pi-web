/** 输入停顿多久后才自动浏览键入的路径，避免每个按键都发起一次请求。 */
export const DIRECTORY_PREVIEW_DELAY_MS = 250;

/** 浏览请求的先后顺序：只有最新一次请求的结果可以落到界面。 */
export interface BrowseLane {
  begin: () => number;
  isCurrent: (sequence: number) => boolean;
}

export function createBrowseLane(): BrowseLane {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      return latest;
    },
    isCurrent(sequence) {
      return sequence === latest;
    },
  };
}

/** 输入框文本能否用于浏览：空白表示用户没有给出路径。 */
export function browsableInputValue(value: string): string {
  return value.trim();
}

/**
 * 列表是否正是这段输入对应的内容。比较的是浏览时用的那段文本原样
 * （`/tmp`、`~/x`、尾斜杠都保留），不是 realpath 之后的结果：
 * macOS 上 `/tmp` 解析成 `/private/tmp`，用解析后的路径比较会让选择永远不可用。
 */
export function inputMatchesBrowsed(value: string, browsedInput: string): boolean {
  const text = browsableInputValue(value);
  return text !== "" && text === browsedInput;
}

export interface DirectorySelectionState {
  currentPath: string;
  input: string;
  browsedInput: string;
  busy?: boolean;
  loading?: boolean;
  previewing?: boolean;
  unresolved?: boolean;
}

/** 列表跟着输入走之后，“选择此文件夹”不再要求先按“转到”，只要列表与输入一致。 */
export function canSelectDirectory(state: DirectorySelectionState): boolean {
  return Boolean(state.currentPath)
    && !state.busy
    && !state.loading
    && !state.previewing
    && !state.unresolved
    && inputMatchesBrowsed(state.input, state.browsedInput);
}

export function isAbortError(cause: unknown): boolean {
  return typeof cause === "object"
    && cause !== null
    && (cause as { name?: unknown }).name === "AbortError";
}
