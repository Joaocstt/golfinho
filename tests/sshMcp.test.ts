import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ChatEvent, SshConnection } from "../src/shared/contracts";
import { Store } from "../src/main/store";
import { ChatManager } from "../src/main/chat";
import { SshMcp, sshPromptNote, type SshMcpOps } from "../src/main/sshMcp";

const running: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  for (const item of running.splice(0)) await item.stop();
});

const allowedServer: SshConnection = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Produção",
  host: "10.0.0.10",
  user: "suporte",
  port: 22,
  identityFile: "/home/u/.ssh/id_ed25519",
  allowAi: true,
};

const privateServer: SshConnection = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Financeiro",
  host: "10.0.0.20",
  user: "admin",
  port: 2222,
  identityFile: null,
  allowAi: false,
};

async function setup(opsOverrides: Partial<SshMcpOps> = {}) {
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
  const task = store.createTask({
    projectId: "p",
    title: "Analisar servidor",
    prompt: "analisa",
    provider: "antigravity",
    branch: "golfinho/ssh",
    base: "main",
    remote: "origin",
    timeoutMinutes: 0,
  });
  store.saveSettings({
    ...store.settings(),
    ssh: [allowedServer, privateServer],
  });

  const liveEvents: { taskId: string; event: ChatEvent }[] = [];
  const chat = new ChatManager(
    (taskId, _seq, event) => liveEvents.push({ taskId, event }),
    {
      append: (taskId, event) => store.chatAppend(taskId, event),
      list: (taskId) => store.chatEvents(taskId),
      sessionId: (taskId) => store.task(taskId).chatSessionId ?? null,
      saveSessionId: (taskId, id) => store.setChatSession(taskId, id),
    },
  );

  const ops: SshMcpOps = {
    list: vi.fn(async () => ({
      path: "/var/www",
      entries: [
        { name: "app", kind: "directory" as const },
        { name: "docker-compose.yml", kind: "file" as const },
      ],
      truncated: false,
    })),
    read: vi.fn(async () => "server { listen 80; }"),
    run: vi.fn(async (_conn, cmd) => `saida:${cmd}`),
    summary: vi.fn(async () => "=== SISTEMA ===\nUbuntu 24.04"),
    ...opsOverrides,
  };

  const server = new SshMcp(
    store,
    join(mkdtempSync(join(tmpdir(), "golfinho-ssh-mcp-")), "ssh-mcp"),
    () => "segredo-do-cofre",
    (taskId, req) => chat.requestApproval(taskId, req),
    ops,
  );
  await server.start();
  running.push(server);
  return { store, task, chat, server, ops, liveEvents };
}

