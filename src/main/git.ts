import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, open, stat, lstat, readlink, mkdir, type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve, sep, isAbsolute, basename, dirname } from "node:path";
import type { Review, FileChange, TreeEntry, Changes } from "../shared/contracts";
import { readdir } from "node:fs/promises";

// Pasta com milhares de entradas (node_modules) não deve travar a árvore: a lista corta aqui.
const MAX_ENTRIES = 2000;
const exec = promisify(execFile);
export class GitService {
  private queues = new Map<string, Promise<unknown>>();
  // Criar e remover worktrees mexe nos metadados compartilhados do repositório. Duas
  // operações simultâneas no mesmo repo colidem em arquivos internos do git, então
  // entram em fila por repositório. Tarefas diferentes continuam rodando juntas.
  private serial<T>(repo: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(repo) ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.queues.set(repo, next.catch(() => undefined));
    return next;
  }
  private async exists(path: string) {
    return stat(path).then(
      () => true,
      () => false,
    );
  }
  async run(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await exec("git", args, {
        cwd,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      });
      return stdout;
    } catch (e) {
      const error = e as { stderr?: string; message: string };
      throw new Error((error.stderr || error.message).trim().slice(0, 2000));
    }
  }
  async inspect(path: string) {
    const root = await realpath((await this.run(path, ["rev-parse", "--show-toplevel"])).trim());
    return {
      path: root,
      name: basename(root),
      remotes: (await this.run(root, ["remote"])).trim().split("\n").filter(Boolean),
    };
  }
  async ref(path: string, ref: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(ref)) throw new Error("Referência Git inválida.");
    return (await this.run(path, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  }
  // Branch que já existe: só o nome é validado, sem o prefixo golfinho/.
  async validateName(path: string, branch: string) {
    await this.run(path, ["check-ref-format", "--branch", branch]);
  }
  // Onde a branch já está aberta: na pasta do projeto ou numa worktree. O git não deixa
  // a mesma branch em duas pastas, então isso impede a tarefa antes de tentar.
  async existingBranch(repo: string, branch: string) {
    const exists = await this.run(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
      .then(() => true)
      .catch(() => false);
    if (!exists) return { exists: false, sha: "", openIn: null as string | null };
    const sha = await this.ref(repo, `refs/heads/${branch}`);
    const worktrees = await this.run(repo, ["worktree", "list", "--porcelain"]);
    let openIn: string | null = null;
    let current = "";
    for (const line of worktrees.split("\n")) {
      if (line.startsWith("worktree ")) current = line.slice("worktree ".length);
      if (line === `branch refs/heads/${branch}`) openIn = current;
    }
    return { exists: true, sha, openIn };
  }
  async validateBranch(path: string, branch: string) {
    if (!branch.startsWith("golfinho/")) throw new Error("Use uma branch com prefixo golfinho/.");
    await this.run(path, ["check-ref-format", "--branch", branch]);
  }
  async current(path: string) {
    return (await this.run(path, ["branch", "--show-current"])).trim();
  }
  // Base de tarefa é uma referência local existente; sem fetch implícito, listar
  // refs/remotes ofereceria uma base possivelmente desatualizada como se fosse atual.
  async branches(path: string) {
    const output = await this.run(path, [
      "for-each-ref",
      "--format=%(refname:short)",
      "--sort=-committerdate",
      "--count=1000",
      "refs/heads",
    ]);
    return {
      current: await this.current(path),
      branches: output.split("\n").filter(Boolean),
    };
  }
  async requireCurrent(path: string, branch: string) {
    if ((await this.current(path)) !== branch)
      throw new Error(
        "A branch desta tarefa não está ativa. Inicie a tarefa para selecioná-la com segurança.",
      );
  }
  async prepare(path: string, branch: string, base: string, exists: boolean) {
    await this.validateBranch(path, branch);
    const commit = await this.ref(path, base);
    const active = await this.current(path);
    if (exists && active === branch) return commit;
    if ((await this.run(path, ["status", "--porcelain=v1", "-z"])).length)
      throw new Error(
        "Há alterações locais. Salve/commit suas alterações antes de trocar de branch.",
      );
    // git switch itself refuses active merges/rebases without forcing.
    await this.run(path, exists ? ["switch", branch] : ["switch", "-c", branch, commit]);
    return commit;
  }
  // Cada tarefa ganha a própria pasta. A pasta principal do projeto nunca é trocada,
  // então alterações locais nela deixam de bloquear tarefas.
  async prepareWorktree(repo: string, dir: string, branch: string, base: string, exists: boolean) {
    // Branch que já existia não tem o prefixo golfinho/, mas o nome continua válido.
    if (exists) await this.validateName(repo, branch);
    else await this.validateBranch(repo, branch);
    const commit = await this.ref(repo, base);
    return this.serial(repo, async () => {
      if (await this.exists(dir)) {
        if ((await this.current(dir)) !== branch)
          throw new Error(`A pasta ${dir} não está na branch ${branch}. Não foi possível retomar.`);
        return commit;
      }
      await mkdir(dirname(dir), { recursive: true });
      await this.run(
        repo,
        exists
          ? ["worktree", "add", dir, branch]
          : ["worktree", "add", "--no-track", "-b", branch, dir, commit],
      );
      return commit;
    });
  }
  // Sem --force: o git recusa remover uma pasta com alterações não commitadas, e é
  // essa recusa que protege o trabalho. Arquivos ignorados (node_modules) não contam.
  async removeWorktree(repo: string, dir: string) {
    return this.serial(repo, async () => {
      if (!(await this.exists(dir))) {
        await this.run(repo, ["worktree", "prune"]);
        return;
      }
      await this.run(repo, ["worktree", "remove", dir]);
    });
  }
  // Pasta do projeto no commit da tarefa, sem assumir a branch: a mesma branch não pode
  // estar aberta em duas pastas, e a worktree já a tem.
  async head(repo: string) {
    return { branch: await this.current(repo), sha: await this.ref(repo, "HEAD") };
  }
  async checkout(repo: string, target: { branch: string } | { sha: string }) {
    return this.serial(repo, async () => {
      await this.run(
        repo,
        "branch" in target ? ["switch", target.branch] : ["switch", "--detach", target.sha],
      );
    });
  }
  async uncommitted(dir: string) {
    if (!(await this.exists(dir))) return 0;
    return (await this.run(dir, ["status", "--porcelain=v1", "-z"])).split("\0").filter(Boolean)
      .length;
  }
  // Fatos para a confirmação de exclusão. ahead null significa que não deu para
  // medir — a janela precisa dizer isso, não assumir que não há nada a perder.
  async branchStatus(root: string, branch: string, baseRev: string, baseName: string) {
    const locals = (
      await this.run(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    )
      .split("\n")
      .filter(Boolean);
    const exists = locals.includes(branch);
    let ahead: number | null = null;
    if (exists)
      try {
        ahead = Number(
          (await this.run(root, ["rev-list", "--count", `${baseRev}..${branch}`])).trim(),
        );
      } catch {
        ahead = null;
      }
    return {
      exists,
      active: exists && (await this.current(root)) === branch,
      ahead,
      fallback: locals.includes(baseName) && baseName !== branch ? baseName : "",
    };
  }
  // Só remove branches criadas pelo Golfinho; validateBranch exige o prefixo.
  async deleteBranch(root: string, branch: string, fallback: string) {
    await this.validateBranch(root, branch);
    if ((await this.current(root)) === branch) {
      if (!fallback)
        throw new Error("Troque para outra branch no repositório antes de excluir esta.");
      // O git só recusa quando a troca sobrescreveria uma alteração local, e a
      // mensagem dele nomeia o arquivo. Repassar é mais útil que proibir antes.
      try {
        await this.run(root, ["switch", fallback]);
      } catch (error) {
        throw new Error(
          `Não foi possível sair de ${branch} para excluí-la: ${(error as Error).message}`,
        );
      }
    }
    await this.run(root, ["branch", "-D", "--", branch]);
  }
  async publish(path: string, branch: string, remote: string) {
    await this.validateBranch(path, branch);
    const remotes = (await this.inspect(path)).remotes;
    if (!remotes.includes(remote)) throw new Error("Remoto não encontrado neste repositório.");
    await this.run(path, [
      "push",
      "--set-upstream",
      "--",
      remote,
      `refs/heads/${branch}:refs/heads/${branch}`,
    ]);
  }
  private async safeFile(root: string, path: string) {
    if (!path || isAbsolute(path) || path.split(/[\\/]/).includes(".git"))
      throw new Error("Caminho de arquivo inválido.");
    const canonical = await realpath(root);
    const target = await realpath(resolve(root, path));
    const rel = relative(canonical, target);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Arquivo fora do projeto.");
    if (rel.split(sep).includes(".git"))
      throw new Error("Metadados do Git não podem ser editados.");
    let prefix = canonical;
    for (const segment of relative(canonical, resolve(root, path)).split(sep)) {
      prefix = resolve(prefix, segment);
      if ((await lstat(prefix)).isSymbolicLink())
        throw new Error("Links simbólicos não podem ser editados.");
    }
    const info = await stat(target);
    if (!info.isFile() || info.size > 2 * 1024 * 1024)
      throw new Error("Somente arquivos de texto até 2 MiB podem ser abertos.");
    return target;
  }
  async read(root: string, path: string) {
    const target = await this.safeFile(root, path);
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      await this.verifyOpened(root, target, handle);
      const info = await handle.stat();
      if (!info.isFile() || info.size > 2 * 1024 * 1024 || info.nlink > 1)
        throw new Error("Arquivo não é texto regular editável.");
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    if (bytes.includes(0)) throw new Error("Arquivo binário não pode ser editado.");
    return bytes.toString("utf8");
  }
  async save(root: string, path: string, content: string) {
    if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error("Arquivo excede 2 MiB.");
    const target = await this.safeFile(root, path);
    const handle = await open(target, constants.O_WRONLY | constants.O_NOFOLLOW);
    try {
      await this.verifyOpened(root, target, handle);
      const info = await handle.stat();
      if (!info.isFile() || info.nlink > 1) throw new Error("Arquivo não é regular editável.");
      await handle.writeFile(content, "utf8");
      await handle.truncate(Buffer.byteLength(content));
    } finally {
      await handle.close();
    }
  }
  // Confirma que o arquivo aberto é o mesmo aprovado. Compara o inode em vez de ler
  // /proc/self/fd, que só existe no Linux; o caminho aprovado é conferido por realpath.
  private async verifyOpened(root: string, approvedTarget: string, handle: FileHandle) {
    const [opened, onDisk, canonical, current] = await Promise.all([
      handle.stat(),
      stat(approvedTarget),
      realpath(root),
      realpath(approvedTarget),
    ]);
    const rel = relative(canonical, current);
    if (
      current !== approvedTarget ||
      opened.dev !== onDisk.dev ||
      opened.ino !== onDisk.ino ||
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      isAbsolute(rel) ||
      rel.split(sep).includes(".git")
    )
      throw new Error("O caminho do arquivo mudou durante a operação.");
  }
  // Lista uma pasta por vez, sob demanda. Não segue links simbólicos e não sai da raiz:
  // a árvore do Golfinho nunca mostra o que está fora do projeto.
  async list(root: string, path: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const target = await this.directory(root, path);
    const found = await readdir(target, { withFileTypes: true });
    const entries: TreeEntry[] = found
      .filter((entry) => entry.name !== ".git")
      .map((entry) => ({
        name: entry.name,
        path: path ? `${path}/${entry.name}` : entry.name,
        kind: entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
      }));
    entries.sort(
      (a, b) =>
        (a.kind === "directory" ? 0 : 1) - (b.kind === "directory" ? 0 : 1) ||
        a.name.localeCompare(b.name),
    );
    return { entries: entries.slice(0, MAX_ENTRIES), truncated: entries.length > MAX_ENTRIES };
  }
  // Alterações da raiz segundo o git. Arquivos ignorados não entram, e untracked vira
  // arquivo individual (não a pasta inteira), para a árvore marcar o que é novo de fato.
  async changes(root: string): Promise<Changes> {
    const output = await this.run(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--no-renames",
      "--untracked-files=all",
    ]);
    const changes: Changes = {};
    for (const entry of output.split("\0").filter(Boolean)) {
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      changes[path] =
        code === "??"
          ? "untracked"
          : code.includes("A")
            ? "added"
            : code.includes("D")
              ? "deleted"
              : "modified";
    }
    return changes;
  }
  private async directory(root: string, path: string) {
    const parts = path.split(/[\\/]/);
    if (path && (isAbsolute(path) || parts.includes("..") || parts.includes(".git")))
      throw new Error("Caminho de pasta inválido.");
    const canonical = await realpath(root);
    const target = await realpath(resolve(root, path));
    const rel = relative(canonical, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Pasta fora do projeto.");
    if (rel.split(sep).includes(".git")) throw new Error("Metadados do Git não são exibidos.");
    if (!(await stat(target)).isDirectory()) throw new Error("O caminho não é uma pasta.");
    return target;
  }
  private async show(root: string, ref: string, path: string): Promise<string> {
    const exists = await this.run(root, ["ls-tree", "-z", ref, "--", path]);
    if (!exists) return "";
    return this.run(root, ["show", `${ref}:${path}`]);
  }
  async review(root: string, branch: string, base: string): Promise<Review> {
    const baseSha = await this.ref(root, base);
    const branchSha = await this.ref(root, branch);
    const active = (await this.current(root)) === branch;
    const args = ["diff", "--name-only", "-z", "--no-renames", baseSha];
    if (!active) args.push(branchSha);
    args.push("--");
    const files = (await this.run(root, args)).split("\0").filter(Boolean);
    if (active)
      files.push(
        ...(await this.run(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
          .split("\0")
          .filter(Boolean),
      );
    const paths = [...new Set(files)];
    if (paths.length > 200)
      throw new Error("Mais de 200 arquivos alterados. Reduza a tarefa para revisar no Golfinho.");
    const changes: FileChange[] = [];
    for (const path of paths) {
      let original = "";
      let modified = "";
      let binary = false;
      try {
        original = await this.show(root, baseSha, path);
        if (active) {
          try {
            modified = await this.read(root, path);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
        } else modified = await this.show(root, branchSha, path);
        binary =
          original.includes("\0") ||
          modified.includes("\0") ||
          Buffer.byteLength(original) > 2 * 1024 * 1024;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT") modified = "";
        else binary = true;
      }
      changes.push({
        path,
        status: !original ? "added" : !modified ? "deleted" : "modified",
        original: binary ? "" : original,
        modified: binary ? "" : modified,
        binary,
      });
    }
    return { files: changes, branch, overlaps: [] };
  }
  async fingerprint(root: string) {
    const head = await this.ref(root, "HEAD");
    const status = await this.run(root, ["status", "--porcelain=v1", "-z"]);
    const staged = await this.run(root, [
      "diff",
      "--cached",
      "--raw",
      "--no-abbrev",
      "-z",
      "HEAD",
      "--",
    ]);
    const tracked = await this.run(root, [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      "HEAD",
      "--",
    ]);
    const untracked = await this.run(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
    const hash = createHash("sha256").update(head).update(status).update(staged);
    const files = [...new Set([...tracked.split("\0"), ...untracked.split("\0")].filter(Boolean))];
    for (const path of files.sort()) {
      const file = resolve(root, path);
      let info: Awaited<ReturnType<typeof lstat>>;
      try {
        info = await lstat(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          hash.update(path).update("deleted");
          continue;
        }
        throw error;
      }
      hash.update(path).update(String(info.mode));
      if (info.isSymbolicLink()) {
        hash.update(await readlink(file));
        continue;
      }
      if (!info.isFile()) continue;
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await this.verifyOpened(root, file, handle);
        const buffer = Buffer.alloc(64 * 1024);
        for (;;) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
          if (!bytesRead) break;
          hash.update(buffer.subarray(0, bytesRead));
        }
      } finally {
        await handle.close();
      }
    }
    return hash.digest("hex");
  }
}
