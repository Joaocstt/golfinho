import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ChatEvent } from "../shared/contracts";
import { executablePath } from "./agents";
import { launchTarget } from "./shellCommand";
import type { ChatBackend, ChatOptions } from "./chat";
import type { ChatImage } from "./chatImages";
// Versão do cliente informada ao app-server. Acompanha a versão do app em package.json.
const CLIENT_VERSION = "0.1.5";
type Json = Record<string, any>;
interface Waiting {
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
}
interface Approval {
  requestId: number | string;
  method: string;
}
// Uma conversa da Codex por tarefa, falando com `codex app-server` por JSON linha a linha.
// Os formatos seguem o schema gerado pela própria CLI (codex app-server generate-json-schema).
export class CodexChatSession implements ChatBackend {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private threadId: string | null = null;
  private nextId = 1;
  private calls = new Map<number, Waiting>();
  private pending = new Map<string, Approval>();
  private buffer = "";
  private turnActive = false;
  private turnId: string | null = null;
  private interrupted = false;
  private queue: { text: string; images: ChatImage[] }[] = [];
  private closed = false;
  constructor(
    private readonly cwd: string,
    private readonly executable: string,
    private readonly emit: (event: ChatEvent) => void,
    private readonly options: ChatOptions = {},
  ) {}
  send(text: string, images: ChatImage[] = []) {
    this.emit({ type: "user", text, ...(images.length ? { images: images.map((image) => image.path) } : {}) });
    const entry = { text, images };
    if (this.turnActive) this.queue.push(entry);
    else void this.runTurn(entry);
  }
  decide(id: string, behavior: "allow" | "deny", always: boolean) {
    const approval = this.pending.get(id);
    if (!approval) return;
    this.pending.delete(id);
    const decision =
      behavior === "deny" ? "decline" : always ? "acceptForSession" : "accept";
    this.write({ id: approval.requestId, result: { decision } });
    this.emit({ type: "approval_resolved", id, behavior });
  }
  // Para o turno atual sem fechar a conversa. Sem o id do turno ainda, a interrupção sai
  // assim que o turn/start responder.
  interrupt() {
    if (!this.turnActive) return;
    this.interrupted = true;
    this.queue.length = 0;
    for (const id of [...this.pending.keys()]) this.decide(id, "deny", false);
    this.sendInterrupt();
  }
  private sendInterrupt() {
    if (this.threadId && this.turnId)
      void this.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }).catch(() => undefined);
  }
  stop() {
    this.closed = true;
    for (const id of [...this.pending.keys()]) this.decide(id, "deny", false);
    for (const waiting of this.calls.values()) waiting.reject(new Error("Conversa encerrada."));
    this.calls.clear();
    this.queue.length = 0;
    this.child?.kill();
    this.child = null;
  }
  private async runTurn({ text, images }: { text: string; images: ChatImage[] }) {
    this.turnActive = true;
    this.emit({ type: "status", state: "running" });
    try {
      await this.start();
      const started = await this.request("turn/start", {
        threadId: this.threadId,
        cwd: this.cwd,
        // A Codex lê a imagem do disco pelo caminho; o texto vem depois, como no chat do Claude.
        input: [
          ...images.map((image) => ({ type: "localImage", path: image.path })),
          ...(text ? [{ type: "text", text }] : []),
        ],
      });
      this.turnId = started.turn?.id ?? null;
      if (this.interrupted) this.sendInterrupt();
    } catch (error) {
      this.turnActive = false;
      this.emit({ type: "status", state: "error", message: (error as Error).message });
    }
  }
  private start(): Promise<void> {
    if (!this.starting) this.starting = this.launch();
    return this.starting;
  }
  private async launch() {
    const path = executablePath(this.executable);
    if (!path) throw new Error(`Executável não encontrado: ${this.executable}. Configure seu caminho em Configurações.`);
    const target = launchTarget(path, ["app-server"]);
    const child = spawn(target.file, target.args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.read(chunk));
    child.stderr.resume();
    child.on("error", (error) => this.die(error.message));
    child.on("exit", (code) => {
      if (!this.closed) this.die(`A Codex encerrou (código ${code}).`);
    });
    await this.request("initialize", {
      clientInfo: { name: "golfinho", title: "Golfinho", version: CLIENT_VERSION },
    });
    this.write({ method: "initialized" });
    // Com uma conversa salva, a thread é retomada; se ela não existir mais, abre outra.
    const params = { cwd: this.cwd, approvalPolicy: "on-request", sandbox: "workspace-write" };
    let started: Json;
    if (this.options.resume) {
      try {
        started = await this.request("thread/resume", { threadId: this.options.resume, ...params });
      } catch {
        started = await this.request("thread/start", params);
      }
    } else started = await this.request("thread/start", params);
    this.threadId = started.thread.id;
    this.options.onSession?.(started.thread.id);
  }
  private die(message: string) {
    this.child = null;
    this.starting = null;
    this.turnActive = false;
    for (const waiting of this.calls.values()) waiting.reject(new Error(message));
    this.calls.clear();
    if (!this.closed) this.emit({ type: "status", state: "error", message });
  }
  private request(method: string, params: Json): Promise<Json> {
    const id = this.nextId++;
    return new Promise<Json>((resolve, reject) => {
      this.calls.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }
  private write(message: Json) {
    this.child?.stdin.write(JSON.stringify(message) + "\n");
  }
  private read(chunk: string) {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      let message: Json;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      this.dispatch(message);
    }
  }
  private dispatch(message: Json) {
    if (message.method !== undefined && message.id !== undefined) this.serverRequest(message.id, message.method, message.params ?? {});
    else if (message.method !== undefined) this.notification(message.method, message.params ?? {});
    else if (message.id !== undefined) {
      const waiting = this.calls.get(message.id);
      if (!waiting) return;
      this.calls.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message ?? "Erro da Codex."));
      else waiting.resolve(message.result ?? {});
    }
  }
  private serverRequest(requestId: number | string, method: string, params: Json) {
    if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
      const id = randomUUID();
      const isCommand = method === "item/commandExecution/requestApproval";
      this.pending.set(id, { requestId, method });
      this.emit({
        type: "approval",
        id,
        toolName: isCommand ? "Comando" : "Alterar arquivos",
        summary: isCommand
          ? String(params.command ?? "")
          : [params.grantRoot, params.reason].filter(Boolean).join(" — ") || "Alterações de arquivos",
        canAlwaysAllow: true,
      });
      return;
    }
    // Outros pedidos (permissões, perguntas, elicitação) não têm tela no chat ainda: recusa para
    // o turno não ficar esperando uma resposta que ninguém vai dar.
    this.write({ id: requestId, error: { code: -32601, message: "Pedido não suportado pelo chat do Golfinho." } });
    this.emit({ type: "status", state: "error", message: `A Codex pediu algo que o chat ainda não cobre (${method}).` });
  }
  private notification(method: string, params: Json) {
    if (method === "item/started") {
      const item = params.item ?? {};
      if (item.type === "commandExecution")
        this.emit({ type: "assistant", blocks: [{ kind: "tool", name: "Comando", summary: String(item.command ?? "") }] });
    } else if (method === "item/completed") {
      const item = params.item ?? {};
      if (item.type === "agentMessage" && item.text)
        this.emit({ type: "assistant", blocks: [{ kind: "text", text: String(item.text) }] });
      else if (item.type === "commandExecution")
        this.emit({
          type: "tool_result",
          text: String(item.aggregatedOutput ?? ""),
          isError: typeof item.exitCode === "number" && item.exitCode !== 0,
        });
      else if (item.type === "fileChange") {
        const paths = Array.isArray(item.changes)
          ? item.changes.map((change: Json) => String(change.path ?? "")).filter(Boolean).join(", ")
          : "";
        this.emit({ type: "assistant", blocks: [{ kind: "tool", name: "Alterar arquivos", summary: paths || "arquivos" }] });
      }
    } else if (method === "turn/completed") {
      this.turnActive = false;
      this.turnId = null;
      const status = params.turn?.status;
      if (this.interrupted || status === "interrupted") {
        this.interrupted = false;
        this.queue.length = 0;
        this.emit({ type: "status", state: "idle", message: "Interrompido." });
        return;
      }
      if (status === "failed") {
        this.emit({ type: "status", state: "error", message: params.turn?.error?.message ?? "O turno falhou." });
        this.queue.length = 0;
        return;
      }
      const next = this.queue.shift();
      if (next !== undefined) void this.runTurn(next);
      else this.emit({ type: "status", state: "idle" });
    } else if (method === "error") {
      this.emit({ type: "status", state: "error", message: String(params.error?.message ?? params.message ?? "Erro da Codex.") });
    }
  }
}
