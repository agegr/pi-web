/** `decodeURIComponent()`, or the text unchanged when it is not valid percent-encoding. */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
