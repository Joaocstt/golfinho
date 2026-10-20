export type Provider = "codex" | "claude" | "antigravity";
export type Status =
  | "draft"
  | "queued"
  | "running"
  | "waiting"
  | "interrupted"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";
export interface Project {
  id: string;
  name: string;
  path: string;
  remotes: string[];
}
export interface Task {
  id: string;
  /** Modelo escolhido no chat; null usa o padrão da CLI. */
  model?: string | null;
  projectId: string;
  title: string;
  prompt: string;
  provider: Provider;
  branch: string;
  base: string;
  remote: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  branchCreated: boolean;
  published: boolean;
  error: string | null;
  timeoutMinutes: number;
  reviewSummary: string;
  baseCommit: string | null;
  /** Sessão da CLI para retomar a conversa; null quando não foi possível descobrir. */
  sessionId?: string | null;
  /** Id da conversa do chat (Claude ou Codex), para retomar ao reabrir o app. */
  chatSessionId?: string | null;
  /** Pasta de trabalho própria da tarefa (git worktree). Null em tarefas antigas, que usam o checkout do projeto. */
  worktreePath?: string | null;
  /** O setup da pasta já terminou com sucesso, então não roda de novo numa retomada. */
  setupDone?: boolean;
  /** Branch que já existia quando a tarefa foi criada: o app nunca a apaga. */
  adoptedBranch?: boolean;
  /** Onde a pasta do projeto estava antes do teste desta tarefa. Null quando ela não está em teste. */
  testCheckout?: { branch: string; sha: string } | null;
  terminalReady?: boolean;
}
export interface TaskEvent {
  id: number;
  taskId: string;
  sequence: number;
  kind: string;
  message: string;
  createdAt: string;
}
export interface Check {
  id: string;
  taskId: string;
  command: string;
  status: "running" | "passed" | "failed" | "interrupted";
  exitCode: number | null;
  output: string;
  startedAt: string;
  finishedAt: string | null;
  revision?: string | null;
}
export interface SshConnection {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  /** Chave privada, se houver. Senhas nunca são guardadas pelo app. */
  identityFile: string | null;
}
export interface SshListing {
  path: string;
  entries: { name: string; kind: "directory" | "file" }[];
  truncated: boolean;
}
export interface SshWriteResult {
  /** Nova data de modificação do arquivo no servidor. */
  mtime: number;
  /** Cópia do arquivo anterior, criada na mesma pasta antes de gravar. */
  backup: string;
}
export interface SshRoots {
  /** Pasta inicial do usuário no servidor. */
  home: string;
  /** Discos e pontos de montagem reais, sem sistemas virtuais. */
  mounts: string[];
}
export interface Settings {
  concurrency: number;
  ssh: SshConnection[];
  executables: Record<Provider, string>;
  /** Comando de setup por projeto (id do projeto → comando). Roda na pasta nova, antes da CLI. */
  setup: Record<string, string>;
}
export interface AgentInfo {
  provider: Provider;
  label: string;
  executable: string;
  available: boolean;
}
export interface Snapshot {
  /** Perfis que têm senha guardada no cofre. Os valores nunca saem do processo principal. */
  sshPasswords: string[];
  projects: Project[];
  tasks: Task[];
  settings: Settings;
  agents: AgentInfo[];
  /** Branch em uso na pasta de cada projeto (id do projeto → branch); vazio quando não dá para ler. */
  activeBranches?: Record<string, string>;
}
export interface FileChange {
  path: string;
  status: string;
  original: string;
  modified: string;
  binary: boolean;
  // Falha ao ler este arquivo: mostrada no lugar do diff, sem marcar como binário.
  error?: string;
}
export interface Review {
  files: FileChange[];
  overlaps: { taskId: string; title: string; paths: string[] }[];
  branch: string;
}
export interface ProjectRefs {
  current: string;
  branches: string[];
}
export interface QuotaWindow {
  window: "5h" | "weekly";
  usedPercent: number;
  /** ISO quando a CLI informa horário; texto cru quando só há rótulo legível. */
  resetsAt: string;
}
export interface QuotaGroup {
  name: string;
  windows: QuotaWindow[];
}
export interface ProviderQuota {
  provider: Provider;
  available: boolean;
  plan: string;
  groups: QuotaGroup[];
  error: string;
}
export interface DeleteInfo {
  branch: string;
  base: string;
  title: string;
  branchExists: boolean;
  /** Verdadeiro quando a branch já existia e será mantida na exclusão. */
  keepsBranch: boolean;
  active: boolean;
  /** null quando não foi possível medir; a janela precisa dizer isso. */
  ahead: number | null;
  published: boolean;
  /** Vazio quando a exclusão é permitida; caso contrário, o motivo. */
  blocked: string;
}
export interface CreateTask {
  projectId: string;
  title: string;
  prompt: string;
  provider: Provider;
  branch: string;
  base: string;
  remote: string;
  timeoutMinutes: number;
  /** Trabalhar numa branch que já existe, em vez de criar uma golfinho/... nova. */
  adopt?: boolean;
}
export type Request =
  | { action: "snapshot" }
  | { action: "addProject"; path?: string }
  | { action: "removeProject"; projectId: string }
  | { action: "createTask"; input: CreateTask }
  | { action: "branches"; projectId: string }
  | { action: "quota"; provider: Provider; refresh?: boolean }
  | { action: "deleteInfo"; taskId: string }
  | { action: "deleteTask"; taskId: string }
  | {
      action:
        | "queue"
        | "cancel"
        | "review"
        | "events"
        | "checks"
        | "terminal"
        | "publish"
        | "finish"
        | "activate"
        | "stashPending"
        | "retryStart";
      taskId: string;
    }
  | { action: "input"; taskId: string; data: string }
  | { action: "resize"; taskId: string; cols: number; rows: number }
  | { action: "readFile"; taskId: string; path: string }
  | { action: "tree"; taskId: string; path: string }
  | { action: "readTree"; taskId: string; path: string }
  | { action: "changes"; taskId: string }
  | { action: "changeDiff"; taskId: string; path: string }
  | { action: "commitFiles"; taskId: string; paths: string[]; message: string; push: boolean }
  | { action: "shellOpen"; taskId: string; provider?: Provider; prompt?: string }
  | { action: "uncommitted"; taskId: string }
  | { action: "shellOpenGeneral"; projectId?: string; provider?: Provider }
  | { action: "endSession"; taskId: string }
  | { action: "testActivate"; taskId: string }
  | { action: "testRestore"; taskId: string }
  | { action: "sshList"; connectionId: string; path: string }
  | { action: "sshTerminal"; connectionId: string }
  | { action: "sshSavePassword"; connectionId: string; password: string }
  | { action: "sshForgetPassword"; connectionId: string }
  | { action: "sshRead"; connectionId: string; path: string }
  | { action: "sshRoots"; connectionId: string }
  | { action: "sshStat"; connectionId: string; path: string }
  | { action: "sshWrite"; connectionId: string; path: string; content: string; expectedMtime: number }
  | { action: "shellInput"; shellId: string; data: string }
  | { action: "shellResize"; shellId: string; cols: number; rows: number }
  | { action: "shellClose"; shellId: string }
  | { action: "chatSend"; taskId: string; text: string; images?: string[] }
  | { action: "chatPickImages" }
  | { action: "chatImportImages"; paths: string[] }
  | { action: "chatImage"; path: string }
  | { action: "chatDecide"; taskId: string; id: string; behavior: "allow" | "deny"; always?: boolean }
  | { action: "chatStop"; taskId: string }
  | { action: "chatReset"; taskId: string }
  | { action: "setChatModel"; taskId: string; model: string | null }
  | { action: "setTaskAgent"; taskId: string; provider: Provider }
  | { action: "chatCompact"; taskId: string }
  | { action: "chatInterrupt"; taskId: string }
  | { action: "chatHistory"; taskId: string }
  | { action: "saveFile"; taskId: string; path: string; content: string }
  | { action: "runCheck"; taskId: string; command: string }
  | { action: "summary"; taskId: string; summary: string }
  | { action: "settings"; settings: Settings }
  | { action: "readClipboard" }
  | { action: "pasteImage" }
  | { action: "writeClipboard"; text: string };
