import { it, expect } from "vitest";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import type { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
function setup() {
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: "/repo", remotes: ["origin"] });
  const task = store.createTask({
    projectId: "p",
    branch: "golfinho/a",
    title: "a",
    prompt: "x",
    provider: "codex",
    base: "main",
    remote: "origin",
    timeoutMinutes: 0,
  });
  store.update(task.id, { branchCreated: true, baseCommit: "abc" }, "x");
  const git = {
    review: async () => ({ files: [], overlaps: [], branch: "golfinho/a" }),
  } as unknown as GitService;
  const coordinator = {
    // A execução segura o bloqueio da pasta; a leitura não deve pedi-lo.
    exclusive: async () => {
      throw new Error("Repositório ocupado por uma execução ou operação.");
    },
  } as unknown as Coordinator;
  const service = new Service(store, git, coordinator, {} as never, () => {}, async () => null);
  return { store, service, task };
}
it("mostra a diff enquanto a CLI roda, sem pedir o bloqueio nem mudar o estado", async () => {
  const { store, service, task } = setup();
  store.transition(task.id, "queued", "x");
  store.transition(task.id, "running", "x");
  const review = await service.request({ action: "review", taskId: task.id });
  expect(review).toMatchObject({ branch: "golfinho/a" });
  expect(store.task(task.id).status).toBe("running");
  store.close();
});
it("aguardando também pode ler a diff, sem mudar o estado", async () => {
  const { store, service, task } = setup();
  store.transition(task.id, "queued", "x");
  store.transition(task.id, "running", "x");
  store.transition(task.id, "waiting", "x");
  await expect(service.request({ action: "review", taskId: task.id })).resolves.toBeTruthy();
  expect(store.task(task.id).status).toBe("waiting");
  store.close();
});
