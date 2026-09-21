export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const previousFocus = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  try {
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    // A native modal makes the rest of the document inert; keep the temporary
    // selection inside that modal so insecure-context fallback can still copy.
    (previousFocus?.closest("dialog[open]") ?? document.body).appendChild(ta);
    ta.select();
    if (!document.execCommand("copy")) throw new Error("Browser denied clipboard access");
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  } finally {
    ta.remove();
    previousFocus?.focus();
  }
}
