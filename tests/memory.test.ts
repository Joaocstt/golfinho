import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import { invocation } from "../src/main/agents";
import { ftsQuery, memoryPackage, taskDigest, titleFrom, withMemory } from "../src/main/memory";
import type { ChatManager } from "../src/main/chat";
import type { Coordinator } from "../src/main/coordinator";
import type { GitService } from "../src/main/git";
import type { Memory, MemoryInput } from "../src/shared/contracts";

const note = (patch: Partial<MemoryInput> = {}): MemoryInput => ({
  projectId: "p",
  kind: "decisao",
  title: "Migração do banco",
  content: "Usamos migrations versionadas; nunca alterar o schema à mão.",
  pinned: false,
  archived: false,
  ...patch,
});
function store() {
  const s = new Store(":memory:");
  s.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
  s.addProject({ id: "q", name: "Outro", path: "/outro", remotes: ["origin"] });
  return s;
}

describe("consulta e pacote da memória", () => {
  it("transforma texto livre em termos entre aspas, sem operadores do FTS", () => {
    expect(ftsQuery('corrigir login NOT "admin" (urgente)*')).toBe('"corrigir" OR "login" OR "not" OR "admin" OR "urgente"');
    expect(ftsQuery("a de um")).toBeNull();
  });
  it("monta o pacote dentro do limite e só fala das ferramentas quando elas existem", () => {
    const memories = [{ kind: "convencao", title: "Testes", content: "Use vitest." }] as Memory[];
    expect(memoryPackage([], false)).toBeNull();
    expect(memoryPackage([], true)).toContain("memoria_salvar");
    expect(memoryPackage(memories, false)).toContain("- [convenção] Testes: Use vitest.");
    expect(memoryPackage(memories, false)).not.toContain("memoria_buscar");
    expect(memoryPackage(memories, true)).toContain("memoria_buscar");
    // Acima do limite, as notas seguintes vão só pelo título e id: nenhuma fica de fora.
    const many = [
      { id: "a", kind: "contexto", title: "Primeira", content: "y".repeat(600) },
      { id: "b", kind: "decisao", title: "Segunda", content: "z".repeat(600) },
    ] as Memory[];
    const cut = memoryPackage(many, true, 1400)!;
    expect(cut).toContain("Primeira: yyy");
    expect(cut).toContain("- [decisão] Segunda (id b)");
    expect(cut).not.toContain("zzz");
    expect(withMemory("M", "pedido")).toBe("M\n\n---\n\npedido");
    expect(withMemory(null, "pedido")).toBe("pedido");
  });
  it("registra a tarefa com pedido, conclusão, arquivos e checks", () => {
    const digest = taskDigest({
      title: "Login",
      prompt: "Corrija o login",
      history: [{ event: { type: "assistant", blocks: [{ kind: "text", text: "Corrigido no auth.ts." }] } }],
      files: ["src/auth.ts", "src/auth.ts"],
      checks: [{ command: "npm test", status: "passed" }],
    });
    expect(digest).toContain("Corrija o login");
    expect(digest).toContain("Corrigido no auth.ts.");
    const chat = taskDigest({
      agent: "Claude Code",
      title: "Login",
      prompt: "x",
      history: [
        { event: { type: "user", text: "use bcrypt" } },
        { event: { type: "assistant", blocks: [{ kind: "tool", name: "Edit", summary: "src/auth.ts" }] } },
        { event: { type: "assistant", blocks: [{ kind: "text", text: "Hash trocado." }] } },
        { event: { type: "agent_changed", from: "Claude Code", to: "Codex" } },
        { event: { type: "user", text: "e mantenha o\nlimite de 5 tentativas" } },
        { event: { type: "assistant", blocks: [{ kind: "text", text: "Limite mantido." }] } },
      ],
      files: [],
      checks: [],
    });
    expect(chat).toContain(
      [
        "Linha do tempo (5 entrada(s)):",
        "[você] use bcrypt",
        "[Claude Code] Hash trocado. (ferramentas: Edit src/auth.ts)",
        "── troca de Claude Code para Codex ──",
        "[você] e mantenha o limite de 5 tentativas",
        "[Codex] Limite mantido.",
      ].join("\n"),
    );
    const flood = taskDigest({
      title: "t",
      prompt: "x",
      history: Array.from({ length: 60 }, (_, i) => ({ event: { type: "user" as const, text: `m${i} ${"a".repeat(700)}` } })),
      files: [],
      checks: [],
    });
    expect(flood).toContain("[você] m59 ");
    expect(flood).not.toContain("m0 ");
    expect(flood).toMatch(/\(… \d+ entrada\(s\) anterior\(es\); o histórico completo está em memoria_buscar\)/);
    expect(flood.length).toBeLessThanOrEqual(8000);
    expect(titleFrom("\n## Resumo da mudança\nmais texto")).toBe("Resumo da mudança");
  });
});

