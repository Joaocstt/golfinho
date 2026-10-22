import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Store } from "../src/main/store";
import { MemoryMcp } from "../src/main/memoryMcp";

const running: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const item of running.splice(0)) await item.stop();
});

async function setup() {
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
  store.addProject({ id: "q", name: "Outro", path: "/outro", remotes: ["origin"] });
  const task = (projectId: string, branch: string) =>
    store.createTask({
      projectId,
      title: `Tarefa ${branch}`,
      prompt: "x",
      provider: "claude",
      branch,
      base: "main",
      remote: "origin",
      timeoutMinutes: 0,
    });
  const mine = task("p", "golfinho/a");
  const other = task("q", "golfinho/b");
  store.saveMemory({
    projectId: "q",
    kind: "decisao",
    title: "Segredo do outro projeto",
    content: "Migração feita com Flyway.",
    pinned: false,
    archived: false,
  });
  let changes = 0;
  const server = new MemoryMcp(store, join(mkdtempSync(join(tmpdir(), "golfinho-mcp-")), "mcp"), () => changes++);
  await server.start();
  running.push(server);
  return { store, server, mine, other, changes: () => changes };
}

async function connect(url: string, token: string) {
  const client = new Client({ name: "teste", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  running.push({ stop: () => client.close() });
  return client;
}
const textOf = (result: unknown) =>
  ((result as { content: { text: string }[] }).content ?? []).map((part) => part.text).join("\n");

describe("servidor MCP da memória", () => {
  it("recusa token errado e tarefa desconhecida", async () => {
    const { server, mine } = await setup();
    const url = server.endpoint(mine.id)!.url;
    const post = (target: string, token: string) =>
      fetch(target, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await post(url, "errado")).status).toBe(401);
    expect((await post(url.replace(mine.id, "00000000-0000-4000-8000-000000000000"), server.token)).status).toBe(404);
    expect(new URL(url).hostname).toBe("127.0.0.1");
  });
  it("salva e busca só no projeto da tarefa", async () => {
    const { store, server, mine, changes } = await setup();
    const endpoint = server.endpoint(mine.id)!;
    const client = await connect(endpoint.url, endpoint.token);
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual(["memoria_buscar", "memoria_conversa", "memoria_ler", "memoria_recentes", "memoria_salvar"]);

    expect(textOf(await client.callTool({ name: "memoria_buscar", arguments: { consulta: "migracao" } }))).toBe(
      "Nada encontrado nas notas nem no histórico das conversas.",
    );
    await client.callTool({
      name: "memoria_salvar",
      arguments: { tipo: "armadilha", titulo: "Migração lenta", conteudo: "Rodar fora do horário." },
    });
    const saved = store.memories("p");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ origin: "agente", kind: "armadilha", source: { taskId: mine.id } });
    expect(changes()).toBe(1);

    const found = textOf(await client.callTool({ name: "memoria_buscar", arguments: { consulta: "migracao" } }));
    expect(found).toContain("Migração lenta");
    expect(found).not.toContain("outro projeto");
    const full = textOf(await client.callTool({ name: "memoria_ler", arguments: { id: saved[0].id } }));
    expect(full).toContain("Rodar fora do horário.");
    const foreign = store.memories("q")[0];
    const denied = await client.callTool({ name: "memoria_ler", arguments: { id: foreign.id } });
    expect(denied.isError).toBe(true);
  });
  it("busca no histórico das conversas do projeto e abre o trecho", async () => {
    const { store, server, mine, other } = await setup();
    store.chatAppend(mine.id, { type: "user", text: "Por que a migração falhou?" });
    const seq = store.chatAppend(mine.id, {
      type: "assistant",
      blocks: [{ kind: "text", text: "A migração falhou por causa do índice duplicado em users." }],
    });
    store.chatAppend(mine.id, { type: "user", text: "Remova o índice." });
    store.chatAppend(other.id, { type: "user", text: "Migração do outro projeto, segredo." });
    const endpoint = server.endpoint(mine.id)!;
    const client = await connect(endpoint.url, endpoint.token);
    const found = textOf(await client.callTool({ name: "memoria_buscar", arguments: { consulta: "indice duplicado" } }));
    expect(found).toContain("Histórico das conversas:");
    expect(found).toContain(`posição ${seq}`);
    expect(found).not.toContain("segredo");
    const excerpt = textOf(
      await client.callTool({ name: "memoria_conversa", arguments: { tarefa: mine.id, posicao: seq } }),
    );
    expect(excerpt).toContain("Por que a migração falhou?");
    expect(excerpt).toContain("índice duplicado em users.");
    expect(excerpt).toContain("Remova o índice.");
    const denied = await client.callTool({ name: "memoria_conversa", arguments: { tarefa: other.id, posicao: 1 } });
    expect(denied.isError).toBe(true);
  });
  it("escreve a configuração do Claude só para o usuário", async () => {
    const { server, mine } = await setup();
    const launch = server.launch(mine.id)!;
    const config = JSON.parse(readFileSync(launch.claudeConfig, "utf8"));
    expect(config.mcpServers.golfinho_memoria).toMatchObject({ type: "http", url: launch.url });
    if (process.platform !== "win32") expect(statSync(launch.claudeConfig).mode & 0o077).toBe(0);
  });
});
