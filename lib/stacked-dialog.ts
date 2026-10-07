/**
 * Escape and focus for dialogs that can open above another one, such as the
 * trust dialog opened from Settings › MCP. Settings closes on an Escape that
 * reaches `document` in the bubble phase unhandled; a dialog above it takes the
 * key in the capture phase on `document`, which runs before every bubble-phase
 * listener on the way (the focused element's, Settings' own, and the
 * window-level Escape that stops a running agent), and stops it there. One
 * Escape therefore closes only the topmost dialog. Client-safe: the target is
 * passed in, so tests can hand over a stand-in for `document`.
 */

type KeyDownListener = (event: KeyboardEvent) => void;

/**
 * An Escape that cancels an input method's composition (a Pinyin candidate,
 * a kana conversion): `isComposing` in Chrome and Firefox, and the IME's
 * keyCode 229 in Safari, which reports the composition's last key with it.
 * The input method keeps such a key.
 */
function cancelsComposition(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** The part of `document` these listeners use. */
export interface EscapeKeyTarget {
  addEventListener(type: "keydown", listener: KeyDownListener, capture: boolean): void;
  removeEventListener(type: "keydown", listener: KeyDownListener, capture: boolean): void;
}

/** The part of `document` a dialog opening above another uses: where focus is now, and its keys. */
export interface StackedDialogDocument extends EscapeKeyTarget {
  readonly activeElement: Element | null;
}

/** Anything focus can move to: an element, or a stand-in for one in tests. */
interface Focusable {
  focus(options?: FocusOptions): void;
}

/**
 * Escape for a dialog shown above another: listened for in the capture phase,
 * marked handled (`preventDefault()`) and stopped there (`stopPropagation()`),
 * so nothing below sees it, including handlers that do not check
 * `defaultPrevented`. An Escape that cancels an IME composition is stopped
 * too, but does not close the dialog. Returns the cleanup.
 */
export function listenForStackedDialogEscape(target: EscapeKeyTarget, onEscape: () => void): () => void {
  const handleKeyDown: KeyDownListener = (event) => {
    if (event.key !== "Escape") return;
    // Nothing below the dialog reacts to it, whatever it is for.
    event.stopPropagation();
    if (cancelsComposition(event)) return;
    event.preventDefault();
    onEscape();
  };
  target.addEventListener("keydown", handleKeyDown, true);
  return () => target.removeEventListener("keydown", handleKeyDown, true);
}

/**
 * Escape for a panel that closes on it (Settings): the bubble phase, and only
 * while nothing nearer handled the key first (`defaultPrevented`), such as a
 * menu or a nested modal inside the panel. An Escape that cancels an IME
 * composition in one of the panel's text boxes is left to the input method,
 * unhandled: closing would throw away what was typed, such as an Add draft.
 * Returns the cleanup.
 */
export function listenForPanelEscape(target: EscapeKeyTarget, onEscape: () => void): () => void {
  const handleKeyDown: KeyDownListener = (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || cancelsComposition(event)) return;
    event.preventDefault();
    onEscape();
  };
  target.addEventListener("keydown", handleKeyDown, false);
  return () => target.removeEventListener("keydown", handleKeyDown, false);
}

/**
 * What a dialog opening above another needs once it is on the page: focus
 * moves into it (the dialog element itself, so a screen reader reads its title
 * and nothing is pressed by a stray Enter), Escape closes it alone, and the
 * returned cleanup stops listening and gives focus back to what had it before
 * the dialog opened, when that is still on the page. An opener that went away
 * meanwhile (the restricted-mode banner of a project the dialog just trusted)
 * is left alone: focusing a detached element does nothing.
 */
export function openStackedDialog(
  doc: StackedDialogDocument,
  dialog: Focusable | null,
  onEscape: () => void,
): () => void {
  const opener = doc.activeElement;
  dialog?.focus({ preventScroll: true });
  const stopListening = listenForStackedDialogEscape(doc, onEscape);
  return () => {
    stopListening();
    if (!opener || !opener.isConnected) return;
    const focusable = opener as Element & Partial<Focusable>;
    if (typeof focusable.focus === "function") focusable.focus({ preventScroll: true });
  };
}

