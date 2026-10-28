import { it, expect } from "vitest";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import type { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
import type { Snapshot } from "../src/shared/contracts";
it("o snapshot traz a branch ativa de cada projeto e não falha se uma não puder ser lida", async () => {
  const store = new Store(":memory:");
  const ok = store.addProject({ id: "p-ok", name: "ok", path: "/repo/ok" } as never);
  const broken = store.addProject({ id: "p-quebrado", name: "quebrado", path: "/repo/quebrado" } as never);
  const git = {
    current: async (path: string) => {
      if (path === "/repo/ok") return "golfinho/teste";
      throw new Error("não é um repositório");
    },
  } as unknown as GitService;
  const coordinator = { ready: () => true } as unknown as Coordinator;
  const logs = { append() {}, replay: () => ({ data: "", nextOffset: 0 }), remove() {} };
  const service = new Service(store, git, coordinator, logs as never, () => {}, async () => null);
  const snapshot = (await service.request({ action: "snapshot" })) as Snapshot;
  expect(snapshot.activeBranches).toEqual({ [ok.id]: "golfinho/teste", [broken.id]: "" });
  store.close();
});

it("não troca a branch da pasta dividida enquanto outra tarefa dela está executando", async () => {
  const store = new Store(":memory:");
  const project = store.addProject({ id: "p", name: "p", path: "/repo/p" } as never);
  const base = { projectId: project.id, provider: "claude", prompt: "x", base: "main", remote: "origin" } as const;
  const running = store.createTask({ ...base, title: "Layout", branch: "golfinho/fix-layout" } as never);
  const other = store.createTask({ ...base, title: "develop", branch: "develop" } as never);
  for (const t of [running, other]) store.update(t.id, { branchCreated: true }, "branch criada");
  store.transition(running.id, "queued", "na fila");
  store.transition(running.id, "running", "rodando");
  const switched: string[] = [];
  const git = { prepare: async (_path: string, branch: string) => void switched.push(branch) } as unknown as GitService;
  const coordinator = { ready: () => true, exclusive: (_id: string, op: () => Promise<unknown>) => op() } as unknown as Coordinator;
  const logs = { append() {}, replay: () => ({ data: "", nextOffset: 0 }), remove() {} };
  const service = new Service(store, git, coordinator, logs as never, () => {}, async () => null);
  await expect(service.request({ action: "activate", taskId: other.id })).rejects.toThrow(/Layout.*usando a pasta/);
  expect(switched).toEqual([]);
  store.close();
});
