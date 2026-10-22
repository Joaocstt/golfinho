import { describe, it, expect, vi } from "vitest";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import type { ChatManager } from "../src/main/chat";
import type { Coordinator } from "../src/main/coordinator";
import type { GitService } from "../src/main/git";

const input = {
  projectId: "p",
  title: "Teste",
  prompt: "Analise",
  provider: "claude" as const,
  branch: "golfinho/teste",
  base: "main",
  remote: "origin",
  timeoutMinutes: 0,
};

// Executável que existe de verdade, para o agente ficar "instalado" nos testes.
const installed = process.execPath;

function setup(status: "review" | "running" = "review", git: unknown = {}) {
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
  store.saveSettings({
    ...store.settings(),
    executables: { codex: installed, claude: installed, antigravity: "/caminho/inexistente/agy" },
  });
  const task = store.createTask(input);
  store.update(task.id, { sessionId: "cli-1" }, "teste");
  // Caminho válido na máquina de estados: rascunho → fila → rodando (→ revisão).
  store.transition(task.id, "queued", "teste");
  store.transition(task.id, "running", "teste");
  if (status === "review") store.transition(task.id, "review", "teste");
  store.setChatSession(task.id, "chat-1");
  const chat = {
    stop: vi.fn(),
    record: vi.fn(),
    history: vi.fn(() => []),
    send: vi.fn(),
    isFresh: vi.fn(() => true),
  } as unknown as ChatManager;
  const service = new Service(
    store,
    git as GitService,
    {} as Coordinator,
    {} as never,
    () => {},
    async () => null,
    undefined,
    undefined,
    undefined,
    chat,
  );
  return { store, service, chat, task };
}

describe("troca de agente pela tarefa", () => {
  it("troca o agente, registra a troca no chat e encerra o chat anterior", async () => {
    const { store, service, chat, task } = setup();
    await service.request({ action: "setTaskAgent", taskId: task.id, provider: "codex" });
    expect(store.task(task.id).provider).toBe("codex");
    expect(store.task(task.id).sessionId).toBeNull();
    expect(store.task(task.id).chatSessionId).toBeNull();
    expect(chat.stop).toHaveBeenCalledWith(task.id);
    expect(chat.record).toHaveBeenCalledWith(task.id, { type: "agent_changed", from: "Claude Code", to: "Codex" });
    store.close();
  });

  it("recusa a troca enquanto a tarefa está rodando", async () => {
    const { store, service, chat, task } = setup("running");
    await expect(service.request({ action: "setTaskAgent", taskId: task.id, provider: "codex" })).rejects.toThrow(
      /Aguarde a tarefa terminar/,
    );
    expect(store.task(task.id).provider).toBe("claude");
    expect(chat.record).not.toHaveBeenCalled();
    store.close();
  });

  it("recusa agente que não está instalado", async () => {
    const { store, service, chat, task } = setup();
    await expect(service.request({ action: "setTaskAgent", taskId: task.id, provider: "antigravity" })).rejects.toThrow(
      /não está instalado/,
    );
    expect(store.task(task.id).provider).toBe("claude");
    expect(chat.stop).not.toHaveBeenCalled();
    store.close();
  });

  it("escolher o mesmo agente não faz nada", async () => {
    const { store, service, chat, task } = setup();
    await service.request({ action: "setTaskAgent", taskId: task.id, provider: "claude" });
    expect(store.task(task.id).sessionId).toBe("cli-1");
    expect(chat.record).not.toHaveBeenCalled();
    store.close();
  });
});

// Serviço com um git que devolve arquivos alterados e uma branch criada, para o pacote de handoff.
function setupWithChanges(files: string[], messages: { event: unknown }[] = []) {
  const git = {
    review: async () => ({ files: files.map((path) => ({ path })), overlaps: [], branch: "golfinho/teste" }),
    requireCurrent: async () => {},
  };
  const ctx = setup("review", git);
  ctx.store.update(ctx.task.id, { branchCreated: true }, "criada");
  (ctx.chat.history as ReturnType<typeof vi.fn>).mockImplementation(() => messages);
  return ctx;
}

