import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { SshConnection } from "../shared/contracts";
import type { Store } from "./store";
import { clip } from "./handoff";
import { remoteList, remoteRead, remoteRun, remoteSummary } from "./ssh";
import { wslHostAddress } from "./wsl";
import {
  SSH_SERVER,
  SSH_TOKEN_ENV,
  sshPromptNote,
  type SshApprovalRequest,
  type SshMcpEndpoint,
  type SshMcpLink,
} from "./sshMcpTypes";

export { SSH_SERVER, SSH_TOKEN_ENV, sshPromptNote, type SshApprovalRequest, type SshMcpEndpoint, type SshMcpLink };

// Servidor MCP de análise SSH do Golfinho. Escuta só em 127.0.0.1, numa porta efêmera, com token
// novo a cada execução do app. Expõe apenas os servidores que o usuário marcou como liberados para
// IA e exige confirmação explícita no chat antes de executar qualquer comando remoto.
const TASK_PATH = /^\/ssh-mcp\/([0-9a-f-]{36})\/?$/i;
const MAX_OUTPUT_CHARS = 32_000;
const MCP_TIMEOUT_SECONDS = 600;

export interface SshMcpOps {
  list: typeof remoteList;
  read: typeof remoteRead;
  run: typeof remoteRun;
  summary: typeof remoteSummary;
}

const defaultOps: SshMcpOps = {
  list: remoteList,
  read: remoteRead,
  run: remoteRun,
  summary: remoteSummary,
};

export class SshMcp implements SshMcpLink {
  private server: Server | null = null;
  private wslServer: Server | null = null;
  private wslHost: string | null = null;
  private port = 0;
  readonly token = randomBytes(32).toString("hex");
  constructor(
    private readonly store: Store,
    private readonly configDir: string,
    private readonly passwordFor: (connectionId: string) => string | null,
    private readonly approve: (taskId: string, req: SshApprovalRequest) => Promise<boolean>,
    private readonly ops: SshMcpOps = defaultOps,
  ) {}