describe("memória no banco", () => {
  it("busca sem acento e mantém o índice ao editar e excluir", () => {
    const s = store();
    const m = s.saveMemory(note());
    expect(s.memories("p", { query: "migracao" }).map((x) => x.id)).toEqual([m.id]);
    s.saveMemory({ ...note({ title: "Cache", content: "Redis com TTL de 5 minutos." }), id: m.id });
    expect(s.memories("p", { query: "migracao" })).toEqual([]);
    expect(s.memories("p", { query: "redis" })).toHaveLength(1);
    s.deleteMemory(m.id);
    expect(s.memories("p", { query: "redis" })).toEqual([]);
    expect(s.memories("p")).toEqual([]);
  });
  it("separa projetos, deixa arquivadas de fora e põe as fixadas primeiro", () => {
    const s = store();
    s.saveMemory(note({ projectId: "q" }));
    const archived = s.saveMemory(note({ title: "Migração antiga", archived: true }));
    const pinned = s.saveMemory(note({ title: "Regra geral", content: "Sem relação.", pinned: true }));
    const found = s.saveMemory(note());
    const relevant = s.relevantMemories("p", "rodar a migração do banco", 8).map((m) => m.id);
    expect(relevant).toEqual([pinned.id, found.id]);
    expect(relevant).not.toContain(archived.id);
    expect(s.memories("p", { archived: true }).map((m) => m.id)).toEqual([archived.id]);
    // Todas as ativas vão para o agente: fixadas, relacionadas e depois as demais.
    const other = s.saveMemory(note({ title: "Deploy", content: "Sem relação com banco." }));
    const all = s.orderedMemories("p", "rodar a migração do banco").map((m) => m.id);
    expect(all.slice(0, 2)).toEqual([pinned.id, found.id]);
    expect(all).toContain(other.id);
    expect(all).not.toContain(archived.id);
  });
  it("guarda uma nota automática por tarefa e conta o uso", () => {
    const s = store();
    const task = s.createTask({
      projectId: "p",
      title: "Login",
      prompt: "x",
      provider: "codex",
      branch: "golfinho/login",
      base: "main",
      remote: "origin",
      timeoutMinutes: 0,
    });
    const first = s.saveTaskMemory(task, "primeira");
    const second = s.saveTaskMemory(task, "segunda");
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ kind: "tarefa", origin: "automatica", content: "segunda" });
    s.touchMemories([first.id]);
    expect(s.memory(first.id).uses).toBe(1);
  });
});

