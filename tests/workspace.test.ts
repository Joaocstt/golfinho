import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
import type { Project, Review, Task } from "../src/shared/contracts";
import { findSubprojects, folderFingerprint, folderReview, subrepoHeads, workspaceMap } from "../src/main/workspace";

const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const roots: string[] = [];
const identity = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const;
beforeAll(() => {
  for (const key of identity) process.env[key] = key.endsWith("EMAIL") ? "t@t.test" : "T";
});
afterAll(() => {
  for (const key of identity) delete process.env[key];
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// Workspace com um projeto Git (api), um sem Git (web) e pastas que não contam.
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "golfinho-ws-"));
  roots.push(root);
  const api = join(root, "api");
  mkdirSync(api);
  run(api, "init", "-q", "-b", "main");
  writeFileSync(join(api, "package.json"), "{}\n");
  writeFileSync(join(api, "README.md"), "# API\n\nServiço de pedidos em Node.\n");
  run(api, "add", "-A");
  run(api, "commit", "-qm", "base");
  mkdirSync(join(root, "web"));
  writeFileSync(join(root, "web", "composer.json"), "{}\n");
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "notas.txt"), "x\n");
  mkdirSync(join(root, "node_modules", "lib"), { recursive: true });
  writeFileSync(join(root, "node_modules", "lib", "package.json"), "{}\n");
  return { root, api };
}

function service(store: Store) {
  const coordinator = { exclusive: async (_i: string, op: () => Promise<unknown>) => op(), pump() {}, kick() {}, ready: () => false } as unknown as Coordinator;
  return new Service(store, new GitService(), coordinator, { remove() {} } as never, () => {}, async () => null);
}

describe("subprojetos", () => {
  it("acha os projetos de dentro e ignora dependências", async () => {
    const { root } = workspace();
    expect(await findSubprojects(root)).toEqual([
      { path: "api", git: true, kinds: ["Node.js"] },
      { path: "web", git: false, kinds: ["PHP"] },
    ]);
  });

  it("monta o mapa do workspace para o agente", async () => {
    const { root, api } = workspace();
    writeFileSync(join(api, "novo.ts"), "x\n");
    const map = await workspaceMap(new GitService(), root);
    expect(map).toContain("não é um repositório Git");
    expect(map).toContain("- api/ — Node.js; Git, branch main, 1 alteração(ões) pendente(s). # API Serviço de pedidos em Node.");
    expect(map).toContain("- web/ — PHP; sem Git");
    expect(map).not.toContain("node_modules");
  });
});

describe("revisão e checks de pasta", () => {
  it("mostra o que mudou em cada repositório de dentro, inclusive commits", async () => {
    const { root, api } = workspace();
    const git = new GitService();
    const bases = await subrepoHeads(git, root);
    writeFileSync(join(api, "pedido.ts"), "export const a = 1;\n");
    run(api, "add", "-A");
    run(api, "commit", "-qm", "pedido");
    writeFileSync(join(api, "README.md"), "# API\n\nMudou.\n");
    writeFileSync(join(root, "web", "index.php"), "<?php\n");
    const review = await folderReview(git, root, bases);
    expect(review.files.map((f) => [f.path, f.status]).sort()).toEqual([
      ["api/README.md", "modified"],
      ["api/pedido.ts", "added"],
    ]);
  });

  it("o fingerprint muda quando um arquivo fora dos repositórios muda", async () => {
    const { root } = workspace();
    const git = new GitService();
    const before = await folderFingerprint(git, root);
    expect(await folderFingerprint(git, root)).toBe(before);
    writeFileSync(join(root, "docs", "notas.txt"), "mudou bastante\n");
    expect(await folderFingerprint(git, root)).not.toBe(before);
  });
});

describe("projeto pasta no serviço", () => {
  it("aceita pasta sem Git e cria tarefas sem branch", async () => {
    const { root } = workspace();
    const store = new Store(":memory:");
    const s = service(store);
    const project = (await s.request({ action: "addProject", path: root })) as Project;
    expect(project).toMatchObject({ kind: "folder", remotes: [] });
    const input = { projectId: project.id, title: "", prompt: "", provider: "claude" as const, branch: "x", base: "y", remote: "z", timeoutMinutes: 0 };
    const a = (await s.request({ action: "createTask", input })) as Task;
    const b = (await s.request({ action: "createTask", input })) as Task;
    expect([a.branch, a.base, a.remote, b.branch]).toEqual(["", "", "", ""]);
    store.update(a.id, { branchCreated: true, folderBases: {} }, "início");
    const review = (await s.request({ action: "review", taskId: a.id })) as Review;
    expect(review.branch).toBe("");
    await expect(s.request({ action: "publish", taskId: a.id })).rejects.toThrow(/sem Git/);
    await expect(s.request({ action: "initGit", projectId: project.id })).rejects.toThrow(/projetos com Git dentro/);
    store.close();
  });

  it("inicia Git numa pasta simples e ela vira repositório", async () => {
    const root = mkdtempSync(join(tmpdir(), "golfinho-init-"));
    roots.push(root);
    writeFileSync(join(root, "index.html"), "<h1>oi</h1>\n");
    const store = new Store(":memory:");
    const s = service(store);
    const project = (await s.request({ action: "addProject", path: root })) as Project;
    await s.request({ action: "initGit", projectId: project.id });
    expect(store.project(project.id)).toMatchObject({ kind: "git", remotes: [] });
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("node_modules/");
    expect(run(root, "log", "--oneline")).toContain("Primeiro commit");
    expect(existsSync(join(root, ".git"))).toBe(true);
    // Sem remoto, a tarefa Git é criada mesmo assim; só não publica.
    const task = (await s.request({
      action: "createTask",
      input: { projectId: project.id, title: "", prompt: "", provider: "claude", branch: "golfinho/teste", base: run(root, "branch", "--show-current"), remote: "", timeoutMinutes: 0 },
    })) as Task;
    expect(task.branch).toBe("golfinho/teste");
    store.close();
  });
});
