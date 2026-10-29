import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { wslHostAddress } from "./wsl";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Memory, MemoryKind } from "../shared/contracts";
import type { Store } from "./store";
import { clip } from "./handoff";
import { kindLabels, searchableText, MEMORY_SERVER, type McpEndpoint, type McpLaunch, type MemoryLink } from "./memory";

// Servidor MCP da memória do projeto. Escuta só em 127.0.0.1, numa porta escolhida pelo sistema,
// e exige um token novo a cada execução do app. A URL leva a tarefa (/mcp/<id>), e o agente só
// enxerga a memória do projeto dela.
const KINDS = ["decisao", "convencao", "armadilha", "contexto", "tarefa"] as const;
const SAVE_KINDS = ["decisao", "convencao", "armadilha", "contexto"] as const;
const TASK_PATH = /^\/mcp\/([0-9a-f-]{36})\/?$/i;

export class MemoryMcp implements MemoryLink {
  private server: Server | null = null;
  // Segunda escuta, no adaptador do WSL: agentes dentro da distro não alcançam o 127.0.0.1 do
  // Windows no modo de rede padrão. Continua exigindo o token.
  private wslServer: Server | null = null;
  private wslHost: string | null = null;
  private port = 0;
  readonly token = randomBytes(32).toString("hex");
  constructor(
    private readonly store: Store,
    // Pasta dos arquivos de configuração do Claude (um por tarefa, com o token).
    private readonly configDir: string,
    // Avisa a interface quando o agente grava uma nota.
    private readonly changed: () => void = () => undefined,
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
  endpoint(taskId: string, wsl = false): McpEndpoint | null {
    if (!this.server) return null;
    // Sem o adaptador do WSL (modo de rede espelhado), o 127.0.0.1 da distro já é o do Windows.
    const host = wsl && this.wslHost ? this.wslHost : "127.0.0.1";
    return { url: `http://${host}:${this.port}/mcp/${taskId}`, token: this.token };
  }
  // O que a CLI recebe para se conectar. O arquivo do Claude é reescrito a cada início porque a
  // porta e o token mudam quando o app reabre.
  launch(taskId: string, wsl = false): McpLaunch | null {
    const endpoint = this.endpoint(taskId, wsl);
    if (!endpoint) return null;
    const claudeConfig = join(this.configDir, `${taskId}${wsl ? "-wsl" : ""}.json`);
    const config = {
      mcpServers: {
        [MEMORY_SERVER]: {
          type: "http",
          url: endpoint.url,
          headers: { Authorization: `Bearer ${endpoint.token}` },
        },
      },
    };
    writeFileSync(claudeConfig, JSON.stringify(config), { mode: 0o600 });
    return { url: endpoint.url, claudeConfig };
  }
  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
    const expected = Buffer.from(this.token);
    return given.length === expected.length && timingSafeEqual(given, expected);
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
      let projectId: string;
      try {
        projectId = this.store.task(match[1]).projectId;
      } catch {
        return fail(404, "Tarefa não encontrada.");
      }
      // Sem estado: cada requisição monta o servidor e o transporte e descarta os dois no fim.
      if (req.method !== "POST") return fail(405, "Use POST.");
      const mcp = this.tools(match[1], projectId);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      fail(500, (error as Error).message);
    }
  }
  private tools(taskId: string, projectId: string): McpServer {
    const mcp = new McpServer({ name: MEMORY_SERVER, version: "1.0.0" });
    const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
    const line = (m: Memory) =>
      `- ${m.id} [${kindLabels[m.kind]}] ${m.title}: ${clip(m.content.replace(/\s+/g, " ").trim(), 240)}`;
    mcp.registerTool(
      "memoria_buscar",
      {
        title: "Buscar na memória do projeto",
        description:
          "Busca na memória deste projeto no Golfinho: as notas (decisões, convenções, armadilhas, contexto e o registro de cada tarefa) e o histórico completo das conversas de todas as tarefas, inclusive com outros agentes. A busca ignora acentos. Use antes de decidir algo que pode já ter sido discutido ou tentado.",
        inputSchema: {
          consulta: z.string().min(1).max(500).describe("Palavras a procurar."),
          tipo: z.enum(KINDS).optional().describe("Restringe as notas a um tipo (não afeta o histórico)."),
          limite: z.number().int().min(1).max(20).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ consulta, tipo, limite }) => {
        const notes = this.store.memories(projectId, {
          query: consulta,
          kind: tipo as MemoryKind | undefined,
          limit: limite ?? 8,
        });
        const history = this.store.searchHistory(projectId, consulta, limite ?? 8);
        if (!notes.length && !history.length) return text("Nada encontrado nas notas nem no histórico das conversas.");
        const parts: string[] = [];
        if (notes.length) parts.push(`Notas:\n${notes.map(line).join("\n")}\n(memoria_ler com o id abre a nota completa)`);
        if (history.length) {
          const titles = new Map<string, string>();
          const titleOf = (id: string) => {
            if (!titles.has(id)) {
              try {
                titles.set(id, this.store.task(id).title);
              } catch {
                titles.set(id, "tarefa");
              }
            }
            return titles.get(id)!;
          };
          parts.push(
            `Histórico das conversas:\n${history
              .map((h) => `- tarefa "${titleOf(h.taskId)}" (tarefa ${h.taskId}, posição ${h.seq}) [${h.who}]: ${h.excerpt.replace(/\s+/g, " ")}`)
              .join("\n")}\n(memoria_conversa com a tarefa e a posição abre o trecho completo)`,
          );
        }
        return text(parts.join("\n\n"));
      },
    );
    mcp.registerTool(
      "memoria_conversa",
      {
        title: "Abrir um trecho do histórico",
        description:
          "Mostra a conversa de uma tarefa deste projeto em volta de uma posição encontrada pelo memoria_buscar: mensagens do usuário, respostas do agente, ferramentas e resultados, com o texto completo.",
        inputSchema: {
          tarefa: z.uuid().describe("Id da tarefa, como aparece no memoria_buscar."),
          posicao: z.number().int().min(1).describe("Posição na conversa, como aparece no memoria_buscar."),
          raio: z.number().int().min(1).max(10).optional().describe("Quantos itens antes e depois (padrão 4)."),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ tarefa, posicao, raio }) => {
        const items = this.store.historyAround(projectId, tarefa, posicao, raio ?? 4);
        if (!items.length) return { ...text("Trecho não encontrado neste projeto."), isError: true };
        const lines = items.flatMap(({ seq, event }) => {
          const found = searchableText(event);
          if (!found) return [];
          const mark = seq === posicao ? " ◀" : "";
          return [`#${seq} [${found.who}]${mark}\n${clip(found.text, 3000)}`];
        });
        return text(lines.join("\n\n") || "O trecho só tem eventos sem texto.");
      },
    );
    mcp.registerTool(
      "memoria_ler",
      {
        title: "Ler uma nota da memória",
        description: "Devolve a nota completa da memória do projeto pelo id.",
        inputSchema: { id: z.uuid() },
        annotations: { readOnlyHint: true },
      },
      async ({ id }) => {
        let m: Memory;
        try {
          m = this.store.memory(id);
        } catch {
          return { ...text("Nota não encontrada."), isError: true };
        }
        if (m.projectId !== projectId) return { ...text("Nota não encontrada."), isError: true };
        this.store.touchMemories([m.id]);
        const origin = m.source ? `\nOrigem: tarefa "${m.source.title}"` : "";
        return text(`[${kindLabels[m.kind]}] ${m.title}${origin}\nAtualizada em ${m.updatedAt}\n\n${m.content}`);
      },
    );
    mcp.registerTool(
      "memoria_recentes",
      {
        title: "Notas recentes da memória",
        description: "Lista as notas mais recentes da memória deste projeto (as fixadas primeiro).",
        inputSchema: { limite: z.number().int().min(1).max(20).optional() },
        annotations: { readOnlyHint: true },
      },
      async ({ limite }) => {
        const list = this.store.memories(projectId, { limit: limite ?? 10 });
        return text(list.length ? list.map(line).join("\n") : "A memória deste projeto está vazia.");
      },
    );
    mcp.registerTool(
      "memoria_salvar",
      {
        title: "Salvar na memória do projeto",
        description:
          "Registra uma nota na memória deste projeto para as próximas tarefas: uma decisão tomada, uma convenção do código, uma armadilha ou abordagem que falhou, ou um contexto importante. Seja curto e específico; não salve o que já está óbvio no código.",
        inputSchema: {
          tipo: z.enum(SAVE_KINDS),
          titulo: z.string().trim().min(1).max(200),
          conteudo: z.string().trim().min(1).max(4000),
        },
      },
      async ({ tipo, titulo, conteudo }) => {
        const task = this.store.task(taskId);
        const m = this.store.saveMemory(
          { projectId, kind: tipo, title: titulo, content: conteudo, pinned: false, archived: false },
          { origin: "agente", source: { taskId, title: task.title } },
        );
        this.changed();
        return text(`Nota salva na memória do projeto (id ${m.id}).`);
      },
    );
    return mcp;
  }
}
