import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/store";
const input = {
  projectId: "p",
  title: "Teste",
  prompt: "Analise",
  provider: "codex" as const,
  branch: "golfinho/teste",
  base: "main",
  remote: "origin",
  timeoutMinutes: 0,
};
describe("persistent tasks", () => {
  it("guarda o modelo escolhido no chat e mantém a sessão para retomar", () => {
    const store = new Store(":memory:");
    store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
    const t = store.createTask(input);
    store.setChatSession(t.id, "sessao-1");
    store.setModel(t.id, "opus");
    expect(store.task(t.id).model).toBe("opus");
    expect(store.task(t.id).chatSessionId).toBe("sessao-1");
    store.close();
  });
  it("permite voltar uma tarefa concluída para a fila", () => {
    const store = new Store(":memory:");
    store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
    const t = store.createTask(input);
    store.transition(t.id, "queued", "Na fila");
    store.transition(t.id, "running", "Rodando");
    store.transition(t.id, "review", "Revisão");
    store.transition(t.id, "completed", "Concluída");
    store.transition(t.id, "queued", "Voltou para a fila");
    expect(store.task(t.id).status).toBe("queued");
    store.close();
  });
  it("writes state and sequenced events atomically and rejects invalid transitions", () => {
    const store = new Store(":memory:");
    store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
    const t = store.createTask(input);
    store.transition(t.id, "queued", "Na fila");
    expect(() => store.transition(t.id, "completed", "Too soon")).toThrow();
    expect(store.task(t.id).status).toBe("queued");
    expect(store.events(t.id).map((e) => e.sequence)).toEqual([1, 2]);
    store.close();
  });
  it("reopens tasks and marks abandoned running checks and tasks interrupted without relaunch", () => {
    const dir = mkdtempSync(join(tmpdir(), "golfinho-store-"));
    const db = join(dir, "data.db");
    try {
      let s = new Store(db);
      s.addProject({ id: "p", name: "Repo", path: "/repo", remotes: [] });
      const t = s.createTask(input);
      s.transition(t.id, "queued", "Fila");
      s.transition(t.id, "running", "Executando");
      s.addCheck(t.id, "npm test");
      s.close();
      s = new Store(db);
      s.recover();
      expect(s.task(t.id).status).toBe("interrupted");
      expect(s.checks(t.id)[0].status).toBe("interrupted");
      expect(s.events(t.id).at(-1)?.kind).toBe("interrupted");
      s.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("requires successful checks before completing a reviewed task", () => {
    const s = new Store(":memory:");
    s.addProject({ id: "p", name: "Repo", path: "/repo", remotes: [] });
    const t = s.createTask(input);
    s.transition(t.id, "queued", "");
    s.transition(t.id, "running", "");
    s.transition(t.id, "review", "");
    const c = s.addCheck(t.id, "false");
    s.finishCheck(c.id, 1, "erro");
    expect(() => s.complete(t.id)).toThrow(/checks/i);
    s.close();
  });
  it("keeps older failed check commands in the completion decision and rejects stale revisions", () => {
    const s = new Store(":memory:");
    s.addProject({ id: "p", name: "Repo", path: "/repo", remotes: [] });
    const t = s.createTask(input);
    s.transition(t.id, "queued", "");
    s.transition(t.id, "running", "");
    s.transition(t.id, "review", "");
    const bad = s.addCheck(t.id, "important");
    s.finishCheck(bad.id, 1, "error");
    for (let i = 0; i < 31; i++) {
      const c = s.addCheck(t.id, `command-${i}`);
      s.finishCheck(c.id, 0, "ok", false, "old");
    }
    expect(() => s.complete(t.id)).toThrow(/checks/i);
    const fixed = s.addCheck(t.id, "important");
    s.finishCheck(fixed.id, 0, "ok", false, "old");
    expect(() => s.complete(t.id, "changed")).toThrow(/desatualizados/i);
    s.close();
  });
});

it("remove a tarefa com seus eventos e checks", () => {
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
  const task = store.createTask({
    projectId: "p",
    title: "descartar",
    prompt: "x",
    provider: "codex",
    branch: "golfinho/descartar",
    base: "main",
    remote: "origin",
    timeoutMinutes: 0,
  });
  const check = store.addCheck(task.id, "npm test");
  store.finishCheck(check.id, 0, "ok");
  expect(store.events(task.id).length).toBeGreaterThan(0);
  store.deleteTask(task.id);
  expect(store.tasks()).toHaveLength(0);
  expect(store.events(task.id)).toHaveLength(0);
  expect(store.checks(task.id)).toHaveLength(0);
  expect(() => store.task(task.id)).toThrow(/não encontrada/i);
  store.close();
});

describe("tarefa sem título", () => {
  it("usa o nome da branch como título quando ele vem vazio", () => {
    const store = new Store(":memory:");
    store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
    const t = store.createTask({ ...input, title: "", prompt: "" });
    expect(t.title).toBe("golfinho/teste");
    expect(t.prompt).toBe("");
    store.close();
  });
});

describe("configurações", () => {
  it("preenche o setup por projeto em configurações salvas antes desse campo existir", () => {
    const store = new Store(":memory:");
    store.saveSettings({
      concurrency: 3,
      executables: { codex: "codex", claude: "claude", antigravity: "agy" },
    } as never);
    expect(store.settings().setup).toEqual({});
    expect(store.settings().concurrency).toBe(3);
    store.close();
  });
});
