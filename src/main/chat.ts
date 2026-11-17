import { randomUUID } from "node:crypto";
import {
  query,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ChatBlock,
  ChatEffort,
  ChatEvent,
  ChatHistoryItem,
  ChatModelOption,
  ChatPermissionMode,
  Provider,
} from "../shared/contracts";
import type { ChatImage } from "./chatImages";
import { CodexChatSession } from "./codexChat";
import { AntigravityChatSession } from "./antigravityChat";
import { withHandoff } from "./handoff";
import { MEMORY_SERVER, type McpEndpoint } from "./memory";
import { spawn } from "node:child_process";
import { wslChild, wslTarget } from "./wsl";
import { sdkExecutableOption } from "./sdkBinary";
// Resumo curto da ferramenta para o cartão de aprovação. Comando e caminho são o que a pessoa
// precisa ver para decidir; o resto do input fica de fora.
export function summarize(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.command === "string") return input.command;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.path === "string") return input.path;
  const text = JSON.stringify(input) ?? "";
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
// Projeto no WSL: o SDK fala com o `claude` instalado na distro, rodando lá dentro.
// Só atravessam as variáveis que o SDK definiu ou mudou para a CLI.
export function wslSpawn(cwd: string, executable?: string) {
  const where = wslTarget(cwd);
  if (!where) return {};
  const command = executable || "claude";
  return {
    spawnClaudeCodeProcess: (o: { args: string[]; env: NodeJS.ProcessEnv; signal?: AbortSignal }) => {
      const keys = Object.keys(o.env).filter((k) => o.env[k] !== undefined && o.env[k] !== process.env[k]);
      const child = wslChild(where, command, o.args, o.env, keys);
      return spawn(child.file, child.args, { ...child.options, stdio: ["pipe", "pipe", "pipe"], signal: o.signal });
    },
  };
}
// Entrada da ferramenta guardada no histórico para o cartão. Textos longos são cortados: o
// cartão mostra o começo, e o histórico não cresce com arquivos inteiros.
const INPUT_TEXT_LIMIT = 4000;
export function toolInput(input: Record<string, unknown>): Record<string, unknown> {
  const trim = (value: unknown): unknown => {
    if (typeof value === "string") return value.length > INPUT_TEXT_LIMIT ? `${value.slice(0, INPUT_TEXT_LIMIT)}…` : value;
    if (Array.isArray(value)) return value.slice(0, 100).map(trim);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, trim(v)]));
    return value;
  };
  return trim(input) as Record<string, unknown>;
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
  model?: string | null;
  /** Modo de permissão do Claude; ausente = "default". */
  permissionMode?: ChatPermissionMode | null;
  /** Esforço do Claude; ausente = padrão do modelo. */
  effort?: ChatEffort | null;
  onSession?: (id: string) => void;
  // Servidor MCP da memória do projeto; null quando a memória está desligada ou indisponível.
  mcp?: McpEndpoint | null;
  /** CLI configurada; dentro do WSL vale o comando de mesmo nome instalado na distro. */
  executable?: string;
}
// Modelos que a CLI do Claude oferece para esta conta (nomes com versão, como no app do Claude).
// Abre um processo só para perguntar e fecha em seguida; a resposta fica guardada até o app fechar.
const MODELS_TIMEOUT_MS = 20_000;
let modelsCache: Promise<ChatModelOption[]> | null = null;
// "claude-opus-5-5" vira "Opus 5.5": o nome com a versão, como aparece no app do Claude.
export function modelName(id: string | undefined): string | null {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id ?? "");
  if (!m) return null;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}
