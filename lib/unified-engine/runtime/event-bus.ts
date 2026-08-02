// event-bus.ts —— 融合引擎事件总线（M3 / 等价迁移 autoplan runtime/eventbus/bus.go:62）
//
// 纯 TS 等价：EventEmitter 多播 + outbox 落盘（outbox 为权威事件源，对应上游 SQLite outbox 表）。
// 所有引擎事件（run/guard/terminal/process）统一经此总线分发；订阅者含 SSE 推送与持久化。
// 为「运行态可恢复 + 全链路无丢失」提供基础（Q13 移除 goDataClient 后的统一事件面）。
import { EventEmitter } from "node:events";

export type BusEventKind =
  | "run.created"
  | "run.updated"
  | "stage.changed"
  | "task.updated"
  | "guard"
  | "log"
  | "terminal-output"
  | "terminal-closed"
  | "process-spawn"
  | "process-exit"
  | "guard-status";

export interface BusEvent {
  kind: BusEventKind;
  runId?: string;
  at: string;
  message?: string;
  payload?: unknown;
}

export type BusListener = (e: BusEvent) => void;

/** 可选 outbox 落盘回调（由 storage 层注入）；未注入则仅内存分发。 */
export type OutboxSink = (e: BusEvent) => void;

export class EngineEventBus {
  private readonly emitter = new EventEmitter();
  private outboxSink: OutboxSink | null = null;
  private readonly history: BusEvent[] = [];
  private readonly MAX_HISTORY = 500;

  constructor() {
    // 事件总线可能高频，放宽默认监听器上限避免告警。
    this.emitter.setMaxListeners(0);
  }

  /** 注册 outbox 持久化（落盘为事件权威源）。 */
  setOutboxSink(sink: OutboxSink | null): void {
    this.outboxSink = sink;
  }

  /** 订阅某类事件（kind="*" 订阅全部）。返回取消订阅函数。 */
  on(kind: BusEventKind | "*", listener: BusListener): () => void {
    const handler = (e: BusEvent) => {
      if (kind === "*" || e.kind === kind) listener(e);
    };
    this.emitter.on("evt", handler);
    return () => this.emitter.off("evt", handler);
  }

  /** 发布事件：写入 outbox（若已注册）、追加历史、多播给订阅者。 */
  publish(e: Omit<BusEvent, "at">): void {
    const full: BusEvent = { ...e, at: new Date().toISOString() };
    try {
      this.outboxSink?.(full);
    } catch {
      // outbox 落盘失败不阻断事件分发。
    }
    this.history.push(full);
    if (this.history.length > this.MAX_HISTORY) this.history.shift();
    this.emitter.emit("evt", full);
  }

  /** 最近历史事件（供重连/恢复消费，避免重复全量推送）。 */
  recent(limit = 100): BusEvent[] {
    return this.history.slice(Math.max(0, this.history.length - limit));
  }

  /** 清空历史（测试/重启隔离用）。 */
  clear(): void {
    this.history.length = 0;
  }
}

/** 跨 Next.js 热重载存活的单例。 */
const g = globalThis as unknown as { __piEngineBus?: EngineEventBus };
export function getEngineEventBus(): EngineEventBus {
  if (!g.__piEngineBus) g.__piEngineBus = new EngineEventBus();
  return g.__piEngineBus;
}
