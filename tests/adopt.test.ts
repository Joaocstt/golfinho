import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
  const root = mkdtempSync(join(tmpdir(), "golfinho-adopt-"));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  run(root, "init", "--bare", "-q", remote);
  run(root, "init", "-b", "develop", "repo");
  run(repo, "config", "user.email", "t@t.test");
  run(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "a.txt"), "a\n");
  run(repo, "add", "-A");
  run(repo, "commit", "-qm", "base");
  run(repo, "remote", "add", "origin", remote);
  run(repo, "branch", "feature/login");
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: repo, remotes: ["origin"] });
  const coordinator = { exclusive: async (_i: string, op: () => Promise<unknown>) => op(), pump() {} } as unknown as Coordinator;
  const service = new Service(store, new GitService(), coordinator, { remove() {} } as never, () => {}, async () => null);
  const create = (branch: string, adopt: boolean) =>
    service.request({
      action: "createTask",
      input: {
        projectId: "p",
        title: "",
        prompt: "",
        provider: "codex",
        branch,
        base: "develop",
        remote: "origin",
        timeoutMinutes: 0,
        ...(adopt ? { adopt: true } : {}),
      },
    });
  return { root, repo, store, service, create, coordinator };
}
it("cria a tarefa sobre a branch existente, com base no commit atual dela", async () => {
  const f = setup();
  try {
    const task = (await f.create("feature/login", true)) as { id: string; branch: string; adoptedBranch: boolean; baseCommit: string | null };
    expect(task.branch).toBe("feature/login");
    expect(task.adoptedBranch).toBe(true);
    expect(task.baseCommit).toBe(run(f.repo, "rev-parse", "feature/login"));
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("recusa branch que não existe ou que já está aberta na pasta do projeto", async () => {
  const f = setup();
  try {
    await expect(f.create("nao-existe", true)).rejects.toThrow(/não existe localmente/);
    run(f.repo, "switch", "feature/login");
    await expect(f.create("feature/login", true)).rejects.toThrow(/já está aberta em/);
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("excluir a tarefa remove a pasta, mas mantém a branch que já existia", async () => {
  const f = setup();
  try {
    const task = (await f.create("feature/login", true)) as { id: string };
    // Simula a pasta própria que o agendamento criaria, sem rodar a CLI.
    const dir = join(f.root, "wt");
    run(f.repo, "worktree", "add", dir, "feature/login");
    f.store.update(task.id, { worktreePath: dir, branchCreated: true }, "x");
    await f.service.request({ action: "deleteTask", taskId: task.id });
    expect(existsSync(dir)).toBe(false);
    expect(run(f.repo, "branch", "--list", "feature/login")).toContain("feature/login");
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
