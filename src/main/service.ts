import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import type { GitService } from "./git";
import type { Coordinator } from "./coordinator";
import type { Logs } from "./logs";
import { agentInfo, invocation } from "./agents";
import { interactiveShell } from "./shellCommand";
import type { ChatManager } from "./chat";
import type { ChatImage } from "./chatImages";
import { checkoutOf, requireCheckout } from "./checkout";
import type { Shells } from "./shells";
import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { remoteList, remoteRead, remoteRoots, remoteStat, remoteWrite, sshArgs, sshEnv } from "./ssh";
import type { Vault } from "./vault";
import { readQuota } from "./quota";
import type {
  Request,
  Response,
  Review,
  ProviderQuota,
  Provider,
  Task,
} from "../shared/contracts";
export class Service {
  constructor(
    private store: Store,
    private git: GitService,
    private coordinator: Coordinator,
    private logs: Logs,
    private changed: () => void,
    private chooseFolder: () => Promise<string | null>,
    private clipboard?: {
      read(): string | Promise<string>;
      write(text: string): void | Promise<void>;
      image?(): Promise<Buffer | null>;
      saveImage?(png: Buffer): Promise<string>;
    },
    private shells?: Shells,
    private vault?: Vault,
    private chat?: ChatManager,
    private chatImages?: {
      pick(): Promise<string[]>;
      import(path: string): Promise<string>;
      verify(path: string): Promise<ChatImage>;
      dataUrl(path: string): Promise<string>;
    },
  ) {}
  private requireChatImages() {
    if (!this.chatImages) throw new Error("Imagens indisponíveis neste ambiente.");
    return this.chatImages;
  }
  private requireChat() {
    if (!this.chat) throw new Error("Chat indisponível neste ambiente.");
    return this.chat;
  }
  private passwordFor(connectionId: string): string | null {
    const body = this.store.secret(connectionId);
    if (body === null) return null;
    if (!this.vault) throw new Error("Cofre do sistema indisponível neste ambiente.");
    try {
      return this.vault.decrypt(body);
    } catch {
      throw new Error("Não foi possível ler a senha guardada. Guarde-a de novo no perfil.");
    }
  }
  private requireShells() {
    if (!this.shells) throw new Error("Terminal indisponível neste ambiente.");
    return this.shells;
  }
  private quotas = new Map<Provider, { at: number; value: ProviderQuota }>();
  private quotaRunning = new Map<Provider, Promise<ProviderQuota>>();
  // Cada leitura sobe um processo da CLI, então o resultado vale por um minuto e
  // pedidos simultâneos do mesmo fornecedor dividem a mesma chamada.
  private async quota(provider: Provider, refresh: boolean): Promise<ProviderQuota> {
    const known = this.quotas.get(provider);
    if (!refresh && known && Date.now() - known.at < 60_000) return known.value;
    const current = this.quotaRunning.get(provider);
    if (current) return current;
    const running = readQuota(provider, this.store.settings()).then((value) => {
      this.quotas.set(provider, { at: Date.now(), value });
      return value;
    });
    this.quotaRunning.set(provider, running);
    try {
      return await running;
    } finally {
      this.quotaRunning.delete(provider);
    }
  }
  // Pasta da tarefa quando ela existe; antes disso, o projeto (somente leitura).
  private async treeRoot(taskId: string) {
    const t = this.store.task(taskId);
    const p = this.store.project(t.projectId);
    const checkout = checkoutOf(t, p);
    if (!checkout) return { root: p.path, kind: "project" as const };
    // Tarefa antiga, no checkout do projeto: só mostra os arquivos se a branch estiver ativa.
    if (!t.worktreePath) await this.git.requireCurrent(checkout, t.branch);
    return { root: checkout, kind: "task" as const };
  }
  // Diff da tarefa contra o commit de base, mais sobreposição com as outras tarefas do
  // projeto. Só lê; quem chama decide se precisa do bloqueio.
  private async reviewOf(t: Task): Promise<Review> {
    if (!t.branchCreated) throw new Error("Branch ainda não criada.");
    const p = this.store.project(t.projectId);
    const dir = requireCheckout(t, p);
    const review = await this.git.review(dir, t.branch, t.baseCommit ?? t.base);
    for (const other of this.store
      .tasks()
      .filter(
        (o) =>
          o.id !== t.id && o.projectId === t.projectId && o.branchCreated && o.status !== "completed",
      )) {
      try {
        const result = await this.git.review(p.path, other.branch, other.baseCommit ?? other.base);
        const paths = result.files
          .map((f) => f.path)
          .filter((path) => review.files.some((f) => f.path === path));
        if (paths.length) review.overlaps.push({ taskId: other.id, title: other.title, paths });
      } catch {
        review.overlaps.push({
          taskId: other.id,
          title: other.title,
          paths: ["Comparação indisponível; verifique esta branch antes de integrar."],
        });
      }
    }
    return review;
  }
  private connection(id: string) {
    const connection = this.store.settings().ssh.find((c) => c.id === id);
    if (!connection) throw new Error("Conexão não encontrada. Ela pode ter sido removida.");
    return connection;
  }
  // Shell padrão ou agente sem prompt, na pasta indicada.
  private openSession(
    shells: Shells,
    taskId: string,
    dir: string,
    provider?: Provider,
    prompt?: string,
  ) {
    if (!provider) {
      const shell = interactiveShell();
      return shells.open(taskId, dir, shell.file, shell.args);
    }
    const settings = this.store.settings();
    const info = agentInfo(settings).find((a) => a.provider === provider);
    if (!info?.available)
      throw new Error(
        `${info?.label ?? provider} não está instalado. Configure o caminho em Configurações.`,
      );
    return shells.open(
      taskId,
      dir,
      settings.executables[provider],
      invocation(provider, dir, prompt ?? "").args,
    );
  }
  async request(r: Request): Promise<Response> {
    switch (r.action) {
      case "readClipboard": {
        if (!this.clipboard) throw new Error("Clipboard indisponível neste ambiente.");
        const text = await this.clipboard.read(); if (Buffer.byteLength(text,"utf8") > 65536) throw new Error("Texto a colar excede 64 KiB. Cole em partes menores."); return text;
      }
      case "pasteImage": {
        const png = await this.clipboard?.image?.();
        if (!png || !this.clipboard?.saveImage) return null;
        if (png.length > 10 * 1024 * 1024) throw new Error("Imagem excede 10 MiB.");
        return this.clipboard.saveImage(png);
      }
      case "writeClipboard": {
        if (!this.clipboard) throw new Error("Clipboard indisponível neste ambiente.");
        if (Buffer.byteLength(r.text,"utf8") > 2*1024*1024) throw new Error("Seleção excede 2 MiB."); await this.clipboard.write(r.text); return null;
      }
      case "snapshot": {
        const projects = this.store.projects();
        // Branch atual da pasta de cada projeto, para a lateral mostrar qual tarefa está ativa.
        const active = await Promise.all(
          projects.map(async (p) => [p.id, await this.git.current(p.path).catch(() => "")] as const),
        );
        return {
          projects,
          activeBranches: Object.fromEntries(active),
          tasks: this.store.tasks().map(task => ({ ...task, terminalReady: this.coordinator.ready(task.id) })),
          settings: this.store.settings(),
          agents: agentInfo(this.store.settings()),
          sshPasswords: this.store.secretIds(),
        };
      }
      case "addProject": {
        const path = r.path ?? (await this.chooseFolder());
        if (!path) return null;
        const p = await this.git.inspect(path);
        const project = this.store.addProject({ ...p, id: randomUUID() });
        this.changed();
        return project;
      }
      case "removeProject": {
        const project = this.store.project(r.projectId);
        // Tarefas apontam para o projeto; remover o registro deixaria elas órfãs.
        if (this.store.tasks().some((t) => t.projectId === project.id))
          throw new Error("Este projeto ainda tem tarefas. Exclua as tarefas antes de removê-lo.");
        this.store.removeProject(project.id);
        this.changed();
        return null;
      }
      case "quota":
        return this.quota(r.provider, r.refresh === true);
      case "branches":
        return this.git.branches(this.store.project(r.projectId).path);
      case "deleteInfo": {
        const t = this.store.task(r.taskId);
        const p = this.store.project(t.projectId);
        const busy = ["running", "waiting", "queued"].includes(t.status);
        const status = t.branchCreated
          ? await this.git.branchStatus(p.path, t.branch, t.baseCommit ?? t.base, t.base)
          : { exists: false, active: false, ahead: 0, dirty: false, fallback: "" };
        // A política de bloqueio mora aqui; a janela só mostra o motivo.
        // Com pasta própria, alteração não commitada seria perdida ao remover a pasta,
        // então bloqueia. Tarefa antiga, no checkout do projeto, segue a regra de troca.
        const uncommitted = t.worktreePath ? await this.git.uncommitted(t.worktreePath) : 0;
        const blocked = busy
          ? "Esta tarefa está em execução ou na fila. Cancele antes de excluir."
          : uncommitted > 0
            ? `A pasta desta tarefa tem ${uncommitted} alteração(ões) não commitada(s). Faça commit ou descarte antes de excluir.`
          : status.active && !status.fallback
            ? `A branch está ativa e a base "${t.base}" não existe mais localmente. Troque para outra branch no repositório antes de excluir.`
            : "";
        return {
          branch: t.branch,
          base: t.base,
          title: t.title,
          branchExists: status.exists,
          keepsBranch: Boolean(t.adoptedBranch),
          active: status.active,
          ahead: status.ahead,
          published: t.published,
          blocked,
        };
      }
      case "deleteTask":
        return this.coordinator.exclusive(r.taskId, async () => {
          const t = this.store.task(r.taskId);
          if (["running", "waiting", "queued"].includes(t.status))
            throw new Error("Esta tarefa está em execução ou na fila. Cancele antes de excluir.");
          const p = this.store.project(t.projectId);
          // A pasta sai antes da branch: git não apaga branch que ainda está aberta numa pasta.
          if (t.testCheckout)
            throw new Error("A pasta do projeto está em teste desta tarefa. Volte antes de excluir.");
          this.shells?.closeTask(t.id);
          if (t.worktreePath) await this.git.removeWorktree(p.path, t.worktreePath);
          // Branch que já existia é do usuário: a exclusão da tarefa só remove a pasta dela.
          if (t.branchCreated && !t.adoptedBranch) await this.git.deleteBranch(p.path, t.branch, t.base);
          this.store.deleteTask(t.id);
          this.logs.remove(t.id);
          this.changed();
          return null;
        });
      case "createTask": {
        const p = this.store.project(r.input.projectId);
        if (!(await this.git.inspect(p.path)).remotes.includes(r.input.remote))
          throw new Error("Configure o remoto selecionado no repositório antes de criar a tarefa.");
        if (r.input.adopt) {
          // Branch existente: a base é o commit atual dela, então a revisão mostra só o que a tarefa
          // fizer. Ela roda na pasta do projeto; se a branch estiver aberta em outra pasta, recusa.
          await this.git.validateName(p.path, r.input.branch);
          const existing = await this.git.existingBranch(p.path, r.input.branch);
          if (!existing.exists) throw new Error(`A branch ${r.input.branch} não existe localmente.`);
          const inProject =
            existing.openIn === null ||
            (await realpath(existing.openIn)) === (await realpath(p.path));
          if (!inProject)
            throw new Error(
              `A branch ${r.input.branch} já está aberta em ${existing.openIn}. Escolha outra, ou feche essa pasta antes.`,
            );
          const t = this.store.createTask({ ...r.input, base: r.input.branch });
          this.store.update(
            t.id,
            { baseCommit: existing.sha, branchCreated: true },
            `Trabalho direto na branch existente ${r.input.branch}, a partir de ${existing.sha.slice(0, 7)}.`,
          );
          this.changed();
          return this.store.task(t.id);
        }
        await this.git.validateBranch(p.path, r.input.branch);
        await this.git.ref(p.path, r.input.base);
        const t = this.store.createTask(r.input);
        this.changed();
        return t;
      }
      case "queue":
        this.coordinator.queue(r.taskId);
        return null;
      case "cancel":
        this.coordinator.cancel(r.taskId);
        return null;
      case "endSession":
        this.coordinator.endSession(r.taskId);
        return null;
      case "testActivate": {
        const t = this.store.task(r.taskId);
        const p = this.store.project(t.projectId);
        if (!t.worktreePath) throw new Error("Esta tarefa ainda não tem pasta própria.");
        if (t.testCheckout) throw new Error("A pasta do projeto já está em teste desta tarefa.");
        if (["running", "waiting", "queued"].includes(t.status))
          throw new Error("Aguarde a tarefa terminar antes de testar a pasta do projeto.");
        if ((await this.git.uncommitted(p.path)) > 0)
          throw new Error(
            "A pasta do projeto tem alterações não commitadas. Guarde ou faça commit antes de testar.",
          );
        const before = await this.git.head(p.path);
        const target = await this.git.ref(t.worktreePath, "HEAD");
        await this.git.checkout(p.path, { sha: target });
        this.store.update(t.id, { testCheckout: before }, `Pasta do projeto em teste no código da tarefa (${target.slice(0, 7)}).`);
        this.changed();
        return null;
      }
      case "testRestore": {
        const t = this.store.task(r.taskId);
        const p = this.store.project(t.projectId);
        if (!t.testCheckout) throw new Error("A pasta do projeto não está em teste.");
        if ((await this.git.uncommitted(p.path)) > 0)
          throw new Error(
            "A pasta do projeto tem alterações feitas durante o teste. Guarde ou faça commit antes de voltar.",
          );
        const before = t.testCheckout;
        await this.git.checkout(p.path, before.branch ? { branch: before.branch } : { sha: before.sha });
        this.store.update(t.id, { testCheckout: null }, `Pasta do projeto voltou para ${before.branch || before.sha.slice(0, 7)}.`);
        this.changed();
        return null;
      }
      case "sshList": {
        const connection = this.connection(r.connectionId);
        return remoteList(connection, r.path, this.passwordFor(connection.id));
      }
      case "sshTerminal": {
        const shells = this.requireShells();
        const connection = this.connection(r.connectionId);
        // Com senha guardada, ela segue só para o askpass deste processo. Sem ela, o ssh
        // pergunta no terminal, como faria em qualquer shell.
        return shells.open(
          "",
          homedir(),
          "ssh",
          sshArgs(connection),
          sshEnv(this.passwordFor(connection.id)),
        );
      }
      case "sshRoots": {
        const connection = this.connection(r.connectionId);
        return remoteRoots(connection, this.passwordFor(connection.id));
      }
      case "sshStat": {
        const connection = this.connection(r.connectionId);
        return remoteStat(connection, r.path, this.passwordFor(connection.id));
      }
      case "sshWrite": {
        // Gravar em servidor exige o trabalho de confirmação já feito na interface; aqui,
        // a checagem de conflito e o backup são o que protege o arquivo.
        const connection = this.connection(r.connectionId);
        return remoteWrite(connection, r.path, r.content, r.expectedMtime, this.passwordFor(connection.id));
      }
      case "sshRead": {
        const connection = this.connection(r.connectionId);
        return remoteRead(connection, r.path, this.passwordFor(connection.id));
      }
      case "sshSavePassword": {
        this.connection(r.connectionId);
        if (!this.vault?.available())
          throw new Error(
            "O cofre do sistema não está disponível neste computador. A senha não foi guardada.",
          );
        this.store.setSecret(r.connectionId, this.vault.encrypt(r.password));
        this.changed();
        return null;
      }
      case "sshForgetPassword":
        this.store.deleteSecret(r.connectionId);
        this.changed();
        return null;
      case "uncommitted": {
        const { root } = await this.treeRoot(r.taskId);
        return this.git.uncommitted(root);
      }
      case "input":
        this.coordinator.input(r.taskId, r.data);
        return null;
      case "resize":
        this.coordinator.resize(r.taskId, r.cols, r.rows);
        return null;
      case "terminal":
        this.store.task(r.taskId);
        return this.logs.replay(r.taskId);
      case "events":
        return this.store.events(r.taskId);
      case "checks":
        return this.store.checks(r.taskId);
      case "summary":
        this.store.update(r.taskId, { reviewSummary: r.summary }, "Resumo da revisão atualizado.");
        this.changed();
        return null;
      case "settings": {
        // Perfil removido leva a senha guardada junto.
        const kept = new Set(r.settings.ssh.map((c) => c.id));
        for (const id of this.store.secretIds()) if (!kept.has(id)) this.store.deleteSecret(id);
        this.store.saveSettings(r.settings);
        this.changed();
        this.coordinator.pump();
        return null;
      }
      case "runCheck":
        await this.coordinator.runCheck(r.taskId, r.command);
        return null;
      case "retryStart": {
        this.store.task(r.taskId);
        this.coordinator.kick();
        return null;
      }
      case "stashPending":
        return this.coordinator.exclusive(r.taskId, async () => {
          const t = this.store.task(r.taskId);
          if (t.status !== "queued")
            throw new Error("Só é possível guardar alterações de uma tarefa na fila.");
          const p = this.store.project(t.projectId);
          if ((await this.git.run(p.path, ["status", "--porcelain=v1", "-z"])).length === 0) {
            this.coordinator.kick();
            return null;
          }
          await this.git.run(p.path, ["stash", "push", "--include-untracked", "-m", `golfinho: antes de ${t.branch}`]);
          this.store.note(
            t.id,
            "Alterações da pasta do projeto guardadas em git stash. Para recuperar: git stash pop.",
          );
          this.coordinator.kick();
          this.changed();
          return null;
        });
      case "activate":
        return this.coordinator.exclusive(r.taskId, async () => {
          const t = this.store.task(r.taskId);
          if (!t.branchCreated) throw new Error("Inicie a tarefa antes de selecionar sua branch.");
          if (t.worktreePath)
            throw new Error("Esta tarefa tem pasta própria. Não é preciso ativar a branch.");
          const p = this.store.project(t.projectId);
          await this.git.prepare(p.path, t.branch, t.baseCommit ?? t.base, true);
          this.store.note(t.id, "Branch selecionada para edição/revisão.");
          this.changed();
          return null;
        });
      // Árvore e leitura não tomam o repositório: ver arquivos não pode esperar a CLI
      // terminar. Gravar continua exigindo o bloqueio (saveFile).
      case "tree": {
        const { root, kind } = await this.treeRoot(r.taskId);
        return { root: kind, ...(await this.git.list(root, r.path)) };
      }
      case "readTree":
        return this.git.read((await this.treeRoot(r.taskId)).root, r.path);
      case "shellOpen": {
        const shells = this.requireShells();
        const { root, kind } = await this.treeRoot(r.taskId);
        // Shell só na pasta da própria tarefa: nunca no projeto, onde ele mexeria no seu repositório.
        if (kind !== "task")
          throw new Error("Inicie a tarefa antes de abrir um terminal nela.");
        if (r.prompt && !r.provider) throw new Error("Escolha um agente para enviar o pedido.");
        const id = await this.openSession(shells, r.taskId, root, r.provider, r.prompt);
        // Quando há prompt, a CLI recebe a instrução logo na abertura: fica registrado no histórico.
        if (r.prompt) this.store.note(r.taskId, "Pedido enviado ao agente para fazer os commits.");
        return id;
      }
      case "shellOpenGeneral": {
        // Terminal geral: não pertence a tarefa. Abre no projeto escolhido, ou na sua pasta pessoal.
        const shells = this.requireShells();
        const dir = r.projectId ? this.store.project(r.projectId).path : homedir();
        return this.openSession(shells, "", dir, r.provider);
      }
      case "shellInput":
        this.requireShells().input(r.shellId, r.data);
        return null;
      case "shellResize":
        this.requireShells().resize(r.shellId, r.cols, r.rows);
        return null;
      case "shellClose":
        this.requireShells().close(r.shellId);
        return null;
      case "chatSend": {
        const task = this.store.task(r.taskId);
        // A pasta é a mesma da aba de arquivos: a worktree da tarefa, ou o projeto antes dela.
        const { root } = await this.treeRoot(r.taskId);
        const target = {
          provider: task.provider,
          cwd: root,
          executable: this.store.settings().executables[task.provider],
          model: task.model ?? null,
        };
        // Cada imagem é conferida aqui (pasta do app, tipo e tamanho) antes de ir para o agente.
        const images = await Promise.all((r.images ?? []).map((path) => this.requireChatImages().verify(path)));
        if (!r.text.trim() && !images.length) throw new Error("Escreva uma mensagem ou anexe uma imagem.");
        this.requireChat().send(r.taskId, target, r.text, images);
        return null;
      }
      case "chatDecide":
        this.requireChat().decide(r.taskId, r.id, r.behavior, r.always ?? false);
        return null;
      case "setChatModel": {
        const t = this.store.task(r.taskId);
        if (["running", "waiting", "queued"].includes(t.status))
          throw new Error("Aguarde a tarefa terminar antes de trocar o modelo.");
        this.store.setModel(t.id, r.model);
        // O processo atual é encerrado; a próxima mensagem abre outro com o modelo novo e a mesma conversa.
        this.requireChat().stop(t.id);
        this.store.note(t.id, `Modelo do chat: ${r.model ?? "padrão"}. A conversa continua.`);
        this.changed();
        return null;
      }
      case "setTaskAgent": {
        const t = this.store.task(r.taskId);
        if (["running", "waiting", "queued"].includes(t.status))
          throw new Error("Aguarde a tarefa terminar antes de trocar o agente.");
        if (t.provider === r.provider) return null;
        const settings = this.store.settings();
        const info = agentInfo(settings);
        const from = info.find((a) => a.provider === t.provider)?.label ?? t.provider;
        const to = info.find((a) => a.provider === r.provider);
        if (!to?.available) throw new Error(`${to?.label ?? r.provider} não está instalado. Configure o caminho em Configurações.`);
        // O chat em andamento é do agente antigo: encerra antes de a conversa ser descartada.
        this.requireChat().stop(t.id);
        this.store.setProvider(
          t.id,
          r.provider,
          `Agente trocado de ${from} para ${to.label}. A conversa anterior não é retomada; a branch e os arquivos continuam.`,
        );
        this.requireChat().record(t.id, { type: "agent_changed", from, to: to.label });
        this.changed();
        return null;
      }
      case "chatReset":
        this.requireChat().reset(r.taskId);
        return null;
      case "chatCompact":
        await this.requireChat().compact(r.taskId);
        return null;
      case "chatStop":
        this.requireChat().stop(r.taskId);
        return null;
      case "chatInterrupt":
        this.requireChat().interrupt(r.taskId);
        return null;
      case "chatHistory":
        return this.requireChat().history(r.taskId);
      case "chatPickImages":
        return this.requireChatImages().pick();
      case "chatImportImages":
        return Promise.all(r.paths.map((path) => this.requireChatImages().import(path)));
      case "chatImage":
        return this.requireChatImages().dataUrl(r.path);
      case "commitFiles":
        return this.coordinator.exclusive(r.taskId, async () => {
          const t = this.store.task(r.taskId);
          if (!t.branchCreated) throw new Error("Branch ainda não criada.");
          const dir = requireCheckout(t, this.store.project(t.projectId));
          await this.git.requireCurrent(dir, t.branch);
          const sha = await this.git.commitPaths(dir, r.paths, r.message);
          this.store.note(
            t.id,
            `Commit ${sha}: ${r.message.split("\n")[0]} (${r.paths.length} arquivo(s)).`,
          );
          if (r.push) {
            await this.git.publish(dir, t.branch, t.remote, Boolean(t.adoptedBranch));
            this.store.update(t.id, { published: true }, `Branch publicada em ${t.remote}, sem force-push.`);
          }
          this.changed();
          return sha;
        });
      case "changeDiff":
        return this.git.workingDiff((await this.treeRoot(r.taskId)).root, r.path);
      case "changes":
        return this.git.changes((await this.treeRoot(r.taskId)).root);
      case "readFile":
        return this.coordinator.exclusive(r.taskId, async () => {
          const t = this.store.task(r.taskId);
          const dir = requireCheckout(t, this.store.project(t.projectId));
          await this.git.requireCurrent(dir, t.branch);
          return this.git.read(dir, r.path);
        });
      case "saveFile":
        return this.coordinator.exclusive(r.taskId, async () => {
          const t = this.store.task(r.taskId);
          const dir = requireCheckout(t, this.store.project(t.projectId));
          await this.git.requireCurrent(dir, t.branch);
          await this.git.save(dir, r.path, r.content);
          this.store.note(
            t.id,
            `Arquivo salvo: ${r.path}. Execute os checks novamente para validar alterações.`,
          );
          this.changed();
          return null;
        });
      case "review": {
        // Com a CLI trabalhando, a diff só lê a pasta. Não toma o bloqueio (que a execução
        // segura) e não muda o estado da tarefa, então dá para conferir o que o agente fez.
        const current = this.store.task(r.taskId);
        if (["running", "waiting"].includes(current.status)) return this.reviewOf(current);
        return this.coordinator.exclusive(r.taskId, async () => {
          const t = this.store.task(r.taskId);
          const review = await this.reviewOf(t);
          if (["failed", "cancelled", "interrupted"].includes(t.status))
            this.store.transition(
              t.id,
              "review",
              "Usuário abriu revisão das alterações preservadas.",
            );
          this.changed();
          return review as Review;
        });
      }
      case "finish":
        return this.coordinator.exclusive(r.taskId, async () => {
          const t = this.store.task(r.taskId);
          const path = requireCheckout(t, this.store.project(t.projectId));
          await this.git.requireCurrent(path, t.branch);
          const revision = await this.git.fingerprint(path);
          const result = this.store.complete(t.id, revision);
          this.changed();
          return result;
        });
      case "publish":
        return this.coordinator.exclusive(r.taskId, async () => {
          const t = this.store.task(r.taskId);
          if (!t.branchCreated) throw new Error("Branch ainda não criada.");
          const dir = requireCheckout(t, this.store.project(t.projectId));
          await this.git.requireCurrent(dir, t.branch);
          if ((await this.git.run(dir, ["status", "--porcelain=v1", "-z"])).length)
            throw new Error(
              "Faça commit das alterações antes de publicar. Push publica commits, não arquivos não salvos ou não commitados.",
            );
          await this.git.publish(dir, t.branch, t.remote, Boolean(t.adoptedBranch));
          this.store.update(
            t.id,
            { published: true },
            `Branch publicada em ${t.remote}, sem force-push.`,
          );
          this.changed();
          return null;
        });
    }
  }
}
