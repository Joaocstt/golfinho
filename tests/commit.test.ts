import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
import type { Shells } from "../src/main/shells";
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
function setup() {
  const root = mkdtempSync(join(tmpdir(), "golfinho-commit-"));
  const repo = join(root, "repo");
  run(root, "init", "-b", "main", "repo");
  run(repo, "config", "user.email", "t@t.test");
  run(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "a.txt"), "a\n");
  run(repo, "add", "-A");
  run(repo, "commit", "-qm", "base");
  const store = new Store(":memory:");
  store.addProject({ id: "p", name: "Repo", path: repo, remotes: ["origin"] });
  // Executável sempre presente: o teste não depende de a CLI estar instalada na máquina.
  store.saveSettings({ ...store.settings(), executables: { ...store.settings().executables, codex: "/bin/sh" } });
  const task = store.createTask({
    projectId: "p",
    branch: "golfinho/c",
    title: "c",
    prompt: "x",
    provider: "codex",
    base: "main",
    remote: "origin",
    timeoutMinutes: 0,
  });
  const dir = join(root, "wt");
  run(repo, "worktree", "add", "--no-track", "-b", "golfinho/c", dir, "main");
  store.update(task.id, { branchCreated: true, worktreePath: dir }, "x");
  const opened: { cwd: string; args: string[] }[] = [];
  const shells = {
    open: async (_t: string, cwd: string, _c: string, args: string[]) => {
      opened.push({ cwd, args });
      return "shell-1";
    },
  } as unknown as Shells;
  const service = new Service(
    store,
    new GitService(),
    {} as Coordinator,
    {} as never,
    () => {},
    async () => null,
    undefined,
    shells,
  );
  return { root, dir, store, service, task, opened };
}
it("conta as alterações sem commit na pasta da tarefa", async () => {
  const f = setup();
  try {
    expect(await f.service.request({ action: "uncommitted", taskId: f.task.id })).toBe(0);
    writeFileSync(join(f.dir, "novo.txt"), "x\n");
    expect(await f.service.request({ action: "uncommitted", taskId: f.task.id })).toBe(1);
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("envia o pedido de commit ao agente já na abertura, na pasta da tarefa", async () => {
  const f = setup();
  try {
    await f.service.request({
      action: "shellOpen",
      taskId: f.task.id,
      provider: "codex",
      prompt: "faça os commits",
    });
    expect(f.opened[0].cwd).toBe(f.dir);
    expect(f.opened[0].args).toContain("faça os commits");
    expect(f.store.events(f.task.id).some((e) => /pedido enviado/i.test(e.message))).toBe(true);
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("recusa pedido de commit sem agente escolhido", async () => {
  const f = setup();
  try {
    await expect(
      f.service.request({ action: "shellOpen", taskId: f.task.id, prompt: "commit" }),
    ).rejects.toThrow(/Escolha um agente/);
  } finally {
    f.store.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
