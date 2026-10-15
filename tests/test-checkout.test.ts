import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
function setup() {
  const root = mkdtempSync(join(tmpdir(), "golfinho-test-checkout-"));
  const repo = join(root, "repo");
  run(root, "init", "-b", "develop", "repo");
  run(repo, "config", "user.email", "t@t.test");
  run(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "a.txt"), "a\n");
  run(repo, "add", "-A");
  run(repo, "commit", "-qm", "base");
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: repo, remotes: ["origin"] });
  const task = store.createTask({
    projectId: "p",
    branch: "golfinho/t",
    title: "t",
    prompt: "x",
    provider: "codex",
    base: "develop",
    remote: "origin",
    timeoutMinutes: 0,
  });
  const dir = join(root, "wt");
  run(repo, "worktree", "add", "--no-track", "-b", "golfinho/t", dir, "develop");
  writeFileSync(join(dir, "feito.txt"), "tarefa\n");
  run(dir, "add", "-A");
  run(dir, "commit", "-qm", "feat: tarefa");
  store.update(task.id, { branchCreated: true, worktreePath: dir, baseCommit: "x" }, "x");
  const coordinator = { exclusive: async (_id: string, op: () => Promise<unknown>) => op() } as unknown as Coordinator;
  const service = new Service(store, new GitService(), coordinator, {} as never, () => {}, async () => null);
  return { root, repo, dir, store, service, task };
}
it("coloca a pasta do projeto no código da tarefa, guarda a branch original e volta", async () => {
  const f = setup();
  try {
    await f.service.request({ action: "testActivate", taskId: f.task.id });
    expect(run(f.repo, "branch", "--show-current")).toBe("");
    expect(run(f.repo, "rev-parse", "HEAD")).toBe(run(f.dir, "rev-parse", "HEAD"));
    expect(f.store.task(f.task.id).testCheckout?.branch).toBe("develop");
    await expect(f.service.request({ action: "testActivate", taskId: f.task.id })).rejects.toThrow(/já está em teste/);
    // Excluir não pode acontecer enquanto a pasta do projeto está em teste.
    await expect(f.service.request({ action: "deleteTask", taskId: f.task.id })).rejects.toThrow(/Volte antes de excluir/);
    await f.service.request({ action: "testRestore", taskId: f.task.id });
    expect(run(f.repo, "branch", "--show-current")).toBe("develop");
    expect(f.store.task(f.task.id).testCheckout).toBeNull();
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("recusa colocar em teste com alterações não commitadas na pasta do projeto", async () => {
  const f = setup();
  try {
    writeFileSync(join(f.repo, "a.txt"), "mudado\n");
    await expect(f.service.request({ action: "testActivate", taskId: f.task.id })).rejects.toThrow(/não commitadas/);
    expect(run(f.repo, "branch", "--show-current")).toBe("develop");
    expect(f.store.task(f.task.id).testCheckout ?? null).toBeNull();
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
