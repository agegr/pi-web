// scheduler.ts —— 受控并发调度器（M3 / 等价迁移 autoplan runtime/scheduler/worker_pool.go:145-150）
//
// 纯 TS 等价：用 Promise 队列 + 并发上限替代 Go worker pool / goroutine，
// 对应上游「goroutine worker pool → Promise 队列 + p-limit 并发控制」。
// 不依赖外部 p-limit，内部实现，避免引入额外依赖与构建风险。
// 语义：submit 返回 Promise，按提交顺序在并发额度内执行；失败时 rejects 但不影响队列。
export class WorkerPool {
  private readonly queue: Array<() => Promise<void>> = [];
  private active = 0;
  private closed = false;

  constructor(private readonly concurrency = 4) {
    if (concurrency < 1) this.concurrency = 1;
  }

  /** 当前并发额度。 */
  get limit(): number {
    return this.concurrency;
  }

  /** 当前在途任务数。 */
  get running(): number {
    return this.active;
  }

  /** 队列积压长度。 */
  get pending(): number {
    return this.queue.length;
  }

  /** 提交一个任务（返回其结果 Promise）。任务函数抛错时该 Promise rejects。 */
  submit<T>(job: () => Promise<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("WorkerPool 已关闭，拒绝新任务"));
    }
    return new Promise<T>((resolve, reject) => {
      const wrapped = async (): Promise<void> => {
        try {
          resolve(await job());
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      };
      this.queue.push(wrapped);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.active += 1;
      Promise.resolve()
        .then(job)
        .catch(() => {
          /* 错误已在 submit 的 Promise 中传递，此处仅避免未处理拒绝。 */
        })
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }

  /** 排空队列中的待执行任务（已在途任务不受影响）。 */
  drainQueue(): void {
    this.queue.length = 0;
  }

  /** 关闭：拒绝新提交，并清空积压（已运行任务继续直至完成）。 */
  close(): void {
    this.closed = true;
    this.queue.length = 0;
  }
}

/** 便捷工厂。 */
export function createWorkerPool(concurrency = 4): WorkerPool {
  return new WorkerPool(concurrency);
}
