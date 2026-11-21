export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A Node.js system error's `code`, such as `ENOENT`. */
export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