describe("histórico pesquisável", () => {
  it("indexa conversas novas e antigas e apaga com a tarefa", () => {
    const dir = mkdtempSync(join(tmpdir(), "golfinho-hist-"));
    const file = join(dir, "db.sqlite");
    const first = store();
    first.close();
    // Banco "antigo": conversa gravada e índice vazio, como antes desta versão.
    const old = new Store(file);
    old.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
    const task = old.createTask({
      projectId: "p",
      title: "Cache",
      prompt: "x",
      provider: "codex",
      branch: "golfinho/cache",
      base: "main",
      remote: "origin",
      timeoutMinutes: 0,
    });
    old.chatAppend(task.id, { type: "assistant", blocks: [{ kind: "text", text: "Usei Redis com expiração." }] });
    (old as unknown as { db: { exec(sql: string): void } }).db.exec("DELETE FROM chat_fts");
    old.close();
    const reopened = new Store(file);
    expect(reopened.searchHistory("p", "expiracao").map((h) => h.taskId)).toEqual([task.id]);
    reopened.chatAppend(task.id, { type: "user", text: "Troque para memcached" });
    expect(reopened.searchHistory("p", "memcached")).toHaveLength(1);
    expect(reopened.searchHistory("outro", "memcached")).toEqual([]);
    reopened.deleteTask(task.id);
    expect(reopened.searchHistory("p", "redis")).toEqual([]);
    reopened.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("memória na invocação das CLIs", () => {
  const mcp = { url: "http://127.0.0.1:9/mcp/t", claudeConfig: "/tmp/t.json" };
  it("liga o servidor no Claude e no Codex, também ao retomar", () => {
    expect(invocation("claude", "/repo", "x", null, mcp).args).toEqual([
      "--permission-mode", "manual", "--mcp-config", "/tmp/t.json", "--", "x",
    ]);
    expect(invocation("claude", "/repo", "x", "s1", mcp).args).toEqual([
      "--permission-mode", "manual", "--mcp-config", "/tmp/t.json", "--resume", "s1",
    ]);
    const codex = invocation("codex", "/repo", "x", "s1", mcp).args;
    expect(codex.slice(0, 2)).toEqual(["resume", "s1"]);
    expect(codex).toContain('mcp_servers.golfinho_memoria.url="http://127.0.0.1:9/mcp/t"');
    expect(codex).toContain('mcp_servers.golfinho_memoria.bearer_token_env_var="GOLFINHO_MEMORIA_TOKEN"');
  });
  it("sem servidor, os argumentos ficam como antes", () => {
    for (const provider of ["codex", "claude", "antigravity"] as const)
      expect(invocation(provider, "/repo", "x", null, null).args).toEqual(invocation(provider, "/repo", "x").args);
  });
});

describe("memória no serviço", () => {
  function setup(fresh: boolean) {
    const s = store();
    const task = s.createTask({
      projectId: "p",
      title: "Banco",
      prompt: "Ajuste a migração do banco",
      provider: "claude",
      branch: "golfinho/banco",
      base: "main",
      remote: "origin",
      timeoutMinutes: 0,
    });
    s.saveMemory(note());
    const chat = {
      send: vi.fn(),
      history: vi.fn(() => [
        { seq: 1, event: { type: "assistant", blocks: [{ kind: "text", text: "Migração ajustada." }] } },
      ]),
      isFresh: vi.fn(() => fresh),
    } as unknown as ChatManager;
    const git = {
      requireCurrent: async () => {},
      fingerprint: async () => "rev",
      review: async () => ({ files: [{ path: "db/001.sql" }], overlaps: [], branch: "golfinho/banco" }),
    } as unknown as GitService;
    const coordinator = { exclusive: (_id: string, fn: () => unknown) => fn() } as unknown as Coordinator;
    const service = new Service(s, git, coordinator, {} as never, () => {}, async () => null, undefined, undefined, undefined, chat);
    return { s, task, chat, service };
  }
  it("envia as notas só na primeira mensagem de uma conversa nova", async () => {
    const fresh = setup(true);
    await fresh.service.request({ action: "chatSend", taskId: fresh.task.id, text: "pode começar" });
    const preamble = (fresh.chat.send as ReturnType<typeof vi.fn>).mock.calls[0][4];
    expect(preamble).toContain("Migração do banco");
    expect(fresh.s.memories("p")[0].uses).toBe(1);

    const resumed = setup(false);
    await resumed.service.request({ action: "chatSend", taskId: resumed.task.id, text: "continue" });
    expect((resumed.chat.send as ReturnType<typeof vi.fn>).mock.calls[0][4]).toBeNull();
  });
  it("não envia nada com a memória desligada", async () => {
    const off = setup(true);
    off.s.saveSettings({ ...off.s.settings(), memory: { enabled: false } });
    await off.service.request({ action: "chatSend", taskId: off.task.id, text: "pode começar" });
    expect((off.chat.send as ReturnType<typeof vi.fn>).mock.calls[0][4]).toBeNull();
  });
  it("atualiza o registro da tarefa a cada etapa, numa nota só", async () => {
    vi.useFakeTimers();
    try {
      const { s, task, service } = setup(false);
      s.update(task.id, { branchCreated: true }, "teste");
      s.transition(task.id, "queued", "teste");
      s.transition(task.id, "running", "teste");
      service.remember(task.id);
      service.remember(task.id);
      await vi.runAllTimersAsync();
      let notes = s.memories("p", { kind: "tarefa" });
      expect(notes).toHaveLength(1);
      expect(notes[0].content).toContain("Situação: em andamento");
      s.transition(task.id, "review", "teste");
      service.remember(task.id);
      await vi.runAllTimersAsync();
      notes = s.memories("p", { kind: "tarefa" });
      expect(notes).toHaveLength(1);
      expect(notes[0].content).toContain("Situação: em revisão");
      expect(s.events(task.id).filter((e) => e.message.includes("registrada na memória"))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("registra a tarefa concluída e salva respostas do chat", async () => {
    const { s, task, service } = setup(false);
    s.update(task.id, { branchCreated: true }, "teste");
    s.transition(task.id, "queued", "teste");
    s.transition(task.id, "running", "teste");
    s.transition(task.id, "review", "teste");
    await service.request({ action: "finish", taskId: task.id });
    const auto = s.memories("p", { kind: "tarefa" });
    expect(auto).toHaveLength(1);
    expect(auto[0].content).toContain("db/001.sql");
    expect(auto[0].content).toContain("Migração ajustada.");

    const saved = await service.request({ action: "memoryFromChat", taskId: task.id, text: "# Decisão\nUsar UUID v7." });
    expect(saved).toMatchObject({ kind: "contexto", title: "Decisão", source: { taskId: task.id } });
  });
});
