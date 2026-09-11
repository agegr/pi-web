export type SubagentQueueState = "queued" | "running";

interface QueueItem<T> {
  run: () => Promise<T>;
  onState: (state: SubagentQueueState) => void;
  onCancel?: () => void | Promise<void>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  state: SubagentQueueState;
  cancelled: boolean;
}

type ParentQueue<T> = {
  limit: number;
  active: number;
  items: QueueItem<T>[];
};

export interface EnqueuedSubagent<T> {
  promise: Promise<T>;
  cancel(): boolean;
}

/** FIFO per parent session; separate parents do not block one another. */
export class SubagentQueue<T> {
  private readonly parents = new Map<string, ParentQueue<T>>();

  enqueue(
    parentId: string,
    limit: number,
    run: () => Promise<T>,
    onState: (state: SubagentQueueState) => void,
    onCancel?: () => void,
  ): EnqueuedSubagent<T> {
    const parent = this.parents.get(parentId) ?? { limit: 1, active: 0, items: [] };
    parent.limit = Math.max(1, Math.floor(limit) || 1);
    let item!: QueueItem<T>;
    const promise = new Promise<T>((resolve, reject) => {
      item = { run, onState, onCancel, resolve, reject, state: "queued", cancelled: false };
    });
    parent.items.push(item);
    this.parents.set(parentId, parent);
    onState("queued");
    this.pump(parentId, parent);
    return {
      promise,
      cancel: () => {
        if (item.state !== "queued" || item.cancelled) return false;
        item.cancelled = true;
        Promise.resolve(item.onCancel?.()).then(
          () => item.resolve(undefined as T),
          (error) => item.reject(error),
        );
        this.pump(parentId, parent);
        return true;
      },
    };
  }

  private pump(parentId: string, parent: ParentQueue<T>): void {
    while (parent.active < parent.limit && parent.items.length > 0) {
      const item = parent.items.shift()!;
      if (item.cancelled) continue;
      item.state = "running";
      item.onState("running");
      parent.active += 1;
      void item.run().then(item.resolve, item.reject).finally(() => {
        parent.active -= 1;
        this.pump(parentId, parent);
        if (parent.active === 0 && parent.items.length === 0) this.parents.delete(parentId);
      });
    }
  }
}
