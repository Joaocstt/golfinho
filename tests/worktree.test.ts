import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitService } from "../src/main/git";
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "golfinho-worktree-"));
  const repo = join(root, "repo");
  run(root, "init", "-b", "main", "repo");
  run(repo, "config", "user.email", "test@example.test");
  run(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "hello.txt"), "old\n");
  run(repo, "add", ".");
  run(repo, "commit", "-m", "initial");
  // Trabalho não commitado na pasta principal: nenhuma tarefa pode tocá-lo.
  writeFileSync(join(repo, "hello.txt"), "trabalho do usuário\n");
  return { root, repo, dir: (name: string) => join(root, "worktrees", name), git: new GitService() };
}
it("creates a task in its own folder and leaves the main checkout untouched", async () => {
  const f = fixture();
  try {
    const dir = f.dir("login");
    const base = await f.git.prepareWorktree(f.repo, dir, "golfinho/login", "main", false);
    expect(base).toBe(run(f.repo, "rev-parse", "main"));
    expect(run(dir, "branch", "--show-current")).toBe("golfinho/login");
    expect(run(f.repo, "branch", "--show-current")).toBe("main");
    expect(readFileSync(join(f.repo, "hello.txt"), "utf8")).toBe("trabalho do usuário\n");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("reuses the folder when it already holds the branch, and refuses another branch", async () => {
  const f = fixture();
  try {
    const dir = f.dir("reuse");
    const base = await f.git.prepareWorktree(f.repo, dir, "golfinho/reuse", "main", false);
    expect(await f.git.prepareWorktree(f.repo, dir, "golfinho/reuse", base, true)).toBe(base);
    run(dir, "checkout", "-b", "outra");
    await expect(f.git.prepareWorktree(f.repo, dir, "golfinho/reuse", base, true)).rejects.toThrow(
      /não está na branch/,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("reattaches an existing branch when its folder was removed", async () => {
  const f = fixture();
  try {
    const dir = f.dir("volta");
    const base = await f.git.prepareWorktree(f.repo, dir, "golfinho/volta", "main", false);
    await f.git.removeWorktree(f.repo, dir);
    expect(existsSync(dir)).toBe(false);
    await f.git.prepareWorktree(f.repo, dir, "golfinho/volta", base, true);
    expect(run(dir, "branch", "--show-current")).toBe("golfinho/volta");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("refuses to remove a folder with uncommitted work, then removes it cleanly", async () => {
  const f = fixture();
  try {
    const dir = f.dir("sujo");
    await f.git.prepareWorktree(f.repo, dir, "golfinho/sujo", "main", false);
    writeFileSync(join(dir, "novo.txt"), "rascunho\n");
    expect(await f.git.uncommitted(dir)).toBe(1);
    await expect(f.git.removeWorktree(f.repo, dir)).rejects.toThrow();
    expect(existsSync(join(dir, "novo.txt"))).toBe(true);

    run(dir, "add", "novo.txt");
    run(dir, "commit", "-m", "rascunho");
    expect(await f.git.uncommitted(dir)).toBe(0);
    await f.git.removeWorktree(f.repo, dir);
    expect(existsSync(dir)).toBe(false);
    // Sem a pasta presa, a branch pode ser apagada normalmente.
    await f.git.deleteBranch(f.repo, "golfinho/sujo", "main");
    expect(run(f.repo, "branch", "--list", "golfinho/sujo")).toBe("");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("creates worktrees for the same repository in parallel without colliding", async () => {
  const f = fixture();
  try {
    const dirs = ["a", "b", "c"].map((n) => f.dir(n));
    await Promise.all(
      dirs.map((dir, i) =>
        f.git.prepareWorktree(f.repo, dir, `golfinho/p${i}`, "main", false),
      ),
    );
    for (const [i, dir] of dirs.entries())
      expect(run(dir, "branch", "--show-current")).toBe(`golfinho/p${i}`);
    expect(run(f.repo, "worktree", "list", "--porcelain").match(/^worktree /gm)?.length).toBe(4);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