async function connect(url: string, token: string) {
  const client = new Client({ name: "teste-ssh", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  running.push({ stop: () => client.close() });
  return client;
}

const textOf = (result: unknown) =>
  ((result as { content: { text: string }[] }).content ?? []).map((part) => part.text).join("\n");

describe("servidor MCP de análise SSH", () => {
  it("recusa token errado, tarefa desconhecida e escreve mcp_config.json para o Antigravity", async () => {
    const { server, task } = await setup();
    const endpoint = server.endpoint(task.id)!;
    const post = (target: string, token: string) =>
      fetch(target, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await post(endpoint.url, "errado")).status).toBe(401);
    expect((await post(endpoint.url.replace(task.id, "00000000-0000-4000-8000-000000000000"), server.token)).status).toBe(404);
    expect(new URL(endpoint.url).hostname).toBe("127.0.0.1");

    const configPath = join(endpoint.agyDir, ".agents", "mcp_config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.mcpServers.golfinho_ssh).toMatchObject({
      serverUrl: endpoint.url,
      headers: { Authorization: `Bearer ${endpoint.token}` },
      timeoutSeconds: 600,
    });
    if (process.platform !== "win32") expect(statSync(configPath).mode & 0o077).toBe(0);
  });

  it("expõe apenas servidores liberados e bloqueia servidores privados", async () => {
    const { server, task, ops } = await setup();
    const endpoint = server.endpoint(task.id)!;
    const client = await connect(endpoint.url, endpoint.token);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["ssh_arquivos", "ssh_executar", "ssh_ler", "ssh_resumo", "ssh_servidores"]);

    const listed = textOf(await client.callTool({ name: "ssh_servidores", arguments: {} }));
    expect(listed).toContain("Produção");
    expect(listed).not.toContain("Financeiro");
    expect(listed).not.toContain("segredo-do-cofre");

    const summary = textOf(await client.callTool({ name: "ssh_resumo", arguments: { servidor: "Produção" } }));
    expect(summary).toContain("Ubuntu 24.04");
    expect(ops.summary).toHaveBeenCalledWith(allowedServer, "segredo-do-cofre");

    const files = textOf(await client.callTool({ name: "ssh_arquivos", arguments: { servidor: "Produção", caminho: "/var/www" } }));
    expect(files).toContain("app/");
    expect(files).toContain("docker-compose.yml");

    const content = textOf(await client.callTool({ name: "ssh_ler", arguments: { servidor: "Produção", caminho: "/etc/nginx/site.conf" } }));
    expect(content).toContain("listen 80");

    const blocked = await client.callTool({ name: "ssh_resumo", arguments: { servidor: "Financeiro" } });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toContain("não encontrado ou não liberado");
  });

  it("ssh_executar sempre exige confirmação no chat antes de rodar o comando", async () => {
    const { server, task, chat, ops, liveEvents } = await setup();
    const endpoint = server.endpoint(task.id)!;
    const client = await connect(endpoint.url, endpoint.token);

    // Primeira chamada: usuário nega → comando nunca roda.
    const deniedPromise = client.callTool({
      name: "ssh_executar",
      arguments: { servidor: "Produção", comando: "rm -rf /tmp/x" },
    });
    await vi.waitFor(() => expect(liveEvents.some((e) => e.event.type === "approval")).toBe(true));
    const firstApproval = liveEvents.find((e) => e.event.type === "approval")!.event as Extract<ChatEvent, { type: "approval" }>;
    expect(firstApproval).toMatchObject({
      toolName: "SSH · Produção",
      summary: "rm -rf /tmp/x",
      canAlwaysAllow: false,
    });
    chat.decide(task.id, firstApproval.id, "deny", false);
    const deniedResult = await deniedPromise;
    expect(deniedResult.isError).toBe(true);
    expect(textOf(deniedResult)).toContain("negado");
    expect(ops.run).not.toHaveBeenCalled();

    // Segunda chamada: pede confirmação de novo e executa quando permitido.
    const allowedPromise = client.callTool({
      name: "ssh_executar",
      arguments: { servidor: "Produção", comando: "docker ps" },
    });
    await vi.waitFor(() => expect(liveEvents.filter((e) => e.event.type === "approval")).toHaveLength(2));
    const secondApproval = liveEvents.filter((e) => e.event.type === "approval")[1].event as Extract<ChatEvent, { type: "approval" }>;
    expect(secondApproval.canAlwaysAllow).toBe(false);
    chat.decide(task.id, secondApproval.id, "allow", false);
    const allowedResult = await allowedPromise;
    expect(allowedResult.isError).not.toBe(true);
    expect(textOf(allowedResult)).toBe("saida:docker ps");
    expect(ops.run).toHaveBeenCalledWith(allowedServer, "docker ps", "segredo-do-cofre");
  });

  it("gera nota de prompt apenas com servidores liberados", () => {
    expect(sshPromptNote([privateServer])).toBeNull();
    const note = sshPromptNote([allowedServer, privateServer]);
    expect(note).toContain("Produção");
    expect(note).not.toContain("Financeiro");
    expect(note).toContain("ssh_executar");
  });
});
