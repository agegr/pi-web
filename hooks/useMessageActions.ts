import { useEffect, useRef, useState } from "react";

/** A touch screen has no hover, and the one a browser imitates for a tap is not reliable. */
const touchOnly = () => window.matchMedia("(hover: none)").matches;

/**
 * Whether a message shows its actions. With a mouse that follows the hover; on a touch screen a tap
 * on the message shows them and a tap anywhere else, another message included, hides them again.
 */
export function useMessageActions() {
  const [shown, setShown] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shown || !touchOnly()) return;
    const hide = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setShown(false);
    };
    document.addEventListener("click", hide, true);
    return () => document.removeEventListener("click", hide, true);
  }, [shown]);

  return {
    shown,
    reveal: {
      ref: root,
      onMouseEnter: () => {
        if (!touchOnly()) setShown(true);
      },
      onMouseLeave: () => {
        if (!touchOnly()) setShown(false);
      },
      onClick: () => {
        if (touchOnly()) setShown(true);
      },
    },
  };
}