  async start(): Promise<void> {
    rmSync(this.configDir, { recursive: true, force: true });
    mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    this.port = typeof address === "object" && address ? address.port : 0;
    this.server = server;
    const host = process.platform === "win32" ? wslHostAddress(networkInterfaces()) : null;
    if (host) {
      const extra = createServer((req, res) => void this.handle(req, res));
      const ok = await new Promise<boolean>((resolve) => {
        extra.once("error", () => resolve(false));
        extra.listen(this.port, host, () => resolve(true));
      });
      if (ok) {
        this.wslServer = extra;
        this.wslHost = host;
      }
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    const extra = this.wslServer;
    this.wslServer = null;
    if (extra) await new Promise<void>((resolve) => extra.close(() => resolve()));
    rmSync(this.configDir, { recursive: true, force: true });
  }

  endpoint(taskId: string, wsl = false): SshMcpEndpoint | null {
    if (!this.server) return null;
    const host = wsl && this.wslHost ? this.wslHost : "127.0.0.1";
    const url = `http://${host}:${this.port}/ssh-mcp/${taskId}`;
    // O Antigravity descobre `<pasta>/.agents/mcp_config.json` via `--add-dir`, sem tocar no repo nem no global.
    const agyDir = join(this.configDir, `agy-${taskId}${wsl ? "-wsl" : ""}`);
    const agentsDir = join(agyDir, ".agents");
    mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
    const config = {
      mcpServers: {
        [SSH_SERVER]: {
          serverUrl: url,
          headers: { Authorization: `Bearer ${this.token}` },
          timeoutSeconds: MCP_TIMEOUT_SECONDS,
        },
      },
    };
    writeFileSync(join(agentsDir, "mcp_config.json"), JSON.stringify(config), { mode: 0o600 });
    return { url, token: this.token, agyDir };
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
    const expected = Buffer.from(this.token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private allowedConnections(): SshConnection[] {
    return this.store.settings().ssh.filter((c) => c.allowAi === true);
  }

  private resolveConnection(query: string): SshConnection | null {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const allowed = this.allowedConnections();
    return (
      allowed.find((c) => c.id.toLowerCase() === needle) ??
      allowed.find((c) => c.name.trim().toLowerCase() === needle) ??
      allowed.find((c) => `${c.user}@${c.host}`.toLowerCase() === needle) ??
      allowed.find((c) => `${c.user}@${c.host}:${c.port}`.toLowerCase() === needle) ??
      null
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const fail = (status: number, message: string) => {
      if (res.headersSent) return;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
    };
    try {
      if (!this.authorized(req)) return fail(401, "Token inválido.");
      const match = TASK_PATH.exec(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
      if (!match) return fail(404, "Endereço desconhecido.");
      const taskId = match[1];
      try {
        this.store.task(taskId);
      } catch {
        return fail(404, "Tarefa não encontrada.");
      }
      if (req.method !== "POST") return fail(405, "Use POST.");
      const abort = new AbortController();
      const mcp = this.tools(taskId, abort.signal);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        abort.abort();
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      fail(500, (error as Error).message);
    }
  }

  private tools(taskId: string, signal: AbortSignal): McpServer {
    const mcp = new McpServer({ name: SSH_SERVER, version: "1.0.0" });
    const ok = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
    const err = (value: string) => ({ content: [{ type: "text" as const, text: value }], isError: true });

    const requireAllowed = (servidor: string): SshConnection | { error: ReturnType<typeof err> } => {
      const conn = this.resolveConnection(servidor);
      if (conn) return conn;
      const list = this.allowedConnections();
      if (!list.length) {
        return {
          error: err(
            "Nenhum servidor SSH está liberado para IA. Peça ao usuário para marcar \"Liberar IA\" no servidor desejado na aba SSH do Golfinho.",
          ),
        };
      }
      return {
        error: err(
          `Servidor "${servidor}" não encontrado ou não liberado para IA. Servidores liberados: ${list.map((c) => c.name).join(", ")}.`,
        ),
      };
    };

    const passwordFor = (conn: SshConnection): string | null | { error: ReturnType<typeof err> } => {
      try {
        return this.passwordFor(conn.id);
      } catch (error) {
        return { error: err((error as Error).message) };
      }
    };

    mcp.registerTool(
      "ssh_servidores",
      {
        title: "Listar servidores SSH liberados",
        description:
          "Lista apenas os servidores SSH que o usuário liberou para análise por IA no Golfinho (nome, usuário, host e porta). Nunca expõe senhas nem chaves.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => {
        const list = this.allowedConnections();
        if (!list.length) {
          return ok(
            "Nenhum servidor SSH está liberado para IA. Peça ao usuário para liberar o servidor desejado na aba SSH do Golfinho.",
          );
        }
        const secrets = new Set(this.store.secretIds());
        const lines = list.map((c) => {
          const auth = c.identityFile
            ? "chave privada"
            : secrets.has(c.id)
              ? "senha guardada no cofre"
              : "sem senha guardada (pode falhar se exigir senha)";
          return `- ${c.name} (id: ${c.id}) — ${c.user}@${c.host}:${c.port} [${auth}]`;
        });
        return ok(`Servidores SSH liberados para IA (${list.length}):\n${lines.join("\n")}`);
      },
    );

    mcp.registerTool(
      "ssh_resumo",
      {
        title: "Resumo de saúde do servidor SSH",
        description:
          "Faz uma coleta somente leitura de saúde de um servidor SSH liberado: sistema, uptime, CPU, RAM, disco, serviços systemd com falha, containers Docker, portas abertas e principais processos.",
        inputSchema: {
          servidor: z.string().trim().min(1).max(200).describe("Nome, id ou usuario@host do servidor liberado."),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ servidor }) => {
        const conn = requireAllowed(servidor);
        if ("error" in conn) return conn.error;
        const pass = passwordFor(conn);
        if (pass && typeof pass === "object") return pass.error;
        try {
          const summary = await this.ops.summary(conn, pass);
          return ok(`Servidor: ${conn.name} (${conn.user}@${conn.host}:${conn.port})\n\n${clip(summary, MAX_OUTPUT_CHARS)}`);
        } catch (error) {
          return err((error as Error).message);
        }
      },
    );

    mcp.registerTool(
      "ssh_arquivos",
      {
        title: "Listar arquivos no servidor SSH",
        description: "Lista pastas e arquivos de um caminho em um servidor SSH liberado. Sem caminho, lista a pasta inicial (home).",
        inputSchema: {
          servidor: z.string().trim().min(1).max(200).describe("Nome, id ou usuario@host do servidor liberado."),
          caminho: z.string().max(4096).optional().describe("Caminho absoluto ou relativo no servidor (vazio = home)."),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ servidor, caminho }) => {
        const conn = requireAllowed(servidor);
        if ("error" in conn) return conn.error;
        const pass = passwordFor(conn);
        if (pass && typeof pass === "object") return pass.error;
        try {
          const listing = await this.ops.list(conn, caminho ?? "", pass);
          const rows = listing.entries.map((e) => (e.kind === "directory" ? `${e.name}/` : e.name));
          const footer = listing.truncated ? "\n(lista truncada)" : "";
          return ok(`Pasta ${listing.path} em ${conn.name}:\n${rows.join("\n") || "(vazia)"}${footer}`);
        } catch (error) {
          return err((error as Error).message);
        }
      },
    );

    mcp.registerTool(
      "ssh_ler",
      {
        title: "Ler arquivo no servidor SSH",
        description: "Lê o conteúdo de um arquivo de texto (até 512 KiB) em um servidor SSH liberado.",
        inputSchema: {
          servidor: z.string().trim().min(1).max(200).describe("Nome, id ou usuario@host do servidor liberado."),
          caminho: z.string().trim().min(1).max(4096).describe("Caminho do arquivo no servidor."),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ servidor, caminho }) => {
        const conn = requireAllowed(servidor);
        if ("error" in conn) return conn.error;
        const pass = passwordFor(conn);
        if (pass && typeof pass === "object") return pass.error;
        try {
          const content = await this.ops.read(conn, caminho, pass);
          return ok(clip(content, MAX_OUTPUT_CHARS) || "(arquivo vazio)");
        } catch (error) {
          return err((error as Error).message);
        }
      },
    );

    mcp.registerTool(
      "ssh_executar",
      {
        title: "Executar comando no servidor SSH",
        description:
          "Executa um comando no servidor SSH liberado. Sempre pede confirmação explícita do usuário no chat antes de rodar.",
        inputSchema: {
          servidor: z.string().trim().min(1).max(200).describe("Nome, id ou usuario@host do servidor liberado."),
          comando: z.string().trim().min(1).max(4000).describe("Comando shell a executar no servidor."),
        },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      async ({ servidor, comando }) => {
        const conn = requireAllowed(servidor);
        if ("error" in conn) return conn.error;
        const allowed = await this.approve(taskId, {
          toolName: `SSH · ${conn.name}`,
          summary: comando,
          signal,
        });
        if (!allowed) return err("Comando negado pelo usuário no Golfinho.");
        const pass = passwordFor(conn);
        if (pass && typeof pass === "object") return pass.error;
        try {
          const output = await this.ops.run(conn, comando, pass);
          return ok(clip(output.trim(), MAX_OUTPUT_CHARS) || "(sem saída)");
        } catch (error) {
          return err((error as Error).message);
        }
      },
    );

    return mcp;
  }
}
