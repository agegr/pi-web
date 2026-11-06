export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    // `execCommand` answers whether the copy happened: a page that is not a
    // secure context has no `navigator.clipboard` at all, and the browser can
    // still refuse here (no user activation, a locked-down platform). Ignoring
    // the answer reported success for a copy that never left the page, so a
    // caller's "Copied" would lie. A returned refusal removes the textarea
    // before rejecting; cleanup after a thrown exception is a separate issue.
    const copied = document.execCommand("copy");
    document.body.removeChild(ta);
    return copied ? Promise.resolve() : Promise.reject(new Error("Copy was refused"));
  } catch (error) {
    return Promise.reject(error);
  }
}
