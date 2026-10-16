import { randomUUID } from "node:crypto";
import {
  query,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ChatBlock, ChatEvent } from "../shared/contracts";
// Resumo curto da ferramenta para o cartão de aprovação. Comando e caminho são o que a pessoa
// precisa ver para decidir; o resto do input fica de fora.
export function summarize(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.path === "string") return input.path;
  const text = JSON.stringify(input) ?? "";
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
    .join("\n");
}
interface Pending {
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[];
  resolve: (result: PermissionResult) => void;
}
// Uma conversa do Claude por tarefa. As mensagens entram por uma fila, então o SDK mantém a
// sessão aberta entre um turno e o seguinte.
export class ChatSession {
  private queue: SDKUserMessage[] = [];
  private wake: ((message: SDKUserMessage | null) => void) | null = null;
  private closed = false;
  private running: Query | null = null;
  private pending = new Map<string, Pending>();
  constructor(
    private readonly cwd: string,
    private readonly emit: (event: ChatEvent) => void,
  ) {}
  send(text: string) {
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    };
    this.emit({ type: "user", text });
    if (!this.running) this.start();
    if (this.wake) {
      const resume = this.wake;
      this.wake = null;
      resume(message);
    } else this.queue.push(message);
  }
  decide(id: string, behavior: "allow" | "deny", always: boolean) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    const result: PermissionResult =
      behavior === "allow"
        ? {
            behavior: "allow",
            updatedInput: pending.input,
            ...(always && pending.suggestions.length ? { updatedPermissions: pending.suggestions } : {}),
          }
        : { behavior: "deny", message: "Negado pela pessoa no chat." };
    this.emit({ type: "approval_resolved", id, behavior });
    pending.resolve(result);
  }
  stop() {
    this.closed = true;
    this.wake?.(null);
    for (const id of [...this.pending.keys()]) this.decide(id, "deny", false);
    this.running?.close();
    this.running = null;
  }
  private async *input(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      const next =
        this.queue.shift() ?? (await new Promise<SDKUserMessage | null>((resolve) => (this.wake = resolve)));
      if (!next) return;
      yield next;
    }
  }
  private start() {
    this.running = query({
      prompt: this.input(),
      options: {
        cwd: this.cwd,
        permissionMode: "default",
        canUseTool: (toolName, input, options) => this.approve(toolName, input, options),
      },
    });
    void this.consume(this.running);
  }
  private async consume(stream: Query) {
    this.emit({ type: "status", state: "running" });
    try {
      for await (const message of stream) this.route(message);
    } catch (error) {
      this.emit({ type: "status", state: "error", message: (error as Error).message });
    } finally {
      if (this.running === stream) this.running = null;
    }
  }
  private route(message: SDKMessage) {
    if (message.type === "assistant") {
      const blocks: ChatBlock[] = [];
      for (const part of message.message.content) {
        if (part.type === "text") blocks.push({ kind: "text", text: part.text });
        else if (part.type === "tool_use")
          blocks.push({
            kind: "tool",
            name: part.name,
            summary: summarize(part.name, part.input as Record<string, unknown>),
          });
      }
      if (blocks.length) this.emit({ type: "assistant", blocks });
    } else if (message.type === "user") {
      const content = message.message.content;
      if (!Array.isArray(content)) return;
      for (const part of content) {
        if (part.type === "tool_result")
          this.emit({
            type: "tool_result",
            text: toolResultText(part.content),
            isError: part.is_error === true,
          });
      }
    } else if (message.type === "result") {
      const ok = message.subtype === "success";
      this.emit({
        type: "status",
        state: ok ? "idle" : "error",
        message: ok ? undefined : "A execução terminou com erro.",
      });
    }
  }
  private approve(
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; suggestions?: PermissionUpdate[] },
  ): Promise<PermissionResult> {
    const id = randomUUID();
    const suggestions = options.suggestions ?? [];
    return new Promise<PermissionResult>((resolve) => {
      this.pending.set(id, { input, suggestions, resolve });
      options.signal.addEventListener("abort", () => this.decide(id, "deny", false), { once: true });
      this.emit({
        type: "approval",
        id,
        toolName,
        summary: summarize(toolName, input),
        canAlwaysAllow: suggestions.length > 0,
      });
    });
  }
}
// Conversas por tarefa. A saída vai para o renderer pela função de emissão recebida.
export class ChatManager {
  private sessions = new Map<string, ChatSession>();
  constructor(private readonly emitFor: (taskId: string, event: ChatEvent) => void) {}
  send(taskId: string, cwd: string, text: string) {
    let session = this.sessions.get(taskId);
    if (!session) {
      session = new ChatSession(cwd, (event) => this.emitFor(taskId, event));
      this.sessions.set(taskId, session);
    }
    session.send(text);
  }
  decide(taskId: string, id: string, behavior: "allow" | "deny", always: boolean) {
    this.sessions.get(taskId)?.decide(id, behavior, always);
  }
  stop(taskId: string) {
    this.sessions.get(taskId)?.stop();
    this.sessions.delete(taskId);
  }
  stopAll() {
    for (const taskId of [...this.sessions.keys()]) this.stop(taskId);
  }
}
