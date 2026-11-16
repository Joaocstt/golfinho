import { afterAll, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
import type { Project, Task } from "../src/shared/contracts";
import { requestSchema } from "../src/main/schema";
import {
  absolutePath,
  clipboardFiles,
  copyEntry,
  copyName,
  createEntry,
  deleteEntry,
  importEntries,
  moveEntry,
} from "../src/main/files";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
function temp(prefix = "golfinho-files-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
// Pasta de tarefa com um arquivo, uma pasta, o .git e um link que aponta para fora.
function folder() {
  const root = temp();
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "src", "a.ts"), "a");
  writeFileSync(join(root, ".env"), "x");
  const outside = temp("golfinho-fora-");
  writeFileSync(join(outside, "segredo.txt"), "s");
  symlinkSync(outside, join(root, "fora"), "junction");
  return { root, outside };
}

describe("operações de arquivo", () => {
  it("cria arquivos e pastas sem sobrescrever", async () => {
    const { root } = folder();
    expect(await createEntry(root, "src/novo.ts", "file")).toBe("src/novo.ts");
    expect(readFileSync(join(root, "src", "novo.ts"), "utf8")).toBe("");
    expect(await createEntry(root, "docs", "directory")).toBe("docs");
    expect(lstatSync(join(root, "docs")).isDirectory()).toBe(true);
    await expect(createEntry(root, "src/a.ts", "file")).rejects.toThrow(/Já existe src\/a.ts/);
    await expect(createEntry(root, "nada/x.ts", "file")).rejects.toThrow(/não existe/);
    expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toBe("a");
  });

  it("dá nome de cópia como o VS Code", async () => {
    const taken = new Set(["a.ts", "a copy.ts", ".env", "pasta"]);
    expect(await copyName("a.ts", (n) => taken.has(n))).toBe("a copy 2.ts");
    expect(await copyName(".env", (n) => taken.has(n))).toBe(".env copy");
    expect(await copyName("pasta", (n) => taken.has(n))).toBe("pasta copy");
    expect(await copyName("livre.md", (n) => taken.has(n))).toBe("livre.md");
  });

  it("copia e duplica arquivos e pastas com nome novo quando já existe", async () => {
    const { root } = folder();
    expect(await copyEntry(root, "src/a.ts", "src")).toBe("src/a copy.ts");
    expect(await copyEntry(root, "src/a.ts", "src")).toBe("src/a copy 2.ts");
    expect(await copyEntry(root, "src/a.ts", "")).toBe("a.ts");
    expect(await copyEntry(root, "src", "")).toBe("src copy");
    expect(readFileSync(join(root, "src copy", "a copy.ts"), "utf8")).toBe("a");
    await expect(copyEntry(root, "src", "src")).rejects.toThrow(/dentro dela mesma/);
    await expect(copyEntry(root, "src/a.ts", "src/a.ts")).rejects.toThrow(/não é uma pasta/);
  });

  it("copia o link como link, sem puxar o que está fora", async () => {
    const { root, outside } = folder();
    mkdirSync(join(root, "dest"));
    expect(await copyEntry(root, "fora", "dest")).toBe("dest/fora");
    expect(lstatSync(join(root, "dest", "fora")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(root, "dest", "fora")).replace(/[\\/]$/, "")).toBe(outside);
  });

  it("renomeia e move sem sobrescrever, e não põe uma pasta dentro dela mesma", async () => {
    const { root } = folder();
    mkdirSync(join(root, "lib"));
    expect(await moveEntry(root, "src/a.ts", "src/b.ts")).toBe("src/b.ts");
    expect(await moveEntry(root, "src/b.ts", "lib/b.ts")).toBe("lib/b.ts");
    expect(existsSync(join(root, "lib", "b.ts"))).toBe(true);
    writeFileSync(join(root, "src", "c.ts"), "c");
    await expect(moveEntry(root, "src/c.ts", ".env")).rejects.toThrow(/Já existe .env/);
    await expect(moveEntry(root, "lib", "lib/sub")).rejects.toThrow(/dentro dela mesma/);
    await expect(moveEntry(root, "src/nada.ts", "x.ts")).rejects.toThrow(/não existe mais/);
    expect(await moveEntry(root, "lib", "src/lib")).toBe("src/lib");
    expect(readFileSync(join(root, "src", "lib", "b.ts"), "utf8")).toBe("a");
  });

  it("recusa caminhos fora da pasta, no .git ou através de links", async () => {
    const { root, outside } = folder();
    await expect(createEntry(root, "../fora.txt", "file")).rejects.toThrow(/inválido/);
    await expect(createEntry(root, "/etc/x", "file")).rejects.toThrow(/inválido/);
    await expect(createEntry(root, ".git/hooks", "directory")).rejects.toThrow(/inválido/);
    await expect(createEntry(root, "fora/novo.txt", "file")).rejects.toThrow(/fora da pasta/);
    await expect(moveEntry(root, "src/a.ts", "../a.ts")).rejects.toThrow(/inválido/);
    await expect(moveEntry(root, "fora/segredo.txt", "s.txt")).rejects.toThrow(/fora da pasta/);
    await expect(copyEntry(root, "fora/segredo.txt", "")).rejects.toThrow(/fora da pasta/);
    await expect(copyEntry(root, "src/a.ts", "fora")).rejects.toThrow(/não é uma pasta/);
    await expect(deleteEntry(root, "fora/segredo.txt", true)).rejects.toThrow(/fora da pasta/);
    await expect(importEntries(root, [join(root, "src", "a.ts")], "fora")).rejects.toThrow(/não é uma pasta/);
    await expect(importEntries(root, ["relativo.txt"], "")).rejects.toThrow(/origem inválido/);
    expect(existsSync(join(outside, "segredo.txt"))).toBe(true);
  });

  it("importa arquivos e pastas de fora, com nome novo quando já existe", async () => {
    const { root } = folder();
    const outside = temp("golfinho-origem-");
    writeFileSync(join(outside, "a.ts"), "de fora");
    mkdirSync(join(outside, "assets"));
    writeFileSync(join(outside, "assets", "logo.svg"), "<svg/>");
    expect(await importEntries(root, [join(outside, "a.ts"), join(outside, "assets")], "src")).toEqual([
      "src/a copy.ts",
      "src/assets",
    ]);
    expect(readFileSync(join(root, "src", "a copy.ts"), "utf8")).toBe("de fora");
    expect(readFileSync(join(root, "src", "assets", "logo.svg"), "utf8")).toBe("<svg/>");
    expect(existsSync(join(outside, "a.ts"))).toBe(true);
  });

  it("exclui pela lixeira e só apaga de vez quando pedido", async () => {
    const { root, outside } = folder();
    const trashed: string[] = [];
    expect(await deleteEntry(root, "src/a.ts", false, async (path) => void trashed.push(path))).toBe(true);
    expect(trashed).toEqual([join(await absolutePath(root, "src"), "a.ts")]);
    // Sem lixeira, nada é apagado: a árvore pergunta antes de apagar de vez.
    expect(await deleteEntry(root, "src", false, async () => Promise.reject(new Error("sem lixeira")))).toBe(false);
    expect(await deleteEntry(root, "src", false)).toBe(false);
    expect(existsSync(join(root, "src"))).toBe(true);
    expect(await deleteEntry(root, "src", true)).toBe(true);
    expect(existsSync(join(root, "src"))).toBe(false);
    // Excluir o link apaga só o link.
    expect(await deleteEntry(root, "fora", true)).toBe(true);
    expect(existsSync(join(outside, "segredo.txt"))).toBe(true);
  });

  it("lê a lista de arquivos da área de transferência de cada sistema", () => {
    expect(clipboardFiles("x-special/gnome-copied-files", "copy\nfile:///home/eu/a%20b.txt\nfile:///home/eu/pasta")).toEqual(
      process.platform === "win32" ? expect.any(Array) : ["/home/eu/a b.txt", "/home/eu/pasta"],
    );
    if (process.platform !== "win32")
      expect(clipboardFiles("text/uri-list", "# comentário\r\nfile:///tmp/x.ts\r\n")).toEqual(["/tmp/x.ts"]);
    expect(clipboardFiles("FileNameW", "C:\\Users\\eu\\a.txt\0")).toEqual(["C:\\Users\\eu\\a.txt"]);
    expect(
      clipboardFiles(
        "NSFilenamesPboardType",
        "<plist><array><string>/Users/eu/a.txt</string><string>/Users/eu/R&amp;D</string></array></plist>",
      ),
    ).toEqual(["/Users/eu/a.txt", "/Users/eu/R&D"]);
    expect(clipboardFiles("text/uri-list", "https://exemplo.com")).toEqual([]);
  });
});

