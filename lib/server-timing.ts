const SERVER_TIMING_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

type Now = () => number;

/** Request-local timing collector for non-sensitive Server-Timing metrics. */
export class ServerTiming {
  private readonly startedAt: number;
  private readonly durations = new Map<string, number>();

  constructor(private readonly now: Now = () => performance.now()) {
    this.startedAt = now();
  }

  record(name: string, durationMs: number): void {
    // Metric names are the only strings exposed in the response header. Ignore
    // invalid names so paths, messages, or other dynamic values cannot leak.
    if (!SERVER_TIMING_NAME.test(name) || !Number.isFinite(durationMs) || durationMs < 0) return;
    this.durations.set(name, (this.durations.get(name) ?? 0) + durationMs);
  }

  timeSync<T>(name: string, operation: () => T): T {
    const startedAt = this.now();
    try {
      return operation();
    } finally {
      this.record(name, this.now() - startedAt);
    }
  }

  async time<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = this.now();
    try {
      return await operation();
    } finally {
      this.record(name, this.now() - startedAt);
    }
  }

  finish<T extends Response>(response: T): T {
    this.record("total", this.now() - this.startedAt);
    const value = [...this.durations]
      .map(([name, durationMs]) => `${name};dur=${durationMs.toFixed(1)}`)
      .join(", ");
    if (value) {
      const existing = response.headers.get("Server-Timing");
      response.headers.set("Server-Timing", existing ? `${existing}, ${value}` : value);
    }
    return response;
  }
}

export function createServerTiming(now?: Now): ServerTiming {
  return new ServerTiming(now);
}
