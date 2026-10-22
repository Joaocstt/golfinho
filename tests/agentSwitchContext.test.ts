import { describe, it, expect, vi } from "vitest";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import type { ChatManager } from "../src/main/chat";
import type { Coordinator } from "../src/main/coordinator";
import type { GitService } from "../src/main/git";
import type { ChatEvent } from "../src/shared/contracts";
import { currentContext } from "../src/shared/chatContext";

// Troca de agente com o histórico real do chat (não mockado): o que o usuário vê depois da
// troca depende do que foi gravado antes e do que o novo agente grava depois.
const installed = process.execPath;

function setup() {
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
  store.saveSettings({
    ...store.settings(),
    executables: { codex: installed, claude: installed, antigravity: "/caminho/inexistente/agy" },
  });
  const task = store.createTask({
    projectId: "p",
    title: "Teste",
    prompt: "Analise",
    provider: "claude",
    branch: "golfinho/teste",
    base: "main",
    remote: "origin",
    timeoutMinutes: 0,
  });
  store.update(task.id, { sessionId: "cli-1" }, "teste");
  store.transition(task.id, "queued", "teste");
  store.transition(task.id, "running", "teste");
  store.transition(task.id, "review", "teste");
  store.setChatSession(task.id, "chat-1");
  // Conversa com Claude: uso de contexto alto, como no fim de uma conversa longa.
  store.chatAppend(task.id, { type: "context", used: 150_000, limit: 200_000 });
  const git = {
    review: async () => ({ files: [], overlaps: [], branch: "golfinho/teste" }),
    requireCurrent: async () => {},
  } as unknown as GitService;
  const chat = {
    stop: vi.fn(),
    record: (taskId: string, event: ChatEvent) => store.chatAppend(taskId, event),
    history: vi.fn(() => []),
    send: vi.fn(),
    isFresh: vi.fn(() => true),
  } as unknown as ChatManager;
  const service = new Service(
    store,
    git,
    {} as Coordinator,
    {} as never,
    () => {},
    async () => null,
    undefined,
    undefined,
    undefined,
    chat,
  );
  return { store, service, task };
}

// Mesmo critério que a barra do chat usa.
function lastContext(store: Store, taskId: string) {
  return currentContext(store.chatEvents(taskId).map((item) => item.event));
}

describe("contexto depois da troca de agente", () => {
  it("a barra não mostra o uso do agente antigo depois da troca", async () => {
    const { store, service, task } = setup();
    expect(lastContext(store, task.id)).toBeTruthy();
    await service.request({ action: "setTaskAgent", taskId: task.id, provider: "codex" });
    // O Codex ainda não respondeu: não há uso de contexto dele para mostrar.
    expect(lastContext(store, task.id)).toBeUndefined();
    store.close();
  });

  it("depois da troca, o uso de contexto volta a vir do novo agente", async () => {
    const { store, service, task } = setup();
    await service.request({ action: "setTaskAgent", taskId: task.id, provider: "codex" });
    store.chatAppend(task.id, { type: "context", used: 12_000, limit: 200_000 });
    expect(lastContext(store, task.id)).toEqual({ type: "context", used: 12_000, limit: 200_000 });
    store.close();
  });
});