describe("pacote de handoff na troca de agente", () => {
  it("monta o pacote com a conversa e os arquivos e registra no chat", async () => {
    const { store, service, chat, task } = setupWithChanges(["src/login.ts"], [
      { event: { type: "user", text: "Corrija o login" } },
      { event: { type: "assistant", blocks: [{ kind: "text", text: "Já ajustei o formulário." }] } },
    ]);
    await service.request({ action: "setTaskAgent", taskId: task.id, provider: "codex" });
    const handoff = store.task(task.id).handoff as string;
    expect(handoff).toContain("Pedido original:\nAnalise");
    expect(handoff).toContain("- Corrija o login");
    expect(handoff).toContain("Já ajustei o formulário.");
    expect(handoff).toContain("- src/login.ts");
    expect(chat.record).toHaveBeenCalledWith(task.id, expect.objectContaining({ type: "agent_changed", handoff }));
    store.close();
  });

  it("sem conversa, sem arquivos e sem checks, não há pacote", async () => {
    const { store, service, chat, task } = setup();
    await service.request({ action: "setTaskAgent", taskId: task.id, provider: "codex" });
    expect(store.task(task.id).handoff).toBeNull();
    expect(chat.record).toHaveBeenCalledWith(task.id, { type: "agent_changed", from: "Claude Code", to: "Codex" });
    store.close();
  });

  it("sem branch criada, o pacote segue só com a conversa", async () => {
    const { store, service, chat, task } = setup();
    (chat.history as ReturnType<typeof vi.fn>).mockImplementation(() => [
      { event: { type: "user", text: "primeira ideia" } },
    ]);
    await service.request({ action: "setTaskAgent", taskId: task.id, provider: "codex" });
    expect(store.task(task.id).handoff).toContain("- primeira ideia");
    expect(store.task(task.id).handoff).not.toContain("Arquivos alterados");
    store.close();
  });

  it("falha ao ler o diff não impede a troca: o pacote segue sem arquivos", async () => {
    const git = { review: async () => { throw new Error("sem pasta"); }, requireCurrent: async () => {} };
    const ctx = setup("review", git);
    ctx.store.update(ctx.task.id, { branchCreated: true }, "criada");
    (ctx.chat.history as ReturnType<typeof vi.fn>).mockImplementation(() => [
      { event: { type: "user", text: "continue daqui" } },
    ]);
    await ctx.service.request({ action: "setTaskAgent", taskId: ctx.task.id, provider: "codex" });
    expect(ctx.store.task(ctx.task.id).provider).toBe("codex");
    expect(ctx.store.task(ctx.task.id).handoff).toContain("- continue daqui");
    ctx.store.close();
  });

  it("o pacote inclui os checks da tarefa", async () => {
    const { store, service, chat, task } = setup();
    store.addCheck(task.id, "npm test");
    (chat.history as ReturnType<typeof vi.fn>).mockImplementation(() => [
      { event: { type: "user", text: "siga" } },
    ]);
    await service.request({ action: "setTaskAgent", taskId: task.id, provider: "codex" });
    const handoff = store.task(task.id).handoff as string;
    expect(handoff).toContain("Verificações recentes:\n- npm test: running");
    store.close();
  });
});

describe("entrega do pacote ao chat", () => {
  it("entrega na primeira mensagem após a troca e só nela", async () => {
    const { store, service, chat, task } = setupWithChanges(["a.ts"]);
    await service.request({ action: "setTaskAgent", taskId: task.id, provider: "codex" });
    const handoff = store.task(task.id).handoff as string;
    expect(handoff).toBeTruthy();

    await service.request({ action: "chatSend", taskId: task.id, text: "pode seguir" });
    expect(chat.send).toHaveBeenLastCalledWith(task.id, expect.anything(), "pode seguir", [], handoff);
    expect(store.task(task.id).handoff).toBeNull();
    expect(store.events(task.id).at(-1)?.message).toBe("Resumo da troca de agente entregue ao chat.");

    await service.request({ action: "chatSend", taskId: task.id, text: "segunda mensagem" });
    expect(chat.send).toHaveBeenLastCalledWith(task.id, expect.anything(), "segunda mensagem", [], null);
    store.close();
  });

  it("sem pacote pendente, o chat recebe mensagem sem contexto extra", async () => {
    const { store, service, chat, task } = setup();
    await service.request({ action: "chatSend", taskId: task.id, text: "olá" });
    expect(chat.send).toHaveBeenCalledWith(task.id, expect.anything(), "olá", [], null);
    store.close();
  });
});

