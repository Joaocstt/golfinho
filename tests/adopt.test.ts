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
  const coordinator = { exclusive: async (_i: string, op: () => Promise<unknown>) => op(), pump() {}, kick() {} } as unknown as Coordinator;
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
it("trabalha na branch que já está ativa na pasta do projeto, sem criar worktree", async () => {
  const f = setup();
  try {
    run(f.repo, "switch", "feature/login");
    const task = (await f.create("feature/login", true)) as { branchCreated: boolean; worktreePath: string | null; adoptedBranch: boolean };
    expect(task.adoptedBranch).toBe(true);
    expect(task.branchCreated).toBe(true);
    expect(task.worktreePath).toBeNull();
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("recusa branch que não existe ou que está aberta em outra pasta", async () => {
  const f = setup();
  try {
    await expect(f.create("nao-existe", true)).rejects.toThrow(/não existe localmente/);
    const other = join(f.root, "outra");
    run(f.repo, "worktree", "add", other, "feature/login");
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

it("publica a branch existente sem force e recusa quando o remoto está à frente", async () => {
  const f = setup();
  try {
    run(f.repo, "switch", "feature/login");
    const task = (await f.create("feature/login", true)) as { id: string };
    const publish = () => f.service.request({ action: "publish", taskId: task.id } as never);
    await publish();
    expect(run(f.repo, "ls-remote", "--heads", "origin", "feature/login")).toContain("refs/heads/feature/login");
    // Outra pessoa envia um commit para a mesma branch no remoto.
    const clone = join(f.root, "clone");
    run(f.root, "clone", "-q", "--branch", "feature/login", join(f.root, "remote.git"), clone);
    run(clone, "config", "user.email", "o@t.test");
    run(clone, "config", "user.name", "O");
    writeFileSync(join(clone, "outro.txt"), "x\n");
    run(clone, "add", "-A");
    run(clone, "commit", "-qm", "outro");
    run(clone, "push", "-q", "origin", "feature/login");
    // Commit local novo: a branch local não tem o commit do remoto.
    writeFileSync(join(f.repo, "local.txt"), "y\n");
    run(f.repo, "add", "-A");
    run(f.repo, "commit", "-qm", "local");
    await expect(publish()).rejects.toThrow(/commit\(s\) que não estão nesta branch/);
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("guarda as alterações pendentes em git stash e deixa a pasta limpa", async () => {
  const f = setup();
  try {
    const task = (await f.create("golfinho/guarda", false)) as { id: string };
    f.store.transition(task.id, "queued", "x");
    writeFileSync(join(f.repo, "sujo.txt"), "x\n");
    await f.service.request({ action: "stashPending", taskId: task.id } as never);
    expect(run(f.repo, "status", "--porcelain")).toBe("");
    expect(run(f.repo, "stash", "list")).toContain("golfinho: antes de golfinho/guarda");
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
