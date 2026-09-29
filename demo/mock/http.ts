/** Small Response helpers shared by the mock API handlers. */

export class MockRequest {
  readonly url: URL;
  readonly method: string;
  readonly path: string;
  readonly segments: string[];

  constructor(url: URL, method: string, private readonly rawBody: BodyInit | null | undefined, readonly signal?: AbortSignal | null) {
    this.url = url;
    this.method = method.toUpperCase();
    this.path = url.pathname;
    this.segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  async json<T = Record<string, unknown>>(): Promise<T> {
    if (typeof this.rawBody === "string") {
      try {
        return JSON.parse(this.rawBody) as T;
      } catch {
        return {} as T;
      }
    }
    return {} as T;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function error(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

export function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }, { once: true });
  });
}
