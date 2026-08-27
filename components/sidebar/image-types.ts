/** Image extension dispatch, separate from React for unit testing. */
export const IMAGE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif',
] as readonly string[]

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTENSIONS.includes(ext)
}
