export const DEFAULT_CUSTOM_UI_COLUMNS = 92;
export const DEFAULT_CUSTOM_UI_ROWS = 40;

export interface HeadlessCustomUiTerminal {
  readonly columns: number;
  readonly rows: number;
  readonly kittyProtocolActive: false;
}

export interface HeadlessCustomUiTui {
  readonly terminal: HeadlessCustomUiTerminal;
  requestRender(force?: boolean): void;
}

export function createHeadlessCustomUiTui(
  requestRender: (force?: boolean) => void,
  columns = DEFAULT_CUSTOM_UI_COLUMNS,
  rows = DEFAULT_CUSTOM_UI_ROWS,
): HeadlessCustomUiTui {
  const terminal = Object.freeze({
    columns,
    rows,
    kittyProtocolActive: false as const,
  });

  return Object.freeze({ terminal, requestRender });
}
