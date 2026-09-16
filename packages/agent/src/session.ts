// 会话历史。ponytail: 只在内存里，插件一退就没了 —— 要接着上次聊再换磁盘。
export interface Message {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

export class Sessions {
  private readonly store = new Map<string, Message[]>();

  get(id: string): Message[] {
    const existing = this.store.get(id);
    if (existing) return existing;
    const fresh: Message[] = [];
    this.store.set(id, fresh);
    return fresh;
  }

  set(id: string, messages: Message[]): void {
    this.store.set(id, messages);
  }

  reset(id: string): void {
    this.store.delete(id);
  }

  get size(): number {
    return this.store.size;
  }
}