export interface TerminalReplay {
  data: string;
  nextOffset: number;
}
export type ChangeKind = "modified" | "added" | "deleted" | "untracked";
/** Arquivos da raiz com alteração no git, pelo caminho relativo. */
export type Changes = Record<string, ChangeKind>;
export interface TreeEntry {
  name: string;
  /** Caminho relativo à raiz, com "/" como separador. */
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
}
export interface TreeListing {
  /** "task": pasta de trabalho da tarefa, editável. "project": projeto, somente leitura. */
  root: "task" | "project";
  entries: TreeEntry[];
  truncated: boolean;
}
export type Response =
  | Snapshot
  | TreeListing
  | Changes
  | FileChange
  | number
  | SshListing
  | SshRoots
  | SshWriteResult
  | Project
  | Task
  | Review
  | TaskEvent[]
  | Check[]
  | TerminalReplay
  | ChatHistoryItem[]
  | string[]
  | ProjectRefs
  | DeleteInfo
  | ProviderQuota
  | string
  | null;
// Eventos do chat com o Claude (Agent SDK). A aprovação de ferramenta chega como "approval" e
// é respondida pela ação chatDecide; o SDK fica esperando até a resposta.
export type ChatBlock = { kind: "text"; text: string } | { kind: "tool"; name: string; summary: string };
export type ChatEvent =
  | { type: "user"; text: string; images?: string[] }
  | { type: "assistant"; blocks: ChatBlock[] }
  | { type: "tool_result"; text: string; isError: boolean }
  | { type: "approval"; id: string; toolName: string; summary: string; canAlwaysAllow: boolean }
  | { type: "approval_resolved"; id: string; behavior: "allow" | "deny" }
  | { type: "status"; state: "running" | "idle" | "error"; message?: string }
  // Contexto em uso: tokens da última chamada e o tamanho da janela do modelo, quando a CLI informa.
  | { type: "context"; used: number; limit: number | null }
  // Marca no histórico em que a tarefa passou a usar outro agente. A conversa antiga fica visível.
  | { type: "agent_changed"; from: string; to: string };
// Evento do chat com a posição dele no histórico da tarefa (usada para não repetir na tela).
export interface ChatHistoryItem {
  seq: number;
  event: ChatEvent;
}
export type Signal =
  | { kind: "changed" }
  | { kind: "chat"; taskId: string; seq: number; event: ChatEvent }
  | { kind: "terminal"; taskId: string; data: string; offset: number }
  | { kind: "shell"; id: string; data: string }
  | { kind: "shellEnded"; id: string; code: number };
// Atualização do próprio app. "unsupported" vale para execuções de desenvolvimento e para o
// pacote .deb, que o electron-updater não atualiza sozinho.
export type UpdateStatus =
  | { state: "unsupported" }
  | { state: "idle" }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string };
export interface GolfinhoAPI {
  request(request: Request): Promise<Response>;
  getPathForFile(file: File): string;
  subscribe(listener: (signal: Signal) => void): () => void;
  update: {
    status(): Promise<UpdateStatus>;
    install(): Promise<void>;
    subscribe(listener: (status: UpdateStatus) => void): () => void;
  };
}
declare global {
  interface Window {
    golfinho: GolfinhoAPI;
  }
}