/** A modal panel: something focus can move to that holds other elements. */
interface FocusContainer extends Focusable {
  contains(other: Element | null): boolean;
}

/** An element focus was on before a modal panel opened. */
interface Opener {
  readonly isConnected: boolean;
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
}

/** Whether focusing an element raises a software keyboard: a text field. */
function entersText(element: Opener): boolean {
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = ((element as Opener & { type?: string }).type ?? "text").toLowerCase();
  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
}

/**
 * Focus for a modal panel that opens over the page, such as Settings. Focus
 * moves to the panel itself when it opens, unless something inside it has it
 * already (an `autoFocus` field). An opener left focused behind the modal keeps
 * getting its keys: the chat composer a bare `/mcp` opens Settings from would
 * take Escape as Stop while a run streams, so Settings stayed open, and on a
 * phone its software keyboard stayed up over Settings. Call it from a layout
 * effect, which runs before the panel's sections focus their own search boxes
 * in their effects, so the opener is still the element outside.
 *
 * The cleanup gives focus back to the opener when it is still on the page and
 * focus is still the panel's (inside it, which a layout effect's cleanup sees
 * before the panel leaves the page) or fell to the page; focus the user put
 * elsewhere stays. With `restoreTextEntry: false` (a coarse pointer) a text
 * field is left alone: focusing it would raise the software keyboard again over
 * the chat just returned to.
 */
export function focusModalPanel(
  doc: FocusDocument,
  panel: FocusContainer | null,
  { restoreTextEntry = true }: { restoreTextEntry?: boolean } = {},
): () => void {
  const active = doc.activeElement;
  const inside = Boolean(active && panel && panel.contains(active));
  const opener = active && active !== doc.body && !inside ? active : null;
  if (panel && !inside) panel.focus({ preventScroll: true });
  return () => {
    if (!opener || !opener.isConnected) return;
    if (!restoreTextEntry && entersText(opener)) return;
    const now = doc.activeElement;
    if (now && now !== doc.body && !(panel && panel.contains(now))) return;
    const focusable = opener as Element & Partial<Focusable>;
    if (typeof focusable.focus === "function") focusable.focus({ preventScroll: true });
  };
}

/** The part of `document` `focusIfLost()` reads. */
export interface FocusDocument {
  readonly activeElement: Element | null;
  readonly body: Element | null;
}

/**
 * Moves focus to `target` when the element that had it left the page, so focus
 * fell back to `body` (or nowhere): a control that went away under the
 * keyboard, such as Settings › MCP's Trust… button, which the trust dialog
 * hands focus back to on close and the panel's reload then removes with its
 * notice. Focus anywhere else is where the user put it, and stays. Returns
 * whether it moved focus.
 */
export function focusIfLost(doc: FocusDocument, target: Focusable | null): boolean {
  const active = doc.activeElement;
  if (!target || (active && active !== doc.body)) return false;
  target.focus({ preventScroll: true });
  return true;
}

/** A control a change was started from: whether it is still on the page, and still disabled. */
export interface PressedControl extends Focusable {
  readonly isConnected: boolean;
  readonly disabled?: boolean;
}

/**
 * Focus after a change whose control was disabled while it ran, such as a
 * switch in Settings › MCP: a focused element that becomes disabled loses
 * focus (the HTML focus-fixup rule drops it to `body`), so a keyboard user
 * would land on the page behind the panel. Focus goes back to that control,
 * or to `fallback` when the control left the page or is disabled still (a
 * server just turned off that may not be turned on again); as with
 * `focusIfLost()`, only when focus fell to the page. Nothing moves when no
 * control had focus to begin with (a click that focuses nothing, as in Safari).
 */
export function focusAfterChange(doc: FocusDocument, control: PressedControl | null, fallback: Focusable | null): boolean {
  if (!control) return false;
  return focusIfLost(doc, control.isConnected && !control.disabled ? control : fallback);
}
