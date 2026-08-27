/** Pure PDF extension dispatch, separate from React for unit testing. */
export function isPdfExt(ext: string): boolean {
  return ext === '.pdf'
}