export function toModelOptions(
  list: { value: string; displayName: string; description?: string; resolvedModel?: string; supportedEffortLevels?: ChatEffort[] }[],
): ChatModelOption[] {
  const options = list.map((m) => {
    const named = modelName(m.resolvedModel) ?? m.displayName ?? m.value;
    const isDefault = m.value === "default";
    return {
      value: isDefault ? "" : m.value,
      label: isDefault ? `Padrão (${named})` : `${named}${/\[1m\]/i.test(m.value) ? " (1M)" : ""}`,
      ...(m.description ? { description: m.description } : {}),
      ...(m.supportedEffortLevels?.length ? { efforts: m.supportedEffortLevels } : {}),
    };
  });
  return options.some((m) => m.value === "") ? options : [{ value: "", label: "Padrão" }, ...options];
}
export function claudeModels(cwd: string, executable?: string): Promise<ChatModelOption[]> {
  modelsCache ??= (async () => {
    const idle = new Promise<never>(() => undefined);
    const probe = query({
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await idle;
      })(),
      options: { cwd, ...sdkExecutableOption(), ...wslSpawn(cwd, executable) },
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      const list = await Promise.race([
        probe.supportedModels(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("A CLI do Claude não respondeu a lista de modelos.")), MODELS_TIMEOUT_MS);
        }),
      ]);
      return toModelOptions(list);
    } finally {
      clearTimeout(timer);
      probe.close();
    }
  })().catch((error) => {
    // Falhou: a próxima abertura do chat tenta de novo.
    modelsCache = null;
    throw error;
  });
  return modelsCache;
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
  private contextUsed = 0;
  constructor(
    private readonly cwd: string,
    private readonly emit: (event: ChatEvent) => void,
    private readonly options: ChatOptions = {},
  ) {}
  // `wire` é o que a CLI recebe (pode levar o pacote de handoff); `text` é o que aparece na conversa.
  send(text: string, images: ChatImage[] = [], wire: string = text) {
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
          ...(wire ? [{ type: "text" as const, text: wire }] : []),
        ]
      : wire;
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    };
    this.emit({ type: "user", text, ...(images.length ? { images: images.map((image) => image.path) } : {}) });
    // Cada mensagem é um turno: o status "rodando" sai aqui, e não só quando a sessão abre.
    this.emit({ type: "status", state: "running" });
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
  // Troca o modo na sessão aberta, sem reiniciar; sem sessão, vale para a próxima mensagem.
  setPermissionMode(mode: ChatPermissionMode) {
    this.options.permissionMode = mode;
    void this.running?.setPermissionMode(mode).catch(() => undefined);
  }
  // Modelo ao vivo: a conversa continua no mesmo processo; sem sessão, vale para a próxima mensagem.
  setModel(model: string | null) {
    this.options.model = model;
    void this.running?.setModel(model ?? undefined).catch(() => undefined);
  }
  // Esforço ao vivo, pela camada de configurações da sessão; null volta ao padrão do modelo.
  setEffort(effort: ChatEffort | null) {
    this.options.effort = effort;
    void this.running?.applyFlagSettings({ effortLevel: effort }).catch(() => undefined);
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
        model: this.options.model ?? undefined,
        ...(this.options.effort ? { effort: this.options.effort } : {}),
        ...(this.options.mcp
          ? {
              mcpServers: {
                [MEMORY_SERVER]: {
                  type: "http" as const,
                  url: this.options.mcp.url,
                  headers: { Authorization: `Bearer ${this.options.mcp.token}` },
                },
              },
            }
          : {}),
        // Mesmo prompt, ferramentas e configurações (CLAUDE.md, settings, skills) do Claude Code.
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["user", "project", "local"],
        // Texto e raciocínio chegam token a token, como eventos "delta".
        includePartialMessages: true,
        permissionMode: this.options.permissionMode ?? "default",
        // Necessário para "Liberar tudo"; só tem efeito quando a pessoa escolhe esse modo.
        allowDangerouslySkipPermissions: true,
        canUseTool: (toolName, input, options) => this.approve(toolName, input, options),
        ...sdkExecutableOption(),
        ...wslSpawn(this.cwd, this.options.executable),
      },
    });
    void this.consume(this.running);
  }
  private async consume(stream: Query) {
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
    if (message.type === "stream_event") {
      // Só a conversa principal: subagentes não escrevem ao vivo na tela.
      if (message.parent_tool_use_id) return;
      const event = message.event as { type: string; delta?: { type: string; text?: string; thinking?: string } };
      if (event.type !== "content_block_delta" || !event.delta) return;
      if (event.delta.type === "text_delta" && event.delta.text)
        this.emit({ type: "delta", kind: "text", text: event.delta.text });
      else if (event.delta.type === "thinking_delta" && event.delta.thinking)
        this.emit({ type: "delta", kind: "thinking", text: event.delta.thinking });
    } else if (message.type === "assistant") {
      // Contexto em uso: entrada da última chamada (com cache), que é o que a janela carrega.
      const usage = message.message.usage as unknown as Record<string, number> | undefined;
      if (usage) {
        this.contextUsed =
          (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      }
      const blocks: ChatBlock[] = [];
      for (const part of message.message.content) {
        if (part.type === "text") blocks.push({ kind: "text", text: part.text });
        else if (part.type === "thinking" && part.thinking.trim()) blocks.push({ kind: "thinking", text: part.thinking });
        else if (part.type === "tool_use")
          blocks.push({
            kind: "tool",
            name: part.name,
            summary: summarize(part.name, part.input as Record<string, unknown>),
            id: part.id,
            input: toolInput(part.input as Record<string, unknown>),
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
            toolUseId: part.tool_use_id,
          });
      }
    } else if (message.type === "result") {
      if (this.interrupted) {
        this.interrupted = false;
        this.emit({ type: "status", state: "idle", message: "Interrompido." });
        return;
      }
      const model = Object.values(message.modelUsage ?? {})[0];
      if (this.contextUsed > 0) this.emit({ type: "context", used: this.contextUsed, limit: model?.contextWindow ?? null });
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
  send(text: string, images?: ChatImage[], wire?: string): void;
  decide(id: string, behavior: "allow" | "deny", always: boolean): void;
  interrupt(): void;
  stop(): void;
  // Compactação nativa, quando a CLI tem uma. Sem ela, a conversa precisa ser refeita.
  compact?(): Promise<void>;
  // Modo de permissão ao vivo; só o Claude tem.
  setPermissionMode?(mode: ChatPermissionMode): void;
  setEffort?(effort: ChatEffort | null): void;
  setModel?(model: string | null): void;
}
export interface ChatTarget {
  provider: Provider;
  cwd: string;
  executable: string;
  model?: string | null;
  permissionMode?: ChatPermissionMode | null;
  effort?: ChatEffort | null;
  mcp?: McpEndpoint | null;
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
      // Pedaços ao vivo vão só para a tela, sem posição no histórico.
      if (event.type === "delta") return this.emitFor(taskId, -1, event);
      const seq = this.storage.append(taskId, event);
      this.emitFor(taskId, seq, event);
    };
  }
  send(taskId: string, target: ChatTarget, text: string, images: ChatImage[] = [], handoff?: string | null) {
    let session = this.sessions.get(taskId);
    if (!session) {
      const emit = this.emitter(taskId);
      const options: ChatOptions = {
        resume: this.storage.sessionId(taskId) || null,
        model: target.model,
        permissionMode: target.permissionMode ?? null,
        effort: target.effort ?? null,
        mcp: target.mcp ?? null,
        onSession: (id) => this.storage.saveSessionId(taskId, id),
      };
      session =
        target.provider === "codex"
          ? new CodexChatSession(target.cwd, target.executable, emit, options)
          : target.provider === "antigravity"
            ? new AntigravityChatSession(target.cwd, target.executable, emit, options)
            : new ChatSession(target.cwd, emit, { ...options, executable: target.executable });
      this.sessions.set(taskId, session);
    }
    session.send(text, images, withHandoff(handoff, text));
  }
  // Conversa nova: sem processo aberto e sem sessão guardada para retomar. É quando a memória
  // do projeto vai junto da primeira mensagem.
  isFresh(taskId: string): boolean {
    return !this.sessions.has(taskId) && !this.storage.sessionId(taskId);
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
  setPermissionMode(taskId: string, mode: ChatPermissionMode) {
    this.sessions.get(taskId)?.setPermissionMode?.(mode);
  }
  setModel(taskId: string, model: string | null) {
    this.sessions.get(taskId)?.setModel?.(model);
  }
  setEffort(taskId: string, effort: ChatEffort | null) {
    this.sessions.get(taskId)?.setEffort?.(effort);
  }
  interrupt(taskId: string) {
    this.sessions.get(taskId)?.interrupt();
  }
  stop(taskId: string) {
    this.sessions.get(taskId)?.stop();
    this.sessions.delete(taskId);
  }
  // Nova conversa: a sessão atual é fechada e a próxima mensagem abre outra, sem retomar a antiga.
  // O histórico visível continua no armazenamento.
  reset(taskId: string) {
    this.stop(taskId);
    this.storage.saveSessionId(taskId, "");
  }
  async compact(taskId: string) {
    const session = this.sessions.get(taskId);
    if (!session?.compact) throw new Error("Este agente não tem compactação; use Nova conversa com resumo.");
    await session.compact();
  }
  // Registra um evento que não veio de uma CLI (ex.: troca de agente), salvando e mostrando na conversa.
  record(taskId: string, event: ChatEvent) {
    this.emitter(taskId)(event);
  }
  stopAll() {
    for (const taskId of [...this.sessions.keys()]) this.stop(taskId);
  }
}
