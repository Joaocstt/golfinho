import { describe, it, expect } from "vitest";
import { Store } from "../src/main/store";

describe("busca em todas as conversas do chat", () => {
  it("encontra mensagens entre projetos ignorando acentos e priorizando a tarefa atual", () => {
    const store = new Store(":memory:");
    store.addProject({ id: "p1", name: "Golfinho", path: "/repo/a", remotes: ["origin"] });
    store.addProject({ id: "p2", name: "Infra", path: "/repo/b", remotes: ["origin"] });
    const t1 = store.createTask({
      projectId: "p1",
      title: "Interface do chat",
      prompt: "chat",
      provider: "antigravity",
      branch: "b1",
      base: "main",
      remote: "origin",
      timeoutMinutes: 0,
    });
    const t2 = store.createTask({
      projectId: "p2",
      title: "Servidor produção",
      prompt: "ssh",
      provider: "claude",
      branch: "b2",
      base: "main",
      remote: "origin",
      timeoutMinutes: 0,
    });

    const s1 = store.chatAppend(t1.id, { type: "user", text: "Ajustar conexão de produção no painel" });
    const s2 = store.chatAppend(t2.id, {
      type: "assistant",
      blocks: [{ kind: "text", text: "O servidor de produção respondeu em /etc/nginx/default.conf" }],
    });

    const hits = store.searchAllChats("producao", { currentTaskId: t1.id });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ taskId: t1.id, taskTitle: "Interface do chat", projectName: "Golfinho", seq: s1 });
    expect(hits[1]).toMatchObject({ taskId: t2.id, taskTitle: "Servidor produção", projectName: "Infra", seq: s2 });

    // Busca parcial em caminho de arquivo também funciona.
    const pathHits = store.searchAllChats("nginx/default");
    expect(pathHits).toHaveLength(1);
    expect(pathHits[0].taskId).toBe(t2.id);
    store.close();
  });
});
