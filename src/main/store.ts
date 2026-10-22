import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  Task,
  Status,
  Project,
  Provider,
  CreateTask,
  TaskEvent,
  Settings,
  Check,
  ChatEvent,
  ChatHistoryItem,
  Memory,
  MemoryInput,
  MemoryKind,
  MemoryOrigin,
} from "../shared/contracts";
import { ftsQuery, searchableText } from "./memory";

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
      CREATE TABLE IF NOT EXISTS chat_events(id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, title, content, tokenize="unicode61 remove_diacritics 2");
      CREATE VIRTUAL TABLE IF NOT EXISTS chat_fts USING fts5(seq UNINDEXED, task_id UNINDEXED, project_id UNINDEXED, who UNINDEXED, text, tokenize="unicode61 remove_diacritics 2");`);
    // Conversas gravadas antes do índice existir: entram uma vez, na primeira abertura.
    const indexed = Number(this.db.prepare("SELECT COUNT(*) AS n FROM chat_fts").get()?.n ?? 0);
    if (!indexed) this.reindexChat();
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
      this.db.prepare("DELETE FROM chat_fts WHERE task_id=?").run(id);
      this.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
    });
  }
  // Conversa do chat: cada evento é uma linha; o id da linha é a posição dele no histórico.
  chatAppend(taskId: string, event: ChatEvent): number {
    const seq = Number(
      this.db.prepare("INSERT INTO chat_events(task_id,body) VALUES(?,?)").run(taskId, JSON.stringify(event)).lastInsertRowid,
    );
    this.indexChat(seq, taskId, event);
    return seq;
  }
  // Histórico pesquisável das conversas (memoria_buscar). O texto completo fica em chat_events.
  private indexChat(seq: number, taskId: string, event: ChatEvent, projectId?: string) {
    const found = searchableText(event);
    if (!found) return;
    const project =
      projectId ??
      (this.db.prepare("SELECT project_id FROM tasks WHERE id=?").get(taskId)?.project_id as string | undefined);
    if (!project) return;
    this.db
      .prepare("INSERT INTO chat_fts(seq,task_id,project_id,who,text) VALUES(?,?,?,?,?)")
      .run(seq, taskId, project, found.who, found.text);
  }
  private reindexChat() {
    const rows = this.db
      .prepare("SELECT c.id, c.task_id, c.body, t.project_id FROM chat_events c JOIN tasks t ON t.id = c.task_id")
      .all();
    if (!rows.length) return;
    this.atomic(() => {
      for (const r of rows)
        this.indexChat(Number(r.id), String(r.task_id), JSON.parse(String(r.body)), String(r.project_id));
    });
  }
  // Busca nas conversas de todas as tarefas do projeto. Devolve a posição para abrir o trecho.
  searchHistory(projectId: string, query: string, limit = 8) {
    const match = ftsQuery(query);
    if (!match) return [];
    return this.db
      .prepare(
        `SELECT seq, task_id, who, snippet(chat_fts, 4, '«', '»', '…', 24) AS excerpt FROM chat_fts
         WHERE chat_fts MATCH ? AND project_id = ? ORDER BY bm25(chat_fts) LIMIT ?`,
      )
      .all(match, projectId, limit)
      .map((r) => ({ seq: Number(r.seq), taskId: String(r.task_id), who: String(r.who), excerpt: String(r.excerpt) }));
  }
  // Trecho da conversa de uma tarefa em volta de uma posição, só se a tarefa for do projeto.
  historyAround(projectId: string, taskId: string, seq: number, radius = 4): ChatHistoryItem[] {
    const task = this.db.prepare("SELECT project_id FROM tasks WHERE id=?").get(taskId);
    if (!task || String(task.project_id) !== projectId) return [];
    const parse = (r: Record<string, unknown>) => ({ seq: Number(r.id), event: JSON.parse(String(r.body)) as ChatEvent });
    const before = this.db
      .prepare("SELECT id, body FROM chat_events WHERE task_id=? AND id<=? ORDER BY id DESC LIMIT ?")
      .all(taskId, seq, radius + 1)
      .map(parse)
      .reverse();
    const after = this.db
      .prepare("SELECT id, body FROM chat_events WHERE task_id=? AND id>? ORDER BY id LIMIT ?")
      .all(taskId, seq, radius)
      .map(parse);
    return [...before, ...after];
  }
  chatEvents(taskId: string, limit = 2000): ChatHistoryItem[] {
    return this.db
      .prepare("SELECT id, body FROM chat_events WHERE task_id=? ORDER BY id DESC LIMIT ?")
      .all(taskId, limit)
      .reverse()
      .map((r) => ({ seq: Number(r.id), event: JSON.parse(String(r.body)) }));
  }
  setModel(taskId: string, model: string | null) {
    const task = this.task(taskId);
    task.model = model;
    this.write(task);
  }
  // Ids de sessão e o modelo pertencem a cada CLI: ao trocar de agente, nada disso é reaproveitado.
  setProvider(taskId: string, provider: Provider, message: string, handoff: string | null = null): Task {
    return this.atomic(() => {
      const t = this.task(taskId);
      t.provider = provider;
      t.sessionId = null;
      t.chatSessionId = null;
      t.model = null;
      t.handoff = handoff;
      this.write(t);
      this.event(taskId, "updated", message);
      return t;
    });
  }
  // Pacote de handoff ainda não entregue ao agente (null quando já foi entregue ou nunca houve).
  pendingHandoff(taskId: string): string | null {
    return this.task(taskId).handoff ?? null;
  }
  // Marca a entrega do pacote: ele vai uma única vez, pelo chat ou pelo terminal.
  clearHandoff(taskId: string, message: string) {
    this.atomic(() => {
      const t = this.task(taskId);
      if (!t.handoff) return;
      t.handoff = null;
      this.write(t);
      this.event(taskId, "updated", message);
    });
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
    if (!row) return structuredClone(defaults);
    const parsed = JSON.parse(String(row.body)) as Partial<Settings>;
    return {
      concurrency: typeof parsed.concurrency === "number" ? parsed.concurrency : defaults.concurrency,
      executables: { ...defaults.executables, ...(parsed.executables ?? {}) },
      setup: parsed.setup && typeof parsed.setup === "object" ? parsed.setup : {},
      ssh: Array.isArray(parsed.ssh) ? parsed.ssh : [],
      ...(parsed.memory ? { memory: parsed.memory } : {}),
    };
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
  // Memória do projeto. A nota fica em JSON, como as tarefas; o índice FTS5 guarda só título e
  // conteúdo para a busca (sem acento: "migracao" encontra "migração").
  memories(
    projectId: string,
    filter: { query?: string; kind?: MemoryKind; archived?: boolean; limit?: number } = {},
  ): Memory[] {
    const limit = filter.limit ?? 500;
    const match = filter.query ? ftsQuery(filter.query) : null;
    if (filter.query && !match) return [];
    const rows = match
      ? this.db
          .prepare(
            `SELECT m.body FROM memories_fts f JOIN memories m ON m.id = f.id
             WHERE memories_fts MATCH ? AND m.project_id = ? ORDER BY bm25(memories_fts, 0.0, 4.0, 1.0)`,
          )
          .all(match, projectId)
      : this.db.prepare("SELECT body FROM memories WHERE project_id=?").all(projectId);
    let list: Memory[] = rows.map((r) => JSON.parse(String(r.body)));
    list = list.filter(
      (m) => (filter.kind ? m.kind === filter.kind : true) && m.archived === (filter.archived ?? false),
    );
    // Sem busca, as fixadas vêm primeiro e depois as mais recentes. Com busca, vale a relevância.
    if (!match)
      list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    return list.slice(0, limit);
  }
  memory(id: string): Memory {
    const row = this.db.prepare("SELECT body FROM memories WHERE id=?").get(id);
    if (!row) throw new Error("Nota da memória não encontrada.");
    return JSON.parse(String(row.body));
  }
  saveMemory(
    input: MemoryInput,
    extra: { origin?: MemoryOrigin; source?: Memory["source"] } = {},
  ): Memory {
    this.project(input.projectId);
    return this.atomic(() => {
      const old = input.id ? this.memory(input.id) : null;
      if (old && old.projectId !== input.projectId) throw new Error("A nota pertence a outro projeto.");
      const m: Memory = {
        id: old?.id ?? randomUUID(),
        projectId: input.projectId,
        kind: input.kind,
        title: input.title.trim(),
        content: input.content.trim(),
        source: extra.source !== undefined ? extra.source : (old?.source ?? null),
        origin: extra.origin ?? old?.origin ?? "usuario",
        pinned: input.pinned,
        archived: input.archived,
        createdAt: old?.createdAt ?? now(),
        updatedAt: now(),
        lastUsedAt: old?.lastUsedAt ?? null,
        uses: old?.uses ?? 0,
      };
      this.writeMemory(m);
      return m;
    });
  }
  private writeMemory(m: Memory) {
    this.db
      .prepare("INSERT INTO memories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body")
      .run(m.id, m.projectId, JSON.stringify(m));
    this.db.prepare("DELETE FROM memories_fts WHERE id=?").run(m.id);
    this.db.prepare("INSERT INTO memories_fts(id,title,content) VALUES(?,?,?)").run(m.id, m.title, m.content);
  }
  deleteMemory(id: string) {
    this.memory(id);
    this.atomic(() => {
      this.db.prepare("DELETE FROM memories WHERE id=?").run(id);
      this.db.prepare("DELETE FROM memories_fts WHERE id=?").run(id);
    });
  }
  // Registro automático de uma tarefa: uma nota por tarefa, atualizada a cada conclusão.
  saveTaskMemory(task: Task, content: string): Memory & { created: boolean } {
    const old = this.memories(task.projectId, { kind: "tarefa" })
      .concat(this.memories(task.projectId, { kind: "tarefa", archived: true }))
      .find((m) => m.source?.taskId === task.id && m.origin === "automatica");
    const saved = this.saveMemory(
      {
        id: old?.id,
        projectId: task.projectId,
        kind: "tarefa",
        title: task.title,
        content,
        pinned: old?.pinned ?? false,
        archived: old?.archived ?? false,
      },
      { origin: "automatica", source: { taskId: task.id, title: task.title } },
    );
    return { ...saved, created: !old };
  }
  // Notas que vão para uma conversa nova: as fixadas e depois as mais relevantes para o texto.
  // Entre as relevantes, as que já foram úteis há pouco tempo sobem um pouco.
  relevantMemories(projectId: string, text: string, limit: number): Memory[] {
    const pinned = this.memories(projectId).filter((m) => m.pinned);
    const found = this.memories(projectId, { query: text, limit: 40 }).filter((m) => !m.pinned);
    const month = Date.now() - 30 * 24 * 3600_000;
    const ranked = found
      .map((m, index) => ({
        m,
        score: index - (m.lastUsedAt && Date.parse(m.lastUsedAt) > month ? Math.min(m.uses, 5) * 0.5 : 0),
      }))
      .sort((a, b) => a.score - b.score)
      .map(({ m }) => m);
    return [...pinned, ...ranked].slice(0, limit);
  }
  // Todas as notas ativas do projeto, na ordem em que vão para o agente: fixadas, as mais
  // relacionadas ao texto e depois as mais recentes.
  orderedMemories(projectId: string, text: string): Memory[] {
    const first = this.relevantMemories(projectId, text, 40);
    const seen = new Set(first.map((m) => m.id));
    return [...first, ...this.memories(projectId).filter((m) => !seen.has(m.id))];
  }
  touchMemories(ids: string[]) {
    if (!ids.length) return;
    this.atomic(() => {
      for (const id of ids) {
        const row = this.db.prepare("SELECT body FROM memories WHERE id=?").get(id);
        if (!row) continue;
        const m: Memory = JSON.parse(String(row.body));
        m.lastUsedAt = now();
        m.uses += 1;
        this.db.prepare("UPDATE memories SET body=? WHERE id=?").run(JSON.stringify(m), id);
      }
    });
  }
  close() {
    this.db.close();
  }
}
