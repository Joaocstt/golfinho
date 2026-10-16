import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { GitService } from "../src/main/git";
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
function repo() {
  const root = mkdtempSync(join(tmpdir(), "golfinho-commit-"));
  run(root, "init", "-q", "-b", "main");
  run(root, "config", "user.email", "t@t.test");
  run(root, "config", "user.name", "T");
  writeFileSync(join(root, "a.txt"), "a\n");
  writeFileSync(join(root, "b.txt"), "b\n");
  writeFileSync(join(root, "c.txt"), "c\n");
  run(root, "add", "-A");
  run(root, "commit", "-qm", "base");
  return root;
}
it("comita só os arquivos escolhidos e deixa o resto alterado", async () => {
  const root = repo();
  try {
    writeFileSync(join(root, "a.txt"), "a2\n");
    writeFileSync(join(root, "b.txt"), "b2\n");
    const sha = await new GitService().commitPaths(root, ["a.txt"], "muda a");
    expect(sha).toMatch(/^[0-9a-f]{4,}$/);
    expect(run(root, "show", "--name-only", "--format=", "HEAD")).toBe("a.txt");
    expect(run(root, "status", "--porcelain")).toContain("b.txt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("inclui arquivo novo e remoção quando escolhidos", async () => {
  const root = repo();
  try {
    writeFileSync(join(root, "novo.txt"), "n\n");
    unlinkSync(join(root, "c.txt"));
    await new GitService().commitPaths(root, ["novo.txt", "c.txt"], "novo e remove");
    expect(run(root, "show", "--name-status", "--format=", "HEAD").split("\n").sort()).toEqual(["A\tnovo.txt", "D\tc.txt"]);
    expect(run(root, "status", "--porcelain")).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("recusa commit sem arquivo ou sem mensagem", async () => {
  const root = repo();
  try {
    await expect(new GitService().commitPaths(root, [], "x")).rejects.toThrow(/arquivo/);
    await expect(new GitService().commitPaths(root, ["a.txt"], "  ")).rejects.toThrow(/mensagem/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("mostra o diff do que ainda não foi commitado, inclusive arquivo novo e removido", async () => {
  const root = repo();
  try {
    writeFileSync(join(root, "a.txt"), "a2\n");
    writeFileSync(join(root, "novo.txt"), "n\n");
    unlinkSync(join(root, "c.txt"));
    const g = new GitService();
    expect(await g.workingDiff(root, "a.txt")).toMatchObject({ status: "modified", original: "a\n", modified: "a2\n" });
    expect(await g.workingDiff(root, "novo.txt")).toMatchObject({ status: "added", original: "", modified: "n\n" });
    expect(await g.workingDiff(root, "c.txt")).toMatchObject({ status: "deleted", original: "c\n", modified: "" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