describe("ações da árvore no serviço", () => {
  function service(store: Store, files: string[] = []) {
    const coordinator = { exclusive: async (_i: string, op: () => Promise<unknown>) => op(), pump() {}, kick() {}, ready: () => false } as unknown as Coordinator;
    return new Service(store, new GitService(), coordinator, { remove() {} } as never, () => {}, async () => null, {
      read: () => "",
      write: () => undefined,
      files: async () => files,
    });
  }
  // Projeto de pasta sem Git: a tarefa trabalha na própria pasta, sem branch.
  async function folderTask(started = true) {
    const { root } = folder();
    rmSync(join(root, ".git"), { recursive: true });
    const store = new Store(":memory:");
    const s = service(store, [join(root, "src", "a.ts")]);
    const project = (await s.request({ action: "addProject", path: root })) as Project;
    const input = { projectId: project.id, title: "t", prompt: "p", provider: "claude" as const, branch: "", base: "", remote: "", timeoutMinutes: 0 };
    const task = (await s.request({ action: "createTask", input })) as Task;
    if (started) store.update(task.id, { branchCreated: true, folderBases: {} }, "início");
    return { root, store, s, task };
  }

  it("cria, copia, move e exclui dentro da pasta da tarefa", async () => {
    const { root, store, s, task } = await folderTask();
    const taskId = task.id;
    expect(await s.request({ action: "fileCreate", taskId, path: "src/b.ts", kind: "file" })).toBe("src/b.ts");
    expect(await s.request({ action: "fileCopy", taskId, from: "src/b.ts", dir: "src" })).toBe("src/b copy.ts");
    expect(await s.request({ action: "fileMove", taskId, from: "src/b copy.ts", to: "c.ts" })).toBe("c.ts");
    expect(await s.request({ action: "fileImport", taskId, sources: [join(root, "src", "a.ts")], dir: "" })).toEqual(["a.ts"]);
    // Sem lixeira configurada, a primeira tentativa não apaga.
    expect(await s.request({ action: "fileDelete", taskId, path: "c.ts" })).toBe(false);
    expect(existsSync(join(root, "c.ts"))).toBe(true);
    expect(await s.request({ action: "fileDelete", taskId, path: "c.ts", permanent: true })).toBe(true);
    expect(existsSync(join(root, "c.ts"))).toBe(false);
    expect(store.events(taskId).map((e) => e.message)).toContain("Excluído: c.ts.");
    store.close();
  });

  it("usa a lixeira e o gerenciador de arquivos do sistema", async () => {
    const { root, store, s, task } = await folderTask();
    const calls: string[] = [];
    s.useDesktop({ trash: async (path) => void calls.push(`trash ${path}`), reveal: (path) => void calls.push(`reveal ${path}`) });
    expect(await s.request({ action: "fileDelete", taskId: task.id, path: ".env" })).toBe(true);
    await s.request({ action: "fileReveal", taskId: task.id, path: "src/a.ts" });
    const src = await absolutePath(root, "src");
    expect(calls).toEqual([`trash ${join(await absolutePath(root, ""), ".env")}`, `reveal ${join(src, "a.ts")}`]);
    expect(await s.request({ action: "filePath", taskId: task.id, path: "src/a.ts" })).toBe(join(src, "a.ts"));
    expect(await s.request({ action: "clipboardFiles" })).toEqual([join(root, "src", "a.ts")]);
    store.close();
  });

  it("antes de a tarefa começar, a árvore é só leitura", async () => {
    const { store, s, task } = await folderTask(false);
    await expect(s.request({ action: "fileCreate", taskId: task.id, path: "x.ts", kind: "file" })).rejects.toThrow(/Inicie a tarefa/);
    await expect(s.request({ action: "fileDelete", taskId: task.id, path: ".env", permanent: true })).rejects.toThrow(/Inicie a tarefa/);
    // Copiar caminho continua valendo.
    expect(await s.request({ action: "filePath", taskId: task.id, path: ".env" })).toMatch(/\.env$/);
    store.close();
  });

  it("o schema aceita as ações novas e recusa campos a mais", () => {
    const taskId = "6f1c1e8e-0d1a-4c55-9d38-7a3d2b6c1f00";
    expect(requestSchema.safeParse({ action: "fileMove", taskId, from: "a", to: "b" }).success).toBe(true);
    expect(requestSchema.safeParse({ action: "fileCopy", taskId, from: "a", dir: "" }).success).toBe(true);
    expect(requestSchema.safeParse({ action: "fileCreate", taskId, path: "a", kind: "link" }).success).toBe(false);
    expect(requestSchema.safeParse({ action: "fileImport", taskId, sources: [], dir: "" }).success).toBe(false);
    expect(requestSchema.safeParse({ action: "fileDelete", taskId, path: "a", force: true }).success).toBe(false);
  });
});

