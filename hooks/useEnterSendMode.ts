import { createStoredChoice } from "./useStoredChoice";

export type EnterSendMode = "enter" | "ctrlEnter";

export const ENTER_SEND_MODE_STORAGE_KEY = "pi-enter-send-mode";
export const ENTER_SEND_MODE_DEFAULT: EnterSendMode = "enter";

const mode = createStoredChoice<EnterSendMode>(
  ENTER_SEND_MODE_STORAGE_KEY,
  (raw) => (raw === "ctrlEnter" ? "ctrlEnter" : ENTER_SEND_MODE_DEFAULT),
  ENTER_SEND_MODE_DEFAULT,
);

export function setEnterSendMode(next: EnterSendMode): void {
  mode.set(next);
}

export function useEnterSendMode(): EnterSendMode {
  return mode.use();
}
