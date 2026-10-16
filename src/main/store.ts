import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Task,
  Status,
  Project,
  CreateTask,
  TaskEvent,
  Settings,
  Check,
  ChatEvent,
  ChatHistoryItem,
} from "../shared/contracts";

const allowed: Record<Status, Status[]> = {
  draft: ["queued", "cancelled"],
  queued: ["running", "cancelled", "failed", "interrupted"],
  running: ["waiting", "review", "failed", "cancelled", "interrupted", "queued"],
  waiting: ["running", "review", "cancelled", "interrupted", "failed"],
  interrupted: ["queued", "review", "cancelled"],
  review: ["queued", "completed", "cancelled"],
  // Concluída não é um fim: a branch pode voltar a ser trabalhada.
  completed: ["queued", "review"],
  failed: ["queued", "review", "cancelled"],
  cancelled: ["queued", "review"],
};
const defaults: Settings = {
  concurrency: 2,
  executables: { codex: "codex", claude: "claude", antigravity: "agy" },
  setup: {},
  ssh: [],
};
const now = () => new Date().toISOString();
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id), sequence INTEGER NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(task_id,sequence));
      CREATE TABLE IF NOT EXISTS checks(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS secrets(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_events(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, body TEXT NOT NULL);`);
  }
  private atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  projects(): Project[] {
    return this.db
      .prepare("SELECT body FROM projects")
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  addProject(p: Project): Project {
    // No Windows, C:\Repo e c:\repo são a mesma pasta.
    const same = (a: string, b: string) =>
      process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
    const old = this.projects().find((x) => same(x.path, p.path));
    if (old) return old;
    this.db.prepare("INSERT INTO projects VALUES(?,?)").run(p.id, JSON.stringify(p));
    return p;
  }
  // Só remove o registro do Golfinho. A pasta e o repositório Git não são tocados.
  removeProject(id: string) {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }
  project(id: string): Project {
    const p = this.projects().find((p) => p.id === id);
    if (!p) throw new Error("Projeto não encontrado.");
    return p;
  }
  tasks(): Task[] {
    return this.db
      .prepare("SELECT body FROM tasks ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  task(id: string): Task {
    const r = this.db.prepare("SELECT body FROM tasks WHERE id=?").get(id);
    if (!r) throw new Error("Tarefa não encontrada.");
    return JSON.parse(String(r.body));
  }
  createTask(input: CreateTask): Task {
    this.project(input.projectId);
    if (this.tasks().some((t) => t.projectId === input.projectId && t.branch === input.branch))
      throw new Error("Essa branch já pertence a outra tarefa.");
    // adopt não é campo da tarefa: vira a marca de branch que já existia.
    const { adopt, ...fields } = input;
    const t: Task = {
      ...fields,
      adoptedBranch: adopt === true,
      title: input.title || input.branch,
      id: randomUUID(),
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
      branchCreated: false,
      published: false,
      error: null,
      reviewSummary: "",
      baseCommit: null,
      sessionId: null,
      worktreePath: null,
    };
    this.atomic(() => {
      this.db.prepare("INSERT INTO tasks VALUES(?,?,?)").run(t.id, t.projectId, JSON.stringify(t));
      this.event(t.id, "created", "Tarefa criada.");
    });
    return t;
  }
  private write(t: Task) {
    t.updatedAt = now();
    this.db.prepare("UPDATE tasks SET body=? WHERE id=?").run(JSON.stringify(t), t.id);
  }
  private event(id: string, kind: string, message: string) {
    this.db
      .prepare(
        "INSERT INTO events(task_id,sequence,kind,message,created_at) SELECT ?,COALESCE(MAX(sequence),0)+1,?,?,? FROM events WHERE task_id=?",
      )
      .run(id, kind, message, now(), id);
  }
  transition(id: string, state: Status, message: string): Task {
    return this.atomic(() => {
      const t = this.task(id);
      if (!allowed[t.status].includes(state))
        throw new Error(`Transição inválida: ${t.status} → ${state}.`);
      t.status = state;
      t.error = state === "failed" ? message : null;
      this.write(t);
      this.event(id, state, message);
      return t;
    });
  }
  update(
    id: string,
    patch: Partial<
      Pick<
        Task,
        "branchCreated" | "published" | "reviewSummary" | "baseCommit" | "sessionId" | "worktreePath" | "setupDone" | "testCheckout"
      >
    >,
    message: string,
  ): Task {
    return this.atomic(() => {
      const t = { ...this.task(id), ...patch };
      this.write(t);
      this.event(id, "updated", message);
      return t;
    });
  }
  note(id: string, message: string) {
    this.task(id);
    this.atomic(() => this.event(id, "info", message));
  }
  events(id: string): TaskEvent[] {
    return this.db
      .prepare(
        "SELECT * FROM (SELECT * FROM events WHERE task_id=? ORDER BY sequence DESC LIMIT 200) ORDER BY sequence",
      )
      .all(id)
      .map((r) => ({
        id: Number(r.id),
        taskId: String(r.task_id),
        sequence: Number(r.sequence),
        kind: String(r.kind),
        message: String(r.message),
        createdAt: String(r.created_at),
      }));
  }
  deleteTask(id: string) {
    this.task(id);
    this.atomic(() => {
      this.db.prepare("DELETE FROM events WHERE task_id=?").run(id);
      this.db.prepare("DELETE FROM checks WHERE task_id=?").run(id);
      this.db.prepare("DELETE FROM chat_events WHERE task_id=?").run(id);
      this.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
    });
  }
  // Conversa do chat: cada evento é uma linha; o id da linha é a posição dele no histórico.
  chatAppend(taskId: string, event: ChatEvent): number {
    return Number(
      this.db.prepare("INSERT INTO chat_events(task_id,body) VALUES(?,?)").run(taskId, JSON.stringify(event)).lastInsertRowid,
    );
  }
  chatEvents(taskId: string, limit = 2000): ChatHistoryItem[] {
    return this.db
      .prepare("SELECT id, body FROM chat_events WHERE task_id=? ORDER BY id DESC LIMIT ?")
      .all(taskId, limit)
      .reverse()
      .map((r) => ({ seq: Number(r.id), event: JSON.parse(String(r.body)) }));
  }
  setChatSession(taskId: string, sessionId: string) {
    const task = this.task(taskId);
    task.chatSessionId = sessionId;
    this.write(task);
  }
  // Valores já criptografados pelo cofre do sistema. O banco nunca vê a senha em texto.
  setSecret(id: string, body: string) {
    this.db
      .prepare("INSERT INTO secrets VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body")
      .run(id, body);
  }
  secret(id: string): string | null {
    const row = this.db.prepare("SELECT body FROM secrets WHERE id=?").get(id);
    return row ? String(row.body) : null;
  }
  deleteSecret(id: string) {
    this.db.prepare("DELETE FROM secrets WHERE id=?").run(id);
  }
  secretIds(): string[] {
    return this.db.prepare("SELECT id FROM secrets").all().map((row) => String(row.id));
  }
  settings(): Settings {
    const row = this.db.prepare("SELECT body FROM settings WHERE id=1").get();
    // Mescla com os padrões: configurações salvas antes de um campo existir não o trazem.
    return row
      ? { ...structuredClone(defaults), ...JSON.parse(String(row.body)) }
      : structuredClone(defaults);
  }
  saveSettings(s: Settings) {
    this.db
      .prepare("INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body")
      .run(JSON.stringify(s));
  }
  addCheck(taskId: string, command: string): Check {
    this.task(taskId);
    const c: Check = {
      id: randomUUID(),
      taskId,
      command,
      status: "running",
      exitCode: null,
      output: "",
      startedAt: now(),
      finishedAt: null,
    };
    this.atomic(() => {
      this.db.prepare("INSERT INTO checks VALUES(?,?,?)").run(c.id, taskId, JSON.stringify(c));
      this.event(taskId, "check", `Check iniciado: ${command}`);
    });
    return c;
  }
  checks(id: string): Check[] {
    return this.db
      .prepare("SELECT body FROM checks WHERE task_id=? ORDER BY rowid DESC LIMIT 30")
      .all(id)
      .map((r) => JSON.parse(String(r.body)));
  }
  finishCheck(
    id: string,
    code: number | null,
    output: string,
    interrupted = false,
    revision: string | null = null,
  ) {
    const row = this.db.prepare("SELECT body FROM checks WHERE id=?").get(id);
    if (!row) throw new Error("Check não encontrado.");
    const c: Check = JSON.parse(String(row.body));
    c.status = interrupted ? "interrupted" : code === 0 ? "passed" : "failed";
    c.exitCode = code;
    c.output = output.slice(-128_000);
    c.finishedAt = now();
    c.revision = revision;
    this.atomic(() => {
      this.db.prepare("UPDATE checks SET body=? WHERE id=?").run(JSON.stringify(c), id);
      this.event(c.taskId, "check", `Check ${c.status}: ${c.command}`);
    });
  }
  complete(id: string, revision?: string) {
    const latest = new Map<string, Check>();
    for (const row of this.db
      .prepare("SELECT body FROM checks WHERE task_id=? ORDER BY rowid DESC")
      .all(id)) {
      const c: Check = JSON.parse(String(row.body));
      if (!latest.has(c.command)) latest.set(c.command, c);
    }
    if ([...latest.values()].some((c) => c.status !== "passed"))
      throw new Error("Resolva os checks falhos, interrompidos ou em execução antes de concluir.");
    if (revision !== undefined && [...latest.values()].some((c) => c.revision !== revision))
      throw new Error("Checks desatualizados: os arquivos mudaram. Execute os comandos novamente.");
    return this.transition(
      id,
      "completed",
      "Resultado revisado e aceito pelo usuário. Nenhum merge foi realizado.",
    );
  }
  recover() {
    for (const t of this.tasks()) {
      for (const c of this.checks(t.id))
        if (c.status === "running") this.finishCheck(c.id, null, c.output, true);
      if (t.status === "running" || t.status === "waiting" || t.status === "queued")
        this.transition(
          t.id,
          "interrupted",
          "Aplicativo reiniciado. Processo anterior não foi retomado automaticamente.",
        );
    }
  }
  close() {
    this.db.close();
  }
}
