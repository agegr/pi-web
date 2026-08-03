/**
 * Todo 任务共享类型。
 *
 * 数据来源：上游插件 @juicesharp/rpiv-todo 的 tool-result details。
 * 由 /api/task-list 从 session .jsonl 读取后返回。pi-web 只读展示，不构造。
 *
 * 此前 InspectorPanel / TodoPanel / TodoBadge / TodoSidebar 各自定义了一份
 * TodoTask 接口（四份重复），收敛到此统一。
 */

export interface TodoTask {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  blockedBy?: number[];
  owner?: string;
}

/** GET /api/task-list?sessionId=... 的响应。entryIds 供点击跳转（taskId→消息 entryId）。 */
export interface TodoListResponse {
  tasks: TodoTask[];
  nextId?: number;
  entryIds?: Record<number, string>;
}