describe("arquivar tarefa", () => {
  it("esconde a tarefa sem mexer na pasta e recusa enquanto ela roda", async () => {
    const root = temp();
    writeFileSync(join(root, "a.txt"), "a");
    const store = new Store(":memory:");
    const coordinator = { exclusive: async (_i: string, op: () => Promise<unknown>) => op(), pump() {}, kick() {}, ready: () => false } as unknown as Coordinator;
    const s = new Service(store, new GitService(), coordinator, { remove() {} } as never, () => {}, async () => null);
    const project = (await s.request({ action: "addProject", path: root })) as Project;
    const input = { projectId: project.id, title: "t", prompt: "p", provider: "claude" as const, branch: "", base: "", remote: "", timeoutMinutes: 0 };
    const task = (await s.request({ action: "createTask", input })) as Task;
    expect(((await s.request({ action: "archiveTask", taskId: task.id, archived: true })) as Task).archived).toBe(true);
    expect(store.task(task.id).archived).toBe(true);
    expect(existsSync(join(root, "a.txt"))).toBe(true);
    expect(((await s.request({ action: "archiveTask", taskId: task.id, archived: false })) as Task).archived).toBe(false);
    expect(store.events(task.id).map((e) => e.message)).toEqual(expect.arrayContaining(["Tarefa arquivada.", "Tarefa desarquivada."]));
    store.transition(task.id, "queued", "na fila");
    await expect(s.request({ action: "archiveTask", taskId: task.id, archived: true })).rejects.toThrow(/Cancele antes de arquivar/);
    store.close();
  });

  it("arquiva o projeto inteiro e desarquiva", async () => {
    const root = temp();
    const store = new Store(":memory:");
    const coordinator = { exclusive: async (_i: string, op: () => Promise<unknown>) => op(), pump() {}, kick() {}, ready: () => false } as unknown as Coordinator;
    const s = new Service(store, new GitService(), coordinator, { remove() {} } as never, () => {}, async () => null);
    const project = (await s.request({ action: "addProject", path: root })) as Project;
    const input = { projectId: project.id, title: "t", prompt: "p", provider: "claude" as const, branch: "", base: "", remote: "", timeoutMinutes: 0 };
    const task = (await s.request({ action: "createTask", input })) as Task;
    store.transition(task.id, "queued", "na fila");
    await expect(s.request({ action: "archiveProject", projectId: project.id, archived: true })).rejects.toThrow(/Cancele antes de arquivar/);
    store.transition(task.id, "cancelled", "cancelada");
    expect(((await s.request({ action: "archiveProject", projectId: project.id, archived: true })) as Project).archived).toBe(true);
    expect(store.project(project.id).archived).toBe(true);
    expect(store.task(task.id).archived).toBeFalsy();
    await s.request({ action: "archiveProject", projectId: project.id, archived: false });
    expect(store.project(project.id).archived).toBe(false);
    store.close();
  });
});
