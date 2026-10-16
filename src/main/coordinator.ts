import type { Store } from "./store";
import type { GitService } from "./git";
import { PendingChangesError } from "./git";
import type { Logs } from "./logs";
import { invocation } from "./agents";
import { commandShell } from "./shellCommand";
import { findSession } from "./sessions";
import { checkoutOf, requireCheckout } from "./checkout";
import { join } from "node:path";
import type { Provider } from "../shared/contracts";
export interface Handle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  stop(): void;
  closed?: Promise<void>;
}
export interface Driver {
  start(
    command: string,
    args: string[],
    cwd: string,
    data: (text: string) => void,
    exit: (code: number) => void,
    // Variáveis extras só deste processo: é assim que a senha chega ao askpass do ssh.
    env?: Record<string, string>,
  ): Promise<Handle>;
}
const SETUP_TIMEOUT_MS = 15 * 60_000;
// Comando que pede a saída limpa da CLI. Antigravity não tem um comando verificado,
// então não entra aqui: para ele o encerramento continua sendo cancelar ou sair no terminal.
export const EXIT_COMMAND: Partial<Record<Provider, string>> = {
  codex: "/exit\r",
  claude: "/exit\r",
};
const EXIT_GRACE_MS = 15_000;
interface Execution {
  handle?: Handle;
  setup?: Handle;
  // Pedido do usuário para encerrar: a saída vira revisão mesmo com código diferente de zero.
  finishing?: boolean;
  exitTimer?: ReturnType<typeof setTimeout>;
  path: string;
  cancelled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  // Inatividade: a execução termina se ficar idleMs sem saída da CLI e sem digitação.
  idleMs?: number;
  lastActivity?: number;
  dimensions?: [number, number];
}
export class Coordinator {
  private active = new Map<string, Execution>();
  private owners = new Map<string, string>();
  private stopping = false;
  private pending = new Set<Promise<void>>();
  private starting = 0;
  private waiters: (() => void)[] = [];
  private checks = new Map<
    string,
    {
      handle?: Handle;
      taskId: string;
      path: string;
      output: string;
      timedOut: boolean;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private store: Store,
    private git: GitService,
    private driver: Driver,
    private logs: Logs,
    private changed: () => void,
    private worktreeRoot: string,
    private finder: (
      provider: Provider,
      cwd: string,
      since: number,
      exclude: string[],
    ) => Promise<string | null> = (provider, cwd, since, exclude) =>
      findSession(provider, cwd, since, undefined, exclude),
  ) {}
  // Tenta iniciar as tarefas da fila agora, sem esperar a próxima liberação de vaga.
  kick() {
    this.pump();
  }
  queue(id: string) {
    this.store.transition(id, "queued", "Aguardando vaga e checkout livre.");
    this.changed();
    this.pump();
  }
  private slots() {
    return this.active.size + this.checks.size + this.starting;
  }
  private full() {
    return this.slots() >= this.store.settings().concurrency;
  }
  // Libera quem espera vaga assim que uma abre — ou imediatamente no encerramento,
  // para que o pedido falhe em vez de ficar pendurado.
  private wake() {
    while (this.waiters.length && (this.stopping || !this.full())) this.waiters.shift()!();
  }
  pump() {
    this.wake();
    if (this.stopping) return;
    for (const task of this.store.tasks().reverse()) {
      if (this.full()) break;
      if (task.status !== "queued") continue;
      const project = this.store.project(task.projectId);
      // Tarefa antiga, no checkout do projeto: só uma por vez naquele diretório.
      // Tarefas com pasta própria não disputam nada e entram sem esperar.
      // Sem pasta própria, a tarefa usa a pasta do projeto: uma por vez naquele diretório.
      const legacy = !task.worktreePath;
      if (legacy && this.owners.has(project.path)) continue;
      const e: Execution = { path: legacy ? project.path : "", cancelled: false };
      if (legacy) this.owners.set(project.path, task.id);
      this.active.set(task.id, e);
      // Tarefa na pasta do projeto só vira "rodando" depois que a pasta estiver pronta; antes,
      // uma pasta com alterações deixa a tarefa na fila, sem registrar uma troca de status a cada tentativa.
      if (!legacy) this.store.transition(task.id, "running", "Preparando branch e CLI.");
      this.changed();
      const launch = this.launch(task.id, e);
      this.pending.add(launch);
      void launch.finally(() => this.pending.delete(launch));
    }
  }
  // O arquivo de sessão aparece pouco depois de a CLI subir. Guardar o id cedo é o
  // que permite retomar mesmo quando o app morre sem chance de se despedir.
  private async detectSession(id: string, e: Execution, provider: Provider, since: number) {
    for (const delay of [1500, 3000, 6000, 12000, 20000]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.stopping || this.active.get(id) !== e) return;
      // A conversa do chat grava na mesma pasta; sem excluí-la, o terminal tentaria retomar a
      // sessão que o chat mantém aberta, e a CLI recusa ("open in another app").
      let exclude: string[];
      try {
        const chat = this.store.task(id).chatSessionId;
        exclude = chat ? [chat] : [];
      } catch {
        return;
      }
      const session = await this.finder(provider, e.path, since, exclude);
      if (this.stopping || this.active.get(id) !== e) return;
      if (!session) continue;
      try {
        // Achar o mesmo id não encerra a busca: ao retomar, o arquivo antigo ainda
        // está recente e apareceria antes de um rollout novo surgir no disco.
        if (this.store.task(id).sessionId === session) continue;
        this.store.update(id, { sessionId: session }, "Sessão da CLI registrada para retomada.");
        this.changed();
      } catch {
        /* tarefa removida enquanto procurávamos */
      }
      return;
    }
  }
  private async launch(id: string, e: Execution) {
    try {
      const t = this.store.task(id);
      const project = this.store.project(t.projectId);
      const started = Date.now();
      const legacy = !t.worktreePath;
      let base: string;
      if (legacy) {
        base = await this.git.prepare(
          project.path,
          t.branch,
          t.baseCommit ?? t.base,
          t.branchCreated || Boolean(t.adoptedBranch),
        );
        e.path = project.path;
      } else {
        const dir = t.worktreePath ?? join(this.worktreeRoot, t.projectId, t.id);
        base = await this.git.prepareWorktree(
          project.path,
          dir,
          t.branch,
          t.baseCommit ?? t.base,
          t.branchCreated || Boolean(t.adoptedBranch),
        );
        e.path = dir;
        this.owners.set(dir, id);
      }
      if (legacy && this.store.task(id).status === "queued") {
        this.store.transition(id, "running", "Preparando branch e CLI.");
        this.changed();
      }
      this.blocked.delete(id);
      const patch: Parameters<Store["update"]>[1] = {};
      if (!t.branchCreated) Object.assign(patch, { branchCreated: true, baseCommit: base });
      if (!legacy && !t.worktreePath) patch.worktreePath = e.path;
      if (Object.keys(patch).length)
        this.store.update(
          id,
          patch,
          patch.worktreePath
            ? `Pasta de trabalho criada em ${e.path}. Branch local: ${t.branch}. Publicação é uma ação separada.`
            : `Branch local criada: ${t.branch}. Publicação é uma ação separada.`,
        );
      if (e.cancelled || this.stopping) {
        this.release(id, e);
        return;
      }
      // O setup prepara a pasta nova (ex.: npm ci) e só então a CLI começa. Falhou,
      // a tarefa para: o agente não deve trabalhar sem as dependências.
      const setup = this.store.settings().setup[t.projectId]?.trim();
      if (setup && !t.setupDone) {
        const code = await this.runSetup(id, e, setup);
        if (e.cancelled || this.stopping) {
          this.release(id, e);
          return;
        }
        if (code !== 0) throw new Error(`Setup falhou com código ${code}. A CLI não foi iniciada.`);
        this.store.update(id, { setupDone: true }, "Setup da pasta concluído.");
      }
      const cmd = this.store.settings().executables[t.provider];
      // Um id igual ao do chat veio de uma detecção antiga e errada: começa uma sessão nova.
      const resume = t.sessionId && t.sessionId !== t.chatSessionId ? t.sessionId : null;
      const args = invocation(t.provider, e.path, t.prompt, resume).args;
      this.logs.append(
        id,
        `\r\n── ${t.provider} · ${t.branch}${resume ? " · retomando sessão" : ""} ──\r\n`,
      );
      const handle = await this.driver.start(
        cmd,
        args,
        e.path,
        (data) => {
          if (!this.stopping && this.active.get(id) === e) {
            this.logs.append(id, data);
            e.lastActivity = Date.now();
          }
        },
        (code) => this.ended(id, e, code),
      );
      if (e.cancelled || this.stopping || this.active.get(id) !== e) {
        handle.stop();
        await handle.closed;
        return;
      }
      e.handle = handle;
      // Também redetectamos ao retomar: a CLI pode abrir um rollout novo (o Codex
      // registra `forked_from_id`), e guardar o id velho faria a próxima retomada
      // voltar à conversa anterior, perdendo tudo que foi feito nesta.
      void this.detectSession(id, e, t.provider, started);
      if (e.dimensions) handle.resize(...e.dimensions);
      if (t.timeoutMinutes) {
        e.idleMs = t.timeoutMinutes * 60_000;
        e.lastActivity = Date.now();
        this.armIdle(id, e);
      }
      this.changed();
    } catch (error) {
      if (error instanceof PendingChangesError && !this.stopping && !e.cancelled) {
        // Alterações pendentes na pasta do projeto: a tarefa continua na fila, com um aviso só
        // na primeira vez, e tenta de novo sem repetir o registro.
        if (!this.blocked.has(id)) {
          this.blocked.add(id);
          this.store.note(
            id,
            "Aguardando: a pasta do projeto tem alterações não commitadas. Faça commit ou guarde-as; a tarefa começa quando a pasta estiver limpa.",
          );
        }
        this.release(id, e, false);
        this.retry();
        return;
      }
      if (!this.stopping && !e.cancelled)
        this.store.transition(id, "failed", (error as Error).message);
      this.release(id, e);
    }
  }
  // Roda o comando de setup na pasta da tarefa e espera ele terminar. A saída vai para
  // o terminal da tarefa, para você acompanhar o npm ci acontecendo.
  private async runSetup(id: string, e: Execution, command: string): Promise<number> {
    this.logs.append(id, `\r\n── setup · ${command} ──\r\n`);
    let finish!: (code: number) => void;
    const exited = new Promise<number>((resolve) => (finish = resolve));
    let timedOut = false;
    const shell = commandShell(command);
    const handle = await this.driver.start(
      shell.file,
      shell.args,
      e.path,
      (data) => {
        if (!this.stopping && this.active.get(id) === e) this.logs.append(id, data);
      },
      (code) => finish(code),
    );
    e.setup = handle;
    if (e.cancelled || this.stopping) handle.stop();
    const timer = setTimeout(() => {
      timedOut = true;
      handle.stop();
    }, SETUP_TIMEOUT_MS);
    try {
      const code = await exited;
      if (timedOut) throw new Error("Setup excedeu 15 minutos e foi interrompido.");
      return code;
    } finally {
      clearTimeout(timer);
      e.setup = undefined;
    }
  }
  private ended(id: string, e: Execution, code: number) {
    if (this.stopping || this.active.get(id) !== e) return;
    if (!e.cancelled && e.finishing)
      this.store.transition(id, "review", "Encerrada pelo usuário. Revise alterações e checks.");
    else if (!e.cancelled)
      this.store.transition(
        id,
        code === 0 ? "review" : "failed",
        code === 0
          ? "CLI encerrada. Revise alterações e checks; saída zero não comprova a conclusão da tarefa."
          : `CLI encerrou com código ${code}.`,
      );
    this.release(id, e);
  }
  private release(id: string, e: Execution, pumpNow = true) {
    if (this.active.get(id) !== e) return;
    if (e.timer) clearTimeout(e.timer);
    if (e.exitTimer) clearTimeout(e.exitTimer);
    this.active.delete(id);
    if (this.owners.get(e.path) === id) this.owners.delete(e.path);
    if (!this.stopping) {
      this.changed();
      if (pumpNow) this.pump();
    }
  }
  // Tenta de novo depois de um intervalo; sem isso, a tarefa só voltaria com outro evento.
  private blocked = new Set<string>();
  private retry() {
    const timer = setTimeout(() => {
      if (!this.stopping) this.pump();
    }, 5000);
    timer.unref?.();
  }
  cancel(id: string) {
    const e = this.active.get(id);
    this.store.transition(
      id,
      "cancelled",
      "Execução cancelada pelo usuário. Alterações da branch foram preservadas.",
    );
    if (e) {
      e.cancelled = true;
      e.handle?.stop();
      e.setup?.stop();
      this.changed();
    } else {
      this.changed();
      this.pump();
    }
  }
  // Encerra a CLI pelo comando de saída dela e leva a tarefa à revisão. Não adivinha que o
  // trabalho acabou: é o usuário que decide, e isso fica registrado no histórico.
  endSession(id: string) {
    const e = this.active.get(id);
    const task = this.store.task(id);
    const command = EXIT_COMMAND[task.provider];
    if (!e?.handle || e.cancelled || e.finishing)
      throw new Error("Não há sessão ativa para encerrar.");
    if (!command)
      throw new Error(
        "Este agente não tem um comando de saída verificado. Use Cancelar execução e revise depois.",
      );
    e.finishing = true;
    e.handle.write(command);
    // Se a CLI não sair sozinha, para o processo. As alterações da pasta permanecem.
    e.exitTimer = setTimeout(() => {
      if (this.active.get(id) === e) e.handle?.stop();
    }, EXIT_GRACE_MS);
    this.changed();
  }
  input(id: string, data: string) {
    const e = this.active.get(id);
    const h = e?.handle;
    if (!h) throw new Error("Não há terminal ativo. Coloque a tarefa na fila.");
    e!.lastActivity = Date.now();
    h.write(data);
  }
  // Um cronômetro só, conferido no vencimento: se houve atividade no meio, ele é remarcado
  // para o novo prazo em vez de ser recriado a cada linha de saída.
  private armIdle(id: string, e: Execution) {
    if (!e.idleMs) return;
    const remaining = e.idleMs - (Date.now() - (e.lastActivity ?? Date.now()));
    e.timer = setTimeout(() => {
      if (this.active.get(id) !== e || e.cancelled || !e.idleMs) return;
      if (Date.now() - (e.lastActivity ?? 0) >= e.idleMs) {
        this.store.note(id, `Sem atividade por ${Math.round(e.idleMs / 60_000)} min: execução encerrada.`);
        this.cancel(id);
      } else this.armIdle(id, e);
    }, Math.max(1000, remaining));
  }
  resize(id: string, cols: number, rows: number) {
    const execution = this.active.get(id); if (!execution) return;
    execution.dimensions = [cols, rows]; execution.handle?.resize(cols, rows);
  }
  ready(id: string) { const execution = this.active.get(id); return Boolean(execution?.handle && !execution.cancelled); }
  async exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const task = this.store.task(id);
    const project = this.store.project(task.projectId);
    const path = checkoutOf(task, project) ?? project.path;
    if (this.owners.has(path))
      throw new Error(
        "Repositório ocupado por uma execução ou operação. Aguarde ou cancele antes de continuar.",
      );
    const owner = `operation:${id}`;
    this.owners.set(path, owner);
    try {
      return await operation();
    } finally {
      if (this.owners.get(path) === owner) this.owners.delete(path);
      this.pump();
    }
  }
  // Tarefas entram na fila quando o limite está cheio; checks faziam o usuário
  // repetir a ação na mão. Agora esperam a mesma vaga.
  async runCheck(id: string, command: string) {
    if (this.stopping) throw new Error("Golfinho está encerrando as execuções.");
    if (this.full()) {
      this.store.note(id, "Check aguardando vaga no limite de execuções.");
      this.changed();
      while (this.full()) {
        if (this.stopping) throw new Error("Golfinho está encerrando as execuções.");
        await new Promise<void>((resolve) => this.waiters.push(resolve));
      }
      if (this.stopping) throw new Error("Golfinho está encerrando as execuções.");
    }
    this.starting++;
    const pending = this.startCheck(id, command);
    this.pending.add(pending);
    try {
      await pending;
    } finally {
      this.pending.delete(pending);
      this.starting--;
      this.pump();
    }
  }
  private async startCheck(id: string, command: string) {
    await this.exclusive(id, async () => {
      const task = this.store.task(id);
      if (!task.branchCreated) throw new Error("A branch da tarefa ainda não foi criada.");
      const path = requireCheckout(task, this.store.project(task.projectId));
      await this.git.requireCurrent(path, task.branch);
      const revision = await this.git.fingerprint(path);
      const check = this.store.addCheck(id, command);
      const run = {
        taskId: id,
        path,
        output: "",
        timedOut: false,
        handle: undefined as Handle | undefined,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      this.checks.set(check.id, run);
      this.owners.set(path, `check:${check.id}`);
      this.changed();
      const done = async (code: number) => {
        if (this.stopping || !this.checks.has(check.id)) return;
        let unchanged = false;
        try {
          unchanged = revision === (await this.git.fingerprint(path));
        } catch {
          /* cannot certify */
        }
        if (this.stopping || !this.checks.has(check.id)) return;
        this.store.finishCheck(
          check.id,
          code,
          run.output + (!unchanged ? "\nArquivos mudaram durante o check. Execute novamente." : ""),
          run.timedOut || !unchanged,
          unchanged ? revision : null,
        );
        if (run.timer) clearTimeout(run.timer);
        this.checks.delete(check.id);
        if (this.owners.get(path) === `check:${check.id}`) this.owners.delete(path);
        this.changed();
        this.pump();
      };
      try {
        const shell = commandShell(command);
        run.handle = await this.driver.start(
          shell.file,
          shell.args,
          path,
          (data) => {
            if (!this.stopping) {
              run.output = (run.output + data).slice(-128_000);
              this.logs.append(id, data);
            }
          },
          (code) => {
            void done(code);
          },
        );
        if (!this.checks.has(check.id)) {
          run.handle.stop();
          return;
        }
        // Checks have a bounded deadline; an interrupted result can never certify completion.
        run.timer = setTimeout(() => {
          if (!this.checks.has(check.id)) return;
          run.timedOut = true;
          run.output += "\nPrazo de 10 minutos atingido.";
          run.handle?.stop();
          this.changed();
        }, 10 * 60_000);
        if (this.stopping) {
          run.handle.stop();
          await run.handle.closed;
        }
      } catch (error) {
        await done(1);
        throw error;
      }
    });
  }
  async shutdown() {
    this.stopping = true;
    this.wake();
    for (const [id, e] of this.active) {
      e.cancelled = true;
      if (e.timer) clearTimeout(e.timer);
      const state = this.store.task(id).status;
      if (state === "running" || state === "waiting")
        this.store.transition(
          id,
          "interrupted",
          "Aplicativo fechado. Retome explicitamente após abrir novamente.",
        );
      e.handle?.stop();
      e.setup?.stop();
    }
    for (const [id, c] of this.checks) {
      if (c.timer) clearTimeout(c.timer);
      this.store.finishCheck(id, null, c.output, true);
      c.handle?.stop();
    }
    await Promise.allSettled([...this.pending]);
    await Promise.allSettled(
      [...this.active.values(), ...this.checks.values()].map(
        (e) => e.handle?.closed ?? Promise.resolve(),
      ),
    );
    this.active.clear();
    this.checks.clear();
    this.owners.clear();
  }
}
