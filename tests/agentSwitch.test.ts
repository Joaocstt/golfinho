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

function setup(status: "review" | "running" = "review") {
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
  const chat = { stop: vi.fn(), record: vi.fn() } as unknown as ChatManager;
  const service = new Service(
    store,
    {} as GitService,
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
