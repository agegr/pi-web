/** Width of an extension dialog before its content asks for more (#947). */
export const EXTENSION_DIALOG_BASE_WIDTH = 560;

/** A block scrolling by a pixel or less is sub-pixel rounding, not content that is cut off. */
const OVERFLOW_TOLERANCE_PX = 1;
/** Round up so a late reflow does not creep the dialog wider a few pixels at a time. */
const WIDTH_STEP_PX = 40;

/**
 * Width (px) an extension dialog needs so that none of its code blocks or tables scrolls
 * sideways, or null when none does.
 *
 * `overflows` is each block's `scrollWidth - clientWidth`. A block fills the dialog's
 * inner width, so the dialog has to grow by exactly the widest overflow. Prose wraps
 * and never shows up here, which keeps ordinary dialogs at their default width. The
 * result may exceed what the screen can show; the dialog is capped to its container.
 */
export function fitExtensionDialogWidth(dialogWidth: number, overflows: readonly number[]): number | null {
  let widest = 0;
  for (const overflow of overflows) {
    if (overflow > OVERFLOW_TOLERANCE_PX && overflow > widest) widest = overflow;
  }
  if (widest === 0) return null;
  return Math.ceil((dialogWidth + widest) / WIDTH_STEP_PX) * WIDTH_STEP_PX;
}
