import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ChatBlock, ChatEvent } from "../shared/contracts";
import { launchTarget } from "./shellCommand";
import type { ChatBackend, ChatOptions } from "./chat";
import type { ChatImage } from "./chatImages";
// Mesma ideia da Codex: um processo `agy` por conversa, um turno por linha no stdin. Formatos
// da documentação do agy (modo --print com stream-json): entrada `{"event":"user"}`; saída
// `init`, `step_update` e `result`. Nesse modo o agy não tem cartões de aprovação: ferramentas
// que pediriam permissão são negadas por ele, e o chat só mostra o que aconteceu.
type Json = Record<string, any>;
interface Entry {
  text: string;
  images: ChatImage[];
}
function short(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "") ?? "";
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
export class AntigravityChatSession implements ChatBackend {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private stderr = "";
  private conversationId: string | null = null;
  private turnActive = false;
  private turnText = "";
  private turnKey = 0;
  private shownTools = new Set<string>();
  private finishedTools = new Set<string>();
  private interrupted = false;
  private queue: Entry[] = [];
  private closed = false;
  constructor(
    private readonly cwd: string,
    private readonly executable: string,
    private readonly emit: (event: ChatEvent) => void,
    private readonly options: ChatOptions = {},
  ) {}
  send(text: string, images: ChatImage[] = [], wire: string = text) {
    this.emit({ type: "user", text, ...(images.length ? { images: images.map((image) => image.path) } : {}) });
    const entry = { text: wire, images };
    if (this.turnActive) this.queue.push(entry);
    else this.runTurn(entry);
  }
  // O agy não tem resposta para aprovações neste modo: só há o que o usuário mandar.
  decide() {}
  // Interrompe o turno em curso. O processo sai; a próxima mensagem retoma a mesma conversa.
  interrupt() {
    if (!this.turnActive) return;
    this.interrupted = true;
    this.queue.length = 0;
    this.child?.kill("SIGINT");
  }
  stop() {
    this.closed = true;
    this.queue.length = 0;
    this.child?.stdin.end();
  }
  // Ponto de entrada das linhas de saída. Separado do processo para teste.
  handleLine(line: string) {
    if (!line.trim()) return;
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.event === "init") {
      this.rememberConversation(msg.conversation_id ?? msg.init?.conversation_id);
    } else if (msg.event === "step_update") {
      this.stepUpdate(msg.step_update ?? {});
    } else if (msg.event === "result") {
      this.finishTurn(msg.result ?? {});
    }
  }
  private rememberConversation(id: unknown) {
    if (typeof id !== "string" || !id || id === this.conversationId) return;
    this.conversationId = id;
    this.options.onSession?.(id);
  }
  private stepUpdate(step: Json) {
    this.rememberConversation(step.conversation_id);
    if (step.step_type === "agent_response" && step.state === "ACTIVE" && typeof step.text_delta === "string") {
      this.turnText += step.text_delta;
    }
    if (step.step_type !== "tool" || !step.tool_info) return;
    const info = step.tool_info;
    const key = `${this.turnKey}:${step.step_index}`;
    // O cartão aparece quando a ferramenta começa; o resultado vem quando ela termina (ou falha).
    if (!this.shownTools.has(key)) {
      this.shownTools.add(key);
      const params = info.parameters ?? {};
      const summary = String(params.CommandLine ?? params.TargetFile ?? params.AbsolutePath ?? params.path ?? short(params));
      this.emit({ type: "assistant", blocks: [{ kind: "tool", name: String(info.name ?? step.tool_name ?? "ferramenta"), summary }] });
    }
    if (step.state !== "DONE" && step.state !== "ERROR") return;
    if (this.finishedTools.has(key)) return;
    this.finishedTools.add(key);
    if (info.error) {
      this.emit({ type: "tool_result", text: String(info.error.message ?? short(info.error)), isError: true });
      return;
    }
    if (info.output !== undefined && info.output !== null && info.output !== "")
      this.emit({ type: "tool_result", text: short(info.output), isError: false });
  }
  private finishTurn(result: Json) {
    this.rememberConversation(result.conversation_id);
    const text = typeof result.response === "string" && result.response ? result.response : this.turnText;
    if (text.trim()) this.emit({ type: "assistant", blocks: [{ kind: "text", text }] });
    this.turnText = "";
    this.turnActive = false;
    if (result.status && result.status !== "SUCCESS" && !this.interrupted) {
      this.emit({ type: "status", state: "error", message: String(result.error?.message ?? result.status) });
    } else {
      this.emit({ type: "status", state: "idle" });
    }
    this.interrupted = false;
    this.drain();
  }
  private drain() {
    const next = this.queue.shift();
    if (next) this.runTurn(next);
  }
  private runTurn(entry: Entry) {
    this.turnActive = true;
    this.turnKey += 1;
    this.turnText = "";
    this.emit({ type: "status", state: "running" });
    // Só texto é aceito pelo protocolo: imagens entram como caminho, que o agy pode abrir.
    const paths = entry.images.map((image) => `Imagem anexada: ${image.path}`);
    const content = [entry.text, ...paths].filter(Boolean).join("\n\n");
    if (!this.ensureChild()) return;
    const message = { event: "user", message: { content: [{ type: "text", text: content }] } };
    this.child!.stdin.write(`${JSON.stringify(message)}\n`);
  }
  // Um processo por conversa; se ele caiu, o próximo turno abre outro com a conversa retomada.
  private ensureChild(): boolean {
    if (this.child && this.child.stdin.writable) return true;
    // Acesso total, como pedido: o chat do Antigravity aprova qualquer ferramenta sem perguntar.
    // Sem isso, o agy nega comandos no modo de impressão, porque não há cartão de aprovação.
    // `--print=` sem valor: o agy não pode pegar a próxima opção como prompt.
    const args = [
      "--print=",
      "--dangerously-skip-permissions",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      ...(this.options.resume ? ["--conversation", this.options.resume] : []),
      ...(this.options.model ? ["--model", this.options.model] : []),
    ];
    const target = launchTarget(this.executable, args);
    const child = spawn(target.file, target.args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    this.buffer = "";
    this.stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf("\n");
      while (index >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        this.handleLine(line);
        index = this.buffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
    });
    child.on("error", (error) => this.processEnded(error.message));
    child.on("exit", (code) => {
      if (this.child === child) this.child = null;
      if (this.closed) return;
      this.processEnded(code === 0 || this.interrupted ? null : `agy saiu com código ${code}${this.stderr.trim() ? `: ${this.stderr.trim().slice(-300)}` : ""}`);
    });
    return true;
  }
  private processEnded(error: string | null) {
    if (this.closed) return;
    if (this.turnActive) {
      this.turnActive = false;
      this.turnText = "";
      if (error && !this.interrupted) this.emit({ type: "status", state: "error", message: error });
      else this.emit({ type: "status", state: "idle" });
      this.interrupted = false;
    }
  }
}
