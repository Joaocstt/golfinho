import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { GitService } from "../src/main/git";
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "golfinho-git-"));
  const repo = join(root, "repo");
  run(root, "init", "--bare", "remote.git");
  run(root, "init", "-b", "main", "repo");
  run(repo, "config", "user.email", "test@example.test");
  run(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "hello.txt"), "old\n");
  run(repo, "add", ".");
  run(repo, "commit", "-m", "initial");
  run(repo, "remote", "add", "origin", join(root, "remote.git"));
  return { root, repo, git: new GitService() };
}
it("creates a task branch without worktrees and publishes only the selected ref", async () => {
  const f = fixture();
  try {
    const p = await f.git.inspect(f.repo);
    expect(p.remotes).toEqual(["origin"]);
    const base = await f.git.prepare(f.repo, "golfinho/task", "main", false);
    expect(run(f.repo, "branch", "--show-current")).toBe("golfinho/task");
    expect(run(f.repo, "worktree", "list", "--porcelain").match(/worktree /g)?.length).toBe(1);
    await f.git.publish(f.repo, "golfinho/task", "origin");
    expect(run(f.root, "--git-dir=remote.git", "rev-parse", "refs/heads/golfinho/task")).toBe(base);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("blocks dirty branch switches and includes untracked files in review", async () => {
  const f = fixture();
  try {
    const base = await f.git.prepare(f.repo, "golfinho/task", "main", false);
    writeFileSync(join(f.repo, "new.txt"), "new\n");
    await expect(f.git.prepare(f.repo, "golfinho/other", "main", false)).rejects.toThrow(
      /alterações/i,
    );
    const review = await f.git.review(f.repo, "golfinho/task", base);
    expect(review.files.find((f) => f.path === "new.txt")?.modified).toBe("new\n");
    await expect(f.git.read(f.repo, "../remote.git/config")).rejects.toThrow();
    symlinkSync(join(f.root, "remote.git/config"), join(f.repo, "escape"));
    await expect(f.git.read(f.repo, "escape")).rejects.toThrow();
    symlinkSync(join(f.repo, ".git/config"), join(f.repo, "metadata-alias"));
    await expect(f.git.read(f.repo, "metadata-alias")).rejects.toThrow();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("publishes to a configured option-like remote without interpreting it as a flag", async () => {
  const f = fixture();
  try {
    run(f.repo, "remote", "add", "--", "--mirror", join(f.root, "remote.git"));
    await f.git.prepare(f.repo, "golfinho/safe", "main", false);
    await f.git.publish(f.repo, "golfinho/safe", "--mirror");
    expect(run(f.root, "--git-dir=remote.git", "branch")).toContain("golfinho/safe");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("fingerprints large untracked assets and symlink identity without following targets", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, "large.bin"), Buffer.alloc(3 * 1024 * 1024, 7));
    symlinkSync("/path/that/does/not/exist", join(f.repo, "link"));
    const first = await f.git.fingerprint(f.repo);
    writeFileSync(join(f.repo, "large.bin"), Buffer.alloc(3 * 1024 * 1024, 8));
    expect(await f.git.fingerprint(f.repo)).not.toBe(first);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("fingerprints large staged assets without buffering binary patches", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, "asset.bin"), randomBytes(5 * 1024 * 1024));
    run(f.repo, "add", "asset.bin");
    expect(await f.git.fingerprint(f.repo)).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("rejects refs that are options or invalid Git branch names", async () => {
  const f = fixture();
  try {
    await expect(f.git.prepare(f.repo, "--orphan", "main", false)).rejects.toThrow();
    await expect(f.git.prepare(f.repo, "bad..ref", "main", false)).rejects.toThrow();
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("lists local branches with the active one identified and no remote refs", async () => {
  const f = fixture();
  try {
    run(f.repo, "branch", "feature/antiga");
    run(f.repo, "push", "origin", "main");
    run(f.repo, "fetch", "origin");
    run(f.repo, "switch", "-c", "feature/nova");
    const refs = await f.git.branches(f.repo);
    expect(refs.current).toBe("feature/nova");
    expect([...refs.branches].sort()).toEqual(["feature/antiga", "feature/nova", "main"]);
    // Sem fetch implícito, oferecer origin/* como base entregaria uma referência
    // possivelmente desatualizada vestida de atual.
    expect(refs.branches.some((b) => b.startsWith("origin/"))).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("deletes only golfinho branches and leaves the active checkout on the base", async () => {
  const f = fixture();
  try {
    await f.git.prepare(f.repo, "golfinho/descartavel", "main", false);
    writeFileSync(join(f.repo, "novo.txt"), "trabalho\n");
    run(f.repo, "add", ".");
    run(f.repo, "commit", "-m", "trabalho do agente");
    const status = await f.git.branchStatus(f.repo, "golfinho/descartavel", "main", "main");
    expect(status).toMatchObject({ exists: true, active: true, ahead: 1, fallback: "main" });

    // Nunca remove uma branch fora do prefixo, mesmo pedindo explicitamente.
    await expect(f.git.deleteBranch(f.repo, "main", "")).rejects.toThrow(/golfinho\//);
    expect(run(f.repo, "branch", "--format=%(refname:short)")).toContain("main");

    await f.git.deleteBranch(f.repo, "golfinho/descartavel", "main");
    expect(run(f.repo, "branch", "--show-current")).toBe("main");
    expect(run(f.repo, "branch", "--format=%(refname:short)")).toBe("main");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("refuses to delete the active branch when there is nowhere to switch to", async () => {
  const f = fixture();
  try {
    await f.git.prepare(f.repo, "golfinho/sozinha", "main", false);
    run(f.repo, "branch", "-D", "main");
    const status = await f.git.branchStatus(f.repo, "golfinho/sozinha", "HEAD", "main");
    expect(status.fallback).toBe("");
    await expect(f.git.deleteBranch(f.repo, "golfinho/sozinha", "")).rejects.toThrow(/Troque/);
    expect(run(f.repo, "branch", "--show-current")).toBe("golfinho/sozinha");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

it("deletes an empty active branch even with untracked files in the folder", async () => {
  const f = fixture();
  try {
    await f.git.prepare(f.repo, "golfinho/teste", "main", false);
    // Reproduz o caso real: a branch não recebeu commit nenhum e a pasta tem
    // diretórios não rastreados que não pertencem a branch alguma.
    mkdirSync(join(f.repo, "docs"));
    writeFileSync(join(f.repo, "docs", "plano.md"), "nota\n");
    mkdirSync(join(f.repo, ".worktrees"));
    writeFileSync(join(f.repo, ".worktrees", "marca"), "x\n");
    const status = await f.git.branchStatus(f.repo, "golfinho/teste", "main", "main");
    expect(status).toMatchObject({ exists: true, active: true, ahead: 0, fallback: "main" });

    await f.git.deleteBranch(f.repo, "golfinho/teste", "main");

    expect(run(f.repo, "branch", "--format=%(refname:short)")).toBe("main");
    // Arquivo não rastreado nunca foi da branch: continua exatamente onde estava.
    expect(existsSync(join(f.repo, "docs", "plano.md"))).toBe(true);
    expect(existsSync(join(f.repo, ".worktrees", "marca"))).toBe(true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
