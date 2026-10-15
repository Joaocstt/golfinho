import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
import { GitService } from "../src/main/git";
function folder() {
  const root = mkdtempSync(join(tmpdir(), "golfinho-tree-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "node_modules", "pacote"), { recursive: true });
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "README.md"), "x");
  writeFileSync(join(root, "src", "a.ts"), "a");
  writeFileSync(join(root, "zeta.txt"), "z");
  writeFileSync(join(root, ".env"), "segredo");
  symlinkSync("/etc", join(root, "fora"));
  return { root, git: new GitService() };
}
it("lists everything except .git, folders first, without following links out of the root", async () => {
  const f = folder();
  try {
    const { entries, truncated } = await f.git.list(f.root, "");
    expect(truncated).toBe(false);
    expect(entries.map((e) => e.name)).not.toContain(".git");
    // Mostra tudo, inclusive node_modules e arquivos ocultos.
    expect(entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(["node_modules", "src", ".env", "README.md", "zeta.txt", "fora"]),
    );
    // Pastas primeiro, depois arquivos em ordem alfabética.
    const kinds = entries.map((e) => e.kind);
    expect(kinds.lastIndexOf("directory")).toBeLessThan(kinds.indexOf("file"));
    expect(entries.find((e) => e.name === "fora")!.kind).toBe("symlink");
    const sub = await f.git.list(f.root, "node_modules");
    expect(sub.entries[0].path).toBe("node_modules/pacote");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("refuses paths that escape the root or enter git metadata", async () => {
  const f = folder();
  try {
    await expect(f.git.list(f.root, "../")).rejects.toThrow(/inválido|fora/);
    await expect(f.git.list(f.root, "/etc")).rejects.toThrow(/inválido/);
    await expect(f.git.list(f.root, "fora")).rejects.toThrow(/fora do projeto/);
    await expect(f.git.list(f.root, ".git")).rejects.toThrow(/inválido/);
    await expect(f.git.list(f.root, "README.md")).rejects.toThrow(/não é uma pasta/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
it("reports changed files from git, including untracked files one by one", async () => {
  const f = folder();
  try {
    run(f.root, "init", "-q");
    run(f.root, "add", "-A");
    run(f.root, "-c", "user.email=t@t.test", "-c", "user.name=T", "commit", "-qm", "base");
    writeFileSync(join(f.root, "src", "a.ts"), "alterado");
    writeFileSync(join(f.root, "src", "novo.ts"), "novo");
    expect(await f.git.changes(f.root)).toEqual({
      "src/a.ts": "modified",
      "src/novo.ts": "untracked",
    });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
