import { diff3Merge } from "node-diff3";

export interface MarkdownConflict {
  key: string;
  local: string;
  external: string;
}

// Preserve whitespace and line endings. The library's default string splitting
// is unsuitable for Markdown (indentation and hard line breaks carry meaning).
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

export function mergeMarkdown(base: string, local: string, external: string, accepted = new Set<string>()) {
  const conflicts: MarkdownConflict[] = [];
  const parts = diff3Merge(lines(local), lines(base), lines(external), { excludeFalseConflicts: true });
  const content = parts.map((part) => {
    if (part.ok) return part.ok.join("");
    const conflict = part.conflict!;
    const local = conflict.a.join("");
    const external = conflict.b.join("");
    const key = JSON.stringify([conflict.oIndex, conflict.o, local, external]);
    if (!accepted.has(key)) conflicts.push({ key, local, external });
    return local;
  }).join("");
  return { content, conflicts, parts };
}

export interface MarkdownDraft { base: string; content: string }
export interface MarkdownSyncState {
  content: string;
  conflicts: MarkdownConflict[];
  error: string | null;
  saving: boolean;
}
export interface MarkdownTransport {
  read(): Promise<string>;
  write(content: string, base: string): Promise<{ content?: string; conflict?: boolean }>;
  persist(draft: MarkdownDraft | null): void;
}

/** File synchronization has no React/editor dependency. One serialized writer
 * owns the baseline; notifications arriving during a write are read afterwards. */
export class MarkdownSync {
  state: MarkdownSyncState;
  private base: string;
  private remote: string;
  private accepted = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private reading = false;
  private reread = false;
  private composing = false;
  private disposed = false;
  private generation = 0;
  private transport: MarkdownTransport;

  constructor(initial: string, transport: MarkdownTransport, draft?: MarkdownDraft | null) {
    this.transport = transport;
    this.base = draft?.base ?? initial;
    this.remote = initial;
    this.state = { content: draft?.content ?? initial, conflicts: [], error: null, saving: false };
    this.reconcile();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = () => this.state;
  get dirty() { return this.state.content !== this.base || this.state.conflicts.length > 0; }

  private publish(patch: Partial<MarkdownSyncState>) {
    this.state = { ...this.state, ...patch };
    this.transport.persist(this.dirty ? { base: this.base, content: this.state.content } : null);
    this.listeners.forEach((listener) => listener());
  }

  edit(content: string) {
    this.generation++;
    this.state = { ...this.state, content, error: null };
    if (this.composing) this.publish({});
    else this.reconcile();
  }

  setComposing(composing: boolean) {
    this.composing = composing;
    if (composing) clearTimeout(this.timer);
    else { this.reconcile(); void this.refresh(); }
  }

  private reconcile() {
    if (this.disposed || this.composing) return;
    const merged = mergeMarkdown(this.base, this.state.content, this.remote, this.accepted);
    if (!merged.conflicts.length) {
      this.base = this.remote;
      this.accepted.clear();
    }
    this.publish({ content: merged.content, conflicts: merged.conflicts });
    clearTimeout(this.timer);
    if (this.dirty && !this.state.conflicts.length && !this.state.error && !this.state.saving) {
      this.timer = setTimeout(() => void this.save(), 500);
    }
  }

  resolve(key: string, choice: "local" | "external") {
    if (choice === "local") this.accepted.add(key);
    else {
      const merged = mergeMarkdown(this.base, this.state.content, this.remote, this.accepted);
      this.state = { ...this.state, content: merged.parts.map((part) => {
        if (part.ok) return part.ok.join("");
        const c = part.conflict!;
        const id = JSON.stringify([c.oIndex, c.o, c.a.join(""), c.b.join("")]);
        return (id === key ? c.b : c.a).join("");
      }).join("") };
    }
    this.generation++;
    this.reconcile();
  }

  async refresh() {
    if (this.disposed) return;
    if (this.reading || this.state.saving || this.composing) { this.reread = true; return; }
    this.reading = true;
    this.reread = false;
    try {
      const remote = await this.transport.read();
      if (!this.disposed) { this.remote = remote; this.reconcile(); }
    } catch (error) {
      if (!this.disposed) this.publish({ error: String(error instanceof Error ? error.message : error) });
    } finally {
      this.reading = false;
      if (this.reread && !this.disposed) void this.refresh();
    }
  }

  async save() {
    clearTimeout(this.timer);
    if (this.disposed || this.composing || this.state.saving || this.state.conflicts.length) return;
    if (this.reading) { this.timer = setTimeout(() => void this.save(), 100); return; }
    if (!this.dirty) { this.publish({ error: null }); return; }
    const content = this.state.content;
    const generation = this.generation;
    this.publish({ saving: true, error: null });
    try {
      const result = await this.transport.write(content, this.base);
      if (this.disposed) return;
      if (result.conflict) {
        if (typeof result.content !== "string") throw new Error("Invalid conflict response");
        this.remote = result.content;
      } else {
        this.base = content;
        this.remote = content;
        // A newer edit remains dirty and is saved by the next pass.
        if (generation === this.generation) this.state = { ...this.state, content };
      }
      this.publish({ saving: false });
      this.reconcile();
    } catch (error) {
      if (!this.disposed) this.publish({ saving: false, error: String(error instanceof Error ? error.message : error) });
    } finally {
      if (this.reread && !this.disposed) void this.refresh();
    }
  }

  retry() { this.publish({ error: null }); void this.refresh().then(() => this.save()); }

  dispose() {
    // Flush a pending debounce on navigation. The version-checked endpoint also
    // protects a reopened editor; this instance ignores late responses below.
    if (this.dirty && !this.state.error) void this.save();
    this.disposed = true;
    clearTimeout(this.timer);
    this.listeners.clear();
    // Persisted drafts cover failed/interrupted writes and navigation while a
    // read, composition or conflict is still pending.
  }
}
