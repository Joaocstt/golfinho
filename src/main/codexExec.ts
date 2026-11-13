import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { executablePath } from "./agents";
import { launchTarget } from "./shellCommand";
import { wslChild, wslTarget } from "./wsl";

// Uma consulta à Codex sem conversa, para o Escritório: `codex exec --json` em modo só leitura.
// O prompt vai pelo stdin (no Windows, uma linha de comando longa ou com quebras se perde) e o
// andamento chega em JSON linha a linha: comandos, buscas na web e as mensagens do agente.

export interface CodexExecOptions {
  cwd: string;
  executable: string | undefined;
  model?: string;
  web: boolean;
  signal: AbortSignal;
  /** Ferramenta usada, no mesmo formato do Claude: nome, entrada e um resumo cru. */
  onTool?: (name: string, input: Record<string, unknown>, raw: string) => void;
  /** Texto que o agente escreve entre as ferramentas (a narração). */
  onText?: (text: string) => void;
}

export function codexExecArgs(cwd: string, o: { model?: string; web: boolean }): string[] {
  return [
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "-c",
    'approval_policy="never"',
    "-c",
    `web_search=${o.web ? '"live"' : '"disabled"'}`,
    ...(o.model ? ["-m", o.model] : []),
    "-C",
    cwd,
    "-",
  ];
}

// O comando que a Codex roda vem embrulhado no shell ("powershell -Command '...'", "bash -lc '...'").
export function innerCommand(command: string): string {
  const m = /(?:-Command|-lc|-c)\s+(['"])([\s\S]*)\1\s*$/.exec(command);
  return (m ? m[2] : command).trim();
}

type Item = Record<string, any>;

/** Lê os eventos da Codex e diz o que o Escritório mostra; devolve a resposta final no fim. */
export class CodexEvents {
  private seen = new Set<string>();
  private pending: string | null = null;
  last: string | null = null;
  error: string | null = null;
  done = false;
  constructor(private readonly o: Pick<CodexExecOptions, "onTool" | "onText">) {}

  line(text: string) {
    let event: Item;
    try {
      event = JSON.parse(text);
    } catch {
      return;
    }
    if (event.type === "item.started" || event.type === "item.completed") this.item(event.item ?? {}, event.type === "item.completed");
    else if (event.type === "turn.completed") this.done = true;
    else if (event.type === "turn.failed") this.error = event.error?.message || "a Codex não terminou o trabalho";
    else if (event.type === "error" && typeof event.message === "string") this.error = event.message;
  }

  private tool(id: string, name: string, input: Record<string, unknown>, raw: string) {
    if (id && this.seen.has(id)) return;
    if (id) this.seen.add(id);
    // A mensagem antes de uma ferramenta é narração; a última, sem ferramenta depois, é a entrega.
    if (this.pending) this.o.onText?.(this.pending);
    this.pending = null;
    this.o.onTool?.(name, input, raw);
  }

  private item(item: Item, completed: boolean) {
    const id = String(item.id ?? "");
    switch (item.type) {
      case "agent_message":
        if (completed && typeof item.text === "string" && item.text.trim()) {
          if (this.pending) this.o.onText?.(this.pending);
          this.pending = item.text;
          this.last = item.text;
        }
        break;
      case "command_execution": {
        const command = innerCommand(String(item.command ?? ""));
        this.tool(id, "Bash", { command }, command);
        break;
      }
      case "web_search": {
        const q = String(item.query ?? item.action?.query ?? "");
        if (q || completed) this.tool(id, "WebSearch", { query: q }, q);
        break;
      }
      case "file_change": {
        const path = String(item.changes?.[0]?.path ?? "");
        this.tool(id, "Edit", { file_path: path }, path);
        break;
      }
      case "mcp_tool_call": {
        const name = String(item.tool ?? "ferramenta");
        const input = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
        this.tool(id, name, input, `${item.server ?? ""} ${name}`.trim());
        break;
      }
    }
  }
}

export function codexExec(prompt: string, o: CodexExecOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsl = wslTarget(o.cwd);
    const args = codexExecArgs(wsl ? wsl.linux : o.cwd, o);
    let child: ChildProcessWithoutNullStreams;
    try {
      if (wsl) {
        const target = wslChild(wsl, o.executable || "codex", args, process.env, []);
        child = spawn(target.file, target.args, { ...target.options, stdio: ["pipe", "pipe", "pipe"] });
      } else {
        const path = executablePath(o.executable || "codex");
        if (!path) throw new Error("A Codex não foi encontrada neste computador. Instale a CLI ou configure o caminho em Configurações.");
        const target = launchTarget(path, args);
        child = spawn(target.file, target.args, { cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      }
    } catch (error) {
      reject(error);
      return;
    }
    const events = new CodexEvents(o);
    let buffer = "";
    let stderr = "";
    let finished = false;
    const finish = (error: Error | null, value?: string) => {
      if (finished) return;
      finished = true;
      o.signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => {
      child.kill();
      finish(new Error("aborted"));
    };
    if (o.signal.aborted) return abort();
    o.signal.addEventListener("abort", abort);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const text = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (text) events.line(text);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (error) => finish(new Error(`A Codex não abriu: ${error.message}`)));
    child.on("close", (code) => {
      if (buffer.trim()) events.line(buffer.trim());
      if (events.done && events.last !== null) return finish(null, events.last);
      // Erro sem evento: a última linha útil do stderr diz o motivo (login, modelo, rede).
      const hint = stderr
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !/^\d{4}-\d\d-\d\dT\S+\s+(WARN|INFO|DEBUG)/.test(l))
        .pop();
      finish(new Error(events.error || hint || `a Codex encerrou sem responder (código ${code})`));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
  });
}
