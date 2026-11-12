export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  let ta: HTMLTextAreaElement | null = null;
  try {
    ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    // `execCommand` answers whether the copy happened: a page that is not a
    // secure context has no `navigator.clipboard`, and the browser can still
    // refuse here (Chrome once the click's user activation is over 5 s old).
    // Ignoring the answer let a caller's "Copied" claim a copy that never happened.
    return document.execCommand("copy") ? Promise.resolve() : Promise.reject(new Error("Copy was refused"));
  } catch (error) {
    return Promise.reject(error);
  } finally {
    ta?.remove();
  }
}
