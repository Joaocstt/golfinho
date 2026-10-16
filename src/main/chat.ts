import { randomUUID } from "node:crypto";
import {
  query,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ChatBlock, ChatEvent, ChatHistoryItem, Provider } from "../shared/contracts";
import type { ChatImage } from "./chatImages";
import { CodexChatSession } from "./codexChat";
import { AntigravityChatSession } from "./antigravityChat";
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
// Como retomar uma conversa salva: o id da sessão anterior e o aviso quando o id novo aparece.
export interface ChatOptions {
  resume?: string | null;
  onSession?: (id: string) => void;
}
// Uma conversa do Claude por tarefa. As mensagens entram por uma fila, então o SDK mantém a
// sessão aberta entre um turno e o seguinte.
export class ChatSession {
  private queue: SDKUserMessage[] = [];
  private wake: ((message: SDKUserMessage | null) => void) | null = null;
  private closed = false;
  private running: Query | null = null;
  private pending = new Map<string, Pending>();
  private interrupted = false;
  constructor(
    private readonly cwd: string,
    private readonly emit: (event: ChatEvent) => void,
    private readonly options: ChatOptions = {},
  ) {}
  send(text: string, images: ChatImage[] = []) {
    // Com imagens, a mensagem vira uma lista de blocos: as imagens em base64 e depois o texto.
    const content = images.length
      ? [
          ...images.map((image) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: image.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: image.base64,
            },
          })),
          ...(text ? [{ type: "text" as const, text }] : []),
        ]
      : text;
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    };
    this.emit({ type: "user", text, ...(images.length ? { images: images.map((image) => image.path) } : {}) });
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
  // Para o turno atual sem fechar a conversa: o próximo envio continua na mesma sessão.
  interrupt() {
    if (!this.running) return;
    this.interrupted = true;
    for (const id of [...this.pending.keys()]) this.decide(id, "deny", false);
    void this.running.interrupt().catch(() => undefined);
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
        resume: this.options.resume ?? undefined,
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
    if (message.type === "system" && message.subtype === "init") this.options.onSession?.(message.session_id);
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
      if (this.interrupted) {
        this.interrupted = false;
        this.emit({ type: "status", state: "idle", message: "Interrompido." });
        return;
      }
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
// Conversa de um provedor, vista pelo ChatManager. Claude e Codex implementam a mesma interface.
export interface ChatBackend {
  send(text: string, images?: ChatImage[]): void;
  decide(id: string, behavior: "allow" | "deny", always: boolean): void;
  interrupt(): void;
  stop(): void;
}
export interface ChatTarget {
  provider: Provider;
  cwd: string;
  executable: string;
}
// Onde a conversa fica guardada. O ChatManager não sabe de banco: recebe estas funções.
export interface ChatStorage {
  append(taskId: string, event: ChatEvent): number;
  list(taskId: string): ChatHistoryItem[];
  sessionId(taskId: string): string | null;
  saveSessionId(taskId: string, sessionId: string): void;
}
// Conversas por tarefa. Cada evento é guardado antes de ir para a tela, então a conversa volta
// ao reabrir a tarefa, e a sessão é retomada pelo id guardado.
export class ChatManager {
  private sessions = new Map<string, ChatBackend>();
  constructor(
    private readonly emitFor: (taskId: string, seq: number, event: ChatEvent) => void,
    private readonly storage: ChatStorage,
  ) {}
  private emitter(taskId: string): (event: ChatEvent) => void {
    return (event) => {
      const seq = this.storage.append(taskId, event);
      this.emitFor(taskId, seq, event);
    };
  }
  send(taskId: string, target: ChatTarget, text: string, images: ChatImage[] = []) {
    let session = this.sessions.get(taskId);
    if (!session) {
      const emit = this.emitter(taskId);
      const options: ChatOptions = {
        resume: this.storage.sessionId(taskId),
        onSession: (id) => this.storage.saveSessionId(taskId, id),
      };
      session =
        target.provider === "codex"
          ? new CodexChatSession(target.cwd, target.executable, emit, options)
          : target.provider === "antigravity"
            ? new AntigravityChatSession(target.cwd, target.executable, emit, options)
            : new ChatSession(target.cwd, emit, options);
      this.sessions.set(taskId, session);
    }
    session.send(text, images);
  }
  // Histórico da tarefa. Sem sessão viva, aprovações que ficaram abertas já não podem ser
  // respondidas: o processo que as esperava acabou. Elas são fechadas como negadas.
  history(taskId: string): ChatHistoryItem[] {
    if (this.sessions.has(taskId)) return this.storage.list(taskId);
    const items = this.storage.list(taskId);
    const answered = new Set(items.filter((i) => i.event.type === "approval_resolved").map((i) => (i.event as { id: string }).id));
    const open = items.filter((i) => i.event.type === "approval" && !answered.has((i.event as { id: string }).id));
    const last = [...items].reverse().find((i) => i.event.type === "status");
    const running = last !== undefined && last.event.type === "status" && last.event.state === "running";
    if (!open.length && !running) return items;
    const emit = this.emitter(taskId);
    for (const item of open) emit({ type: "approval_resolved", id: (item.event as { id: string }).id, behavior: "deny" });
    if (running) emit({ type: "status", state: "idle" });
    return this.storage.list(taskId);
  }
  decide(taskId: string, id: string, behavior: "allow" | "deny", always: boolean) {
    this.sessions.get(taskId)?.decide(id, behavior, always);
  }
  interrupt(taskId: string) {
    this.sessions.get(taskId)?.interrupt();
  }
  stop(taskId: string) {
    this.sessions.get(taskId)?.stop();
    this.sessions.delete(taskId);
  }
  stopAll() {
    for (const taskId of [...this.sessions.keys()]) this.stop(taskId);
  }
}
