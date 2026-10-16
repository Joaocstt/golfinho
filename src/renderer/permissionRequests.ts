import type { Signal, Task } from "../shared/contracts";

export interface PermissionRequest {
  key: string;
  taskId: string;
  source: "Terminal" | "Chat";
  approvalId?: string;
}

// O PTY não expõe aprovações estruturadas. Exige pergunta explícita + escolha de
// confirmação, sem confundir erro de permissão ou mera inatividade com um pedido.
function asksPermission(output: string): boolean {
  const text = output
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "\n");
  const question = /(?:Would you like to (?:run the following command|make the following edits|apply the following changes)|Do you want to (?:proceed|allow[^?\n]*|make this edit[^?\n]*)|Voc[eê] (?:deseja|quer) (?:permitir|executar|prosseguir)[^?\n]*)\?/gi;
  const matches = [...text.matchAll(question)];
  const last = matches.at(-1);
  if (!last) return false;
  const choices = text.slice(last.index! + last[0].length, last.index! + last[0].length + 1800);
  return /(?:^|\n)\s*[›❯>]?\s*\d+[.)]\s*(?:Yes|Sim|Allow|Permitir)\b/i.test(choices);
}

export class PermissionRequests {
  private pending = new Map<string, PermissionRequest>();
  private terminal = new Map<string, { data: string; offset: number }>();
  private chatSequence = new Map<string, number>();
  private tasks: Map<string, Task["status"]> | undefined;
  get items(): PermissionRequest[] { return [...this.pending.values()]; }

  private remove(predicate: (request: PermissionRequest) => boolean): boolean {
    let changed = false;
    for (const [key, request] of this.pending) {
      if (predicate(request)) { this.pending.delete(key); changed = true; }
    }
    return changed;
  }

  receive(signal: Signal): boolean {
    if (signal.kind === "chat") {
      if (signal.seq <= (this.chatSequence.get(signal.taskId) ?? -1)) return false;
      this.chatSequence.set(signal.taskId, signal.seq);
      const event = signal.event;
      if (event.type === "approval") {
        const key = `chat:${signal.taskId}:${event.id}`;
        if (this.pending.has(key)) return false;
        this.pending.set(key, { key, taskId: signal.taskId, source: "Chat", approvalId: event.id });
        return true;
      }
      if (event.type === "approval_resolved")
        return this.pending.delete(`chat:${signal.taskId}:${event.id}`);
      if (event.type === "status" && event.state !== "running")
        return this.remove((request) => request.taskId === signal.taskId && request.source === "Chat");
    }
    if (signal.kind === "terminal") {
      if (this.tasks && !["running", "waiting"].includes(this.tasks.get(signal.taskId) ?? "")) return false;
      const previous = this.terminal.get(signal.taskId) ?? { data: "", offset: signal.offset };
      const skip = Math.max(0, previous.offset - signal.offset);
      if (skip >= signal.data.length) return false;
      // Uma lacuna pode esconder a resposta anterior: não juntar texto de duas telas incompletas.
      const data = ((signal.offset > previous.offset ? "" : previous.data) + signal.data.slice(skip)).slice(-16_384);
      this.terminal.set(signal.taskId, { data, offset: signal.offset + signal.data.length });
      const key = `terminal:${signal.taskId}`;
      if (!this.pending.has(key) && asksPermission(data)) {
        this.pending.set(key, { key, taskId: signal.taskId, source: "Terminal" });
        return true;
      }
    }
    return false;
  }

  answeredTerminal(taskId: string, data: string): boolean {
    if (!/[\r\n\x03\x1b]$/.test(data) || (data.startsWith("\x1b[") && data !== "\x1b")) return false;
    const previous = this.terminal.get(taskId);
    if (previous) previous.data = "";
    return this.pending.delete(`terminal:${taskId}`);
  }

  syncTasks(tasks: Pick<Task, "id" | "status">[]): boolean {
    const existing = new Map(tasks.map((task) => [task.id, task.status]));
    this.tasks = existing;
    for (const id of this.chatSequence.keys()) if (!existing.has(id)) this.chatSequence.delete(id);
    for (const [id] of this.terminal)
      if (!existing.has(id) || !["running", "waiting"].includes(existing.get(id)!)) this.terminal.delete(id);
    return this.remove((request) => !existing.has(request.taskId) ||
      (request.source === "Terminal" && !["running", "waiting"].includes(existing.get(request.taskId)!)));
  }
}
