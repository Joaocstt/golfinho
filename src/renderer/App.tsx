import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderGit2,
  Plus,
  Settings as SettingsIcon,
  GitBranch,
  Activity,
  List,
  X,
  Play,
  Search,
  PanelRight,
  Files,
  ChevronRight,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  RefreshCw,
  Gauge,
  Server,
  ChevronDown,
} from "lucide-react";
import type {
  Snapshot,
  Task,
  Request,
  CreateTask,
  Review,
  TaskEvent,
  Check,
  Settings,
  Project,
  Provider,
  ProjectRefs,
  DeleteInfo,
  ProviderQuota,
} from "../shared/contracts";
import { TerminalPane, DiffPane, FileEditor, FileTree } from "./Editors";
import { ChatPane } from "./ChatPane";
import { ShellPane } from "./ShellPane";
import { AgentIcon } from "./agentIcons";
import { SshPanel } from "./SshPanel";
import { RemoteTree } from "./RemoteTree";
import { RemoteViewer } from "./RemoteViewer";
import golfinhoLogo from "../../build/icon.png";

type DropZone = "left" | "right" | "top" | "bottom" | "center";
// Layout da divisão fica nesta máquina, como preferência de tela.
function storedSplit(): { dir: "right" | "bottom"; ratio: number } {
  try {
    const v = JSON.parse(localStorage.getItem("golfinho.split") ?? "null");
    if ((v?.dir === "right" || v?.dir === "bottom") && typeof v.ratio === "number")
      return { dir: v.dir, ratio: Math.min(0.85, Math.max(0.15, v.ratio)) };
  } catch {
    /* preferência ilegível: usa o padrão */
  }
  return { dir: "right", ratio: 0.5 };
}
// Qual parte da área o cursor está: as bordas abrem painel; o centro troca a aba principal.
function zoneAt(e: React.DragEvent, box: HTMLElement): DropZone {
  const r = box.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  if (x < 0.25) return "left";
  if (x > 0.75) return "right";
  if (y < 0.25) return "top";
  if (y > 0.75) return "bottom";
  return "center";
}
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
const COMMIT_PROMPT =
  "Faça commit de todas as alterações desta branch, com mensagens claras, em português, agrupando por assunto. Não faça push, não troque de branch e não altere código além do necessário para os commits. Ao terminar, confirme o hash de cada commit.";
const CHANGE_COLOR: Record<string, string> = {
  modified: "#e5c07b",
  added: "#98c379",
  deleted: "#e06c75",
};
const CHANGE_WORD: Record<string, string> = {
  modified: "modificado",
  added: "novo",
  deleted: "apagado",
};
// Há quanto tempo a tarefa mudou pela última vez. Não é o tempo de execução da CLI:
// updatedAt muda com transições e notas, não com cada linha de saída.
function ago(iso: string, now: number) {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (!(minutes >= 1)) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  return `há ${Math.floor(minutes / 60)} h`;
}
const labels: Record<string, string> = {
  draft: "Rascunho",
  queued: "Na fila",
  running: "Executando",
  waiting: "Aguardando",
  interrupted: "Interrompida",
  review: "Em revisão",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};
const date = (s: string) => new Date(s).toLocaleString("pt-BR");
const OPEN_KEY = "golfinho.workspaces";
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [project, setProject] = useState(""),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<"task" | "settings" | null>(null);
  const [tab, setTab] = useState("Terminal"),
    [review, setReview] = useState<Review | null>(null),
    [events, setEvents] = useState<TaskEvent[]>([]),
    [checks, setChecks] = useState<Check[]>([]),
    [file, setFile] = useState(""),
    [summary, setSummary] = useState(""),
    [command, setCommand] = useState(""),
    [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState(""),
    [fileQuery, setFileQuery] = useState(""),
    [sidebarWidth, setSidebarWidth] = useState(260),
    [inspector, setInspector] = useState(() => window.innerWidth >= 880);
  // As abas do topo listavam toda tarefa existente, o que não dá para fechar.
  // Agora são um conjunto aberto, lembrado entre sessões.
  const [open, setOpen] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
      return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  });
  const [deleting, setDeleting] = useState("");
  const [dashboard, setDashboard] = useState(false);
  const [sshView, setSshView] = useState(false);
  // Servidores expandidos na barra lateral, e o arquivo remoto aberto na área principal.
  const [sshOpen, setSshOpen] = useState<Record<string, boolean>>({});
  const [remoteFile, setRemoteFile] = useState<{ connectionId: string; path: string } | null>(null);
  function openRemoteFile(connectionId: string, path: string) {
    // Arquivo remoto só abre com uma conexão ativa (terminal SSH) para a mesma VPS.
    if (!general.some((g) => g.connectionId === connectionId)) {
      report(new Error("Conecte esta VPS antes de abrir arquivos. Use o botão de terminal SSH."));
      return;
    }
    setRemoteFile({ connectionId, path });
  }
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [fileWritable, setFileWritable] = useState(true);
  // Sessões avulsas (shell ou agente) abertas pelo "+", por tarefa.
  const [sessions, setSessions] = useState<
    Record<string, { key: string; label: string; provider?: Provider; prompt?: string }[]>
  >({});
  // Publicar exige commit: o diálogo pede ao agente para fazê-los antes.
  const [publishDialog, setPublishDialog] = useState<{
    count: number;
    prompt: string;
    agent: Provider;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [sessionMenu, setSessionMenu] = useState(false);
  // Terminais gerais: fora de qualquer tarefa, na barra superior.
  const [general, setGeneral] = useState<
    { key: string; label: string; provider?: Provider; projectId?: string; connectionId?: string }[]
  >([]);
  const [activeGeneral, setActiveGeneral] = useState("");
  // Posição fixa: a barra superior tem rolagem e cortaria um menu absoluto.
  const [generalMenu, setGeneralMenu] = useState<{ left: number; top: number } | null>(null);
  // Fechar o terminal SSH da VPS fecha também o arquivo dela aberto.
  useEffect(() => {
    if (remoteFile && !general.some((g) => g.connectionId === remoteFile.connectionId))
      setRemoteFile(null);
  }, [general, remoteFile]);
  // Qualquer outra visão desliga a aba SSH.
  useEffect(() => {
    if (dashboard || activeGeneral || selected) setSshView(false);
  }, [dashboard, activeGeneral, selected]);
  const resizeCleanup = useRef<() => void>(() => {});
  useEffect(() => () => resizeCleanup.current(), []);
  const detailEpoch = useRef(0),
    snapshotEpoch = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const report = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    [],
  );
  const refresh = useCallback(async () => {
    const epoch = ++snapshotEpoch.current;
    try {
      const s = await request<Snapshot>({ action: "snapshot" });
      if (epoch === snapshotEpoch.current) setSnapshot(s);
    } catch (e) {
      report(e);
    }
  }, [report]);
  const loadDetails = useCallback(
    async (id: string) => {
      const epoch = ++detailEpoch.current;
      try {
        const [ev, ch] = await Promise.all([
          request<TaskEvent[]>({ action: "events", taskId: id }),
          request<Check[]>({ action: "checks", taskId: id }),
        ]);
        if (epoch === detailEpoch.current && selectedRef.current === id) {
          setEvents(ev);
          setChecks(ch);
        }
      } catch (e) {
        report(e);
      }
    },
    [report],
  );
  useEffect(() => {
    void refresh();
    const dispose = window.golfinho.subscribe((s) => {
      if (s.kind === "changed") {
        setReview(null);
        void refresh();
        if (selectedRef.current) void loadDetails(selectedRef.current);
      }
    });
    return dispose;
  }, [refresh, loadDetails]);
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {}
  }, [open]);
  // Tarefa excluída não pode continuar como aba nem como seleção.
  useEffect(() => {
    if (!snapshot) return;
    setOpen((list) => {
      const alive = list.filter((id) => snapshot.tasks.some((t) => t.id === id));
      return alive.length === list.length ? list : alive;
    });
    if (selectedRef.current && !snapshot.tasks.some((t) => t.id === selectedRef.current))
      setSelected("");
  }, [snapshot]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const task = snapshot?.tasks.find((t) => t.id === selected);
  const matches = (t: Task) =>
    [t.title, t.branch, t.prompt, snapshot?.projects.find((p) => p.id === t.projectId)?.name ?? ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase());
  // Divisão de painéis: a aba principal e a secundária dividem a área de trabalho.
  const [secondTab, setSecondTab] = useState<string | null>(null),
    [splitDir, setSplitDir] = useState<"right" | "bottom">(() => storedSplit().dir),
    [splitRatio, setSplitRatio] = useState(() => storedSplit().ratio),
    [dragTab, setDragTab] = useState<string | null>(null),
    [dropZone, setDropZone] = useState<DropZone | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem("golfinho.split", JSON.stringify({ dir: splitDir, ratio: splitRatio }));
    } catch {
      /* sem armazenamento: a divisão só não fica lembrada */
    }
  }, [splitDir, splitRatio]);
  const tasks =
    snapshot?.tasks.filter((t) => (!project || t.projectId === project) && matches(t)) ?? [];
  useEffect(() => {
    setReview(null);
    setFile("");
    setEvents([]);
    setChecks([]);
    setTab("Terminal");
    setSecondTab(null);
    setDirty(false);
    setSummary(task?.reviewSummary ?? "");
    if (selected) void loadDetails(selected);
    else detailEpoch.current++;
  }, [selected, loadDetails]);
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
      if (selectedRef.current) await loadDetails(selectedRef.current);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  function dragStart(e: React.DragEvent, name: string) {
    e.dataTransfer.setData("text/plain", name);
    e.dataTransfer.effectAllowed = "move";
    setDragTab(name);
  }
  function dragEnd() {
    setDragTab(null);
    setDropZone(null);
  }
  function bodyStyle(): React.CSSProperties | undefined {
    if (!secondTab) return undefined;
    return splitDir === "right"
      ? { gridTemplateColumns: `${splitRatio}fr 6px ${1 - splitRatio}fr` }
      : { gridTemplateRows: `${splitRatio}fr 6px ${1 - splitRatio}fr` };
  }
  // Selecionar uma aba: se ela estava no outro painel, os dois trocam de lugar.
  function selectTab(name: string) {
    if (name === secondTab) setSecondTab(tab);
    setTab(name);
  }
  function shown(name: string) {
    return tab === name || secondTab === name;
  }
  // Posição no grid: a aba principal fica na primeira metade, a secundária na outra.
  function place(name: string): React.CSSProperties {
    if (!secondTab) return { gridColumn: 1, gridRow: 1 };
    const first = name === tab;
    return splitDir === "right"
      ? { gridColumn: first ? 1 : 3, gridRow: 1 }
      : { gridColumn: 1, gridRow: first ? 1 : 3 };
  }
  function dropOn(dragged: string, zone: DropZone) {
    navigate(() => {
      if (zone === "center") {
        setTab(dragged);
        setSecondTab(null);
        return;
      }
      const other = dragged === tab ? secondTab : tab;
      if (!other) return;
      setSplitDir(zone === "left" || zone === "right" ? "right" : "bottom");
      if (zone === "left" || zone === "top") {
        setTab(dragged);
        setSecondTab(other);
      } else {
        setTab(other);
        setSecondTab(dragged);
      }
    });
  }
  function resizeSplit(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeCleanup.current();
    const body = bodyRef.current;
    if (!body) return;
    const vertical = splitDir === "bottom";
    const move = (e: PointerEvent) => {
      const box = body.getBoundingClientRect();
      const share = vertical
        ? (e.clientY - box.top) / box.height
        : (e.clientX - box.left) / box.width;
      setSplitRatio(Math.min(0.85, Math.max(0.15, share)));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    resizeCleanup.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  function navigate(action: () => void) {
    if (dirty && !window.confirm("Descartar alterações não salvas do arquivo?")) return;
    setDirty(false);
    action();
  }
  function addGeneral(label: string, provider?: Provider, connectionId?: string) {
    const key = crypto.randomUUID();
    const projectName = snapshot?.projects.find((p) => p.id === project)?.name;
    setGeneral((all) => [
      ...all,
      {
        key,
        label: connectionId ? label : projectName ? `${label} · ${projectName}` : label,
        provider,
        projectId: connectionId ? undefined : project || undefined,
        connectionId,
      },
    ]);
    setActiveGeneral(key);
    setDashboard(false);
    setSelected("");
  }
  async function openPublish() {
    if (!task) return;
    await perform(async () => {
      const count = await request<number>({ action: "uncommitted", taskId: task.id });
      setPublishDialog({ count, prompt: COMMIT_PROMPT, agent: task.provider });
    });
  }
  // A CLI recebe o pedido logo ao abrir, numa aba Commit na pasta da tarefa.
  function sendCommitRequest() {
    if (!task || !publishDialog) return;
    const { prompt, agent } = publishDialog;
    const label = snapshot?.agents.find((a) => a.provider === agent)?.label ?? agent;
    const key = crypto.randomUUID();
    const taskId = task.id;
    setSessions((all) => ({
      ...all,
      [taskId]: [...(all[taskId] ?? []), { key, label: `Commit · ${label}`, provider: agent, prompt }],
    }));
    setTab(`session:${key}`);
    setPublishDialog(null);
    setNotice(
      `Pedido enviado para ${label}. Acompanhe na aba Commit. Quando os commits estiverem prontos, clique em Publicar branch de novo.`,
    );
  }
  function addSession(taskId: string, label: string, provider?: Provider) {
    const key = crypto.randomUUID();
    setSessions((all) => ({
      ...all,
      [taskId]: [...(all[taskId] ?? []), { key, label, provider }],
    }));
    setTab(`session:${key}`);
  }
  function openTask(id: string) {
    navigate(() => {
      setDashboard(false);
      setActiveGeneral("");
      setSelected(id);
      setOpen((list) => (list.includes(id) ? list : [...list, id]));
    });
  }
  // Fechar é só tirar da barra: não toca na tarefa nem no repositório.
  function closeTask(id: string) {
    const drop = () => {
      const position = open.indexOf(id);
      const rest = open.filter((x) => x !== id);
      setOpen(rest);
      if (selectedRef.current === id) setSelected(rest[position] ?? rest[position - 1] ?? "");
    };
    if (selected === id) navigate(drop);
    else drop();
  }
  async function openReview() {
    if (!task) return;
    if (dirty && !window.confirm("Descartar alterações não salvas do arquivo?")) return;
    setDirty(false);
    await perform(async () => {
      const id = task.id;
      const result = await request<Review>({ action: "review", taskId: id });
      if (selectedRef.current === id) {
        setReview(result);
        setFile(result.files[0]?.path ?? "");
        setTab("Diff");
      }
    });
  }
  function act(
    action:
      | "queue"
      | "cancel"
      | "finish"
      | "publish"
      | "activate"
      | "endSession"
      | "testActivate"
      | "testRestore",
  ) {
    if (!task) return;
    if (action === "queue" || action === "finish") {
      if (
        dirty &&
        !window.confirm(
          "Salve o arquivo antes de continuar ou confirme para descartar as alterações não salvas.",
        )
      )
        return;
      setDirty(false);
      setFile("");
      setTab("Terminal");
      setReview(null);
    }
    return perform(() => request({ action, taskId: task.id }));
  }
  function resizeSidebar(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeCleanup.current();
    const start = event.clientX,
      width = sidebarWidth;
    const move = (e: PointerEvent) =>
      setSidebarWidth(Math.max(220, Math.min(500, width + e.clientX - start)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    resizeCleanup.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  return (
    <div className="app" style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
      <aside className="sidebar" aria-label="Projetos e tarefas">
        <div className="brand">
          <span className="brand-mark">
            <img src={golfinhoLogo} alt="" width={23} height={23} />
          </span>
          <strong>golfinho</strong>
          <button
            aria-label="Configurações"
            title="Configurações"
            onClick={() => setModal("settings")}
          >
            <SettingsIcon size={14} />
          </button>
        </div>
        <div className="search">
          <Search size={13} />
          <input
            type="search"
            aria-label="Buscar projetos e tarefas"
            placeholder="Buscar"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className={!project ? "nav-item active" : "nav-item"}
          onClick={() => setProject("")}
        >
          <List size={14} />
          Todas as tarefas<span>{snapshot?.tasks.length ?? "—"}</span>
        </button>
        <button
          className="nav-item new-task"
          disabled={!snapshot?.projects.length || busy}
          onClick={() => setModal("task")}
        >
          <Plus size={14} />
          Nova tarefa
        </button>
        <div className="sidebar-label">
          Projetos
          <button
            aria-label="Adicionar projeto"
            title="Adicionar projeto"
            disabled={busy}
            onClick={() => perform(() => request({ action: "addProject" }))}
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="project-tree">
          {snapshot?.projects
            .filter(
              (p) =>
                !query ||
                p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
                snapshot.tasks.some((t) => t.projectId === p.id && matches(t)),
            )
            .map((p) => (
              <div className="project-group" key={p.id}>
                <button
                  className={"project-row " + (project === p.id ? "active" : "")}
                  title={p.path}
                  onClick={() => setProject(p.id)}
                >
                  <ChevronRight size={11} />
                  <FolderGit2 size={13} />
                  <span>{p.name}</span>
                  <small>{snapshot.tasks.filter((t) => t.projectId === p.id).length}</small>
                </button>
                <div className="branch-tree">
                  {snapshot.tasks
                    .filter((t) => t.projectId === p.id && matches(t))
                    .map((t) => (
                      <div
                        key={t.id}
                        className={"branch-task " + (selected === t.id ? "selected" : "")}
                      >
                        <button aria-label={t.title} onClick={() => openTask(t.id)}>
                          <div className="branch-task-head">
                            <i className={"state-dot " + t.status} />
                            <span>{t.branch}</span>
                            <small>
                              {labels[t.status]}
                              {t.status === "running" && ` · ${ago(t.updatedAt, now)}`}
                            </small>
                          </div>
                          <div className="branch-task-title">
                            <span>{t.title}</span>
                            <small><AgentIcon provider={t.provider} /> {t.provider}</small>
                          </div>
                        </button>
                        <button
                          className="branch-task-delete"
                          aria-label={"Excluir tarefa " + t.branch}
                          title="Excluir tarefa e branch local"
                          onClick={() => {
                            setError("");
                            setDeleting(t.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          {snapshot?.projects.length === 0 && (
            <p className="side-hint">Adicione um repositório Git para começar.</p>
          )}
          {query && tasks.length === 0 && <p className="side-hint">Nenhuma tarefa encontrada.</p>}
        </div>
          <div className="sidebar-bottom">
          <span>
            <i className="state-dot completed" />
            Ambiente local
          </span>
          <small>Tarefas em branches · sem worktrees</small>
        </div>
      </aside>
      <div
        className="sidebar-resize"
        role="separator"
        aria-label="Largura da navegação"
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={500}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={resizeSidebar}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setSidebarWidth((w) =>
              Math.max(220, Math.min(500, w + (e.key === "ArrowRight" ? 20 : -20))),
            );
          }
        }}
      />
      <div className="workspace">
        <header className="topbar">
          <div className="workspace-tabs" role="tablist" aria-label="Workspaces">
            <button
              role="tab"
              aria-label="Visão geral das tarefas"
              aria-selected={!selected}
              className={!selected ? "active" : ""}
              onClick={() => navigate(() => (setDashboard(false), setSshView(false), setActiveGeneral(""), setSelected("")))}
            >
              <List size={12} />
              Tarefas
            </button>
            <button
              role="tab"
              aria-label="Painel de consumo"
              aria-selected={dashboard}
              className={dashboard ? "active" : ""}
              onClick={() => navigate(() => (setDashboard(true), setSshView(false), setActiveGeneral(""), setSelected("")))}
            >
              <Gauge size={12} />
              Consumo
            </button>
            <button
              role="tab"
              aria-label="Conexões SSH"
              aria-selected={sshView}
              className={sshView ? "active" : ""}
              onClick={() => navigate(() => (setDashboard(false), setActiveGeneral(""), setSelected(""), setSshView(true)))}
            >
              <Server size={12} />
              SSH
            </button>
            {open
              .map((id) => snapshot?.tasks.find((t) => t.id === id))
              .filter((t): t is Task => !!t)
              .map((t) => (
                <div
                  role="presentation"
                  key={t.id}
                  className={"workspace-tab " + (selected === t.id ? "active" : "")}
                >
                  <button
                    role="tab"
                    aria-label={"Workspace " + t.branch}
                    aria-selected={selected === t.id}
                    title={t.title}
                    onClick={() => openTask(t.id)}
                  >
                    <i className={"state-dot " + t.status} />
                    <span>{t.branch}</span>
                  </button>
                  <button
                    className="workspace-close"
                    aria-label={"Fechar aba " + t.branch}
                    title="Fechar aba (não exclui nada)"
                    onClick={() => closeTask(t.id)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            <div className="general-new">
              <button
                aria-label="Novo terminal geral"
                title="CLI ou terminal fora de tarefas, no projeto selecionado ou na sua pasta pessoal"
                aria-expanded={generalMenu !== null}
                onClick={(event) => {
                  if (generalMenu) return setGeneralMenu(null);
                  const rect = event.currentTarget.getBoundingClientRect();
                  setGeneralMenu({ left: rect.left, top: rect.bottom + 4 });
                }}
              >
                <Plus size={12} />
              </button>
              {generalMenu && (
                <div className="session-menu" style={{ position: "fixed", ...generalMenu }}>
                  <button
                    onClick={() => {
                      setGeneralMenu(null);
                      navigate(() => addGeneral("Shell"));
                    }}
                  >
                    Shell
                  </button>
                  {(snapshot?.agents ?? []).map((agent) => (
                    <button
                      key={agent.provider}
                      disabled={!agent.available}
                      title={
                        agent.available
                          ? "Abre o agente vazio, sem tarefa"
                          : "CLI não encontrada. Configure o caminho em Configurações."
                      }
                      onClick={() => {
                        setGeneralMenu(null);
                        navigate(() => addGeneral(agent.label, agent.provider));
                      }}
                    >
                      <AgentIcon provider={agent.provider} /> {agent.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {general.map((g) => (
              <div
                key={g.key}
                role="presentation"
                className={"workspace-tab " + (activeGeneral === g.key ? "active" : "")}
              >
                <button
                  role="tab"
                  aria-label={"Terminal geral " + g.label}
                  aria-selected={activeGeneral === g.key}
                  title={g.label}
                  onClick={() =>
                    navigate(() => (setDashboard(false), setSshView(false), setSelected(""), setActiveGeneral(g.key)))
                  }
                >
                  <i className="state-dot running" />
                  <span>{g.label}</span>
                </button>
                <button
                  className="workspace-close"
                  aria-label={`Fechar ${g.label}`}
                  title="Fecha o terminal e encerra o processo dele"
                  onClick={() =>
                    navigate(() => {
                      setGeneral((all) => all.filter((x) => x.key !== g.key));
                      if (activeGeneral === g.key) setActiveGeneral("");
                    })
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="inspector-toggle"
            aria-label={inspector ? "Ocultar inspetor" : "Mostrar inspetor"}
            title={inspector ? "Ocultar inspetor" : "Mostrar inspetor"}
            onClick={() => setInspector(!inspector)}
          >
            <PanelRight size={14} />
          </button>
        </header>
        <main className="main-area">
          {error && !modal && (
            <div className="error" role="alert">
              {error}
              <button aria-label="Fechar erro" onClick={() => setError("")}>
                <X size={13} />
              </button>
            </div>
          )}
          {dashboard && <UsageDashboard />}
          {sshView && snapshot && (
            <SshPanel
              connections={snapshot.settings.ssh}
              passwords={snapshot.sshPasswords}
              onError={report}
              onSavePassword={async (connectionId, password) => {
                await request({ action: "sshSavePassword", connectionId, password });
              }}
              onForgetPassword={async (connectionId) => {
                await request({ action: "sshForgetPassword", connectionId });
              }}
              onSave={async (next) => {
                await request({ action: "settings", settings: { ...snapshot.settings, ssh: next } });
              }}
              onTerminal={(connection) => addGeneral(`SSH · ${connection.name}`, undefined, connection.id)}
              onExpand={(connection) => setSshOpen((open) => ({ ...open, [connection.id]: !open[connection.id] }))}
            />
          )}
          {/* Ficam montados: fechar a aba é a única forma de encerrar o processo. */}
          {general.map((g) => (
            <section key={g.key} className="general-pane" hidden={activeGeneral !== g.key}>
              <ShellPane
                scopeKey={g.key}
                openSession={() =>
                  g.connectionId
                    ? request<string>({ action: "sshTerminal", connectionId: g.connectionId })
                    : request<string>({
                        action: "shellOpenGeneral",
                        projectId: g.projectId,
                        provider: g.provider,
                      })
                }
                onError={report}
              />
            </section>
          ))}
          {!task && !dashboard && !sshView && !activeGeneral && (
            <section className="overview">
              <div className="overview-head">
                <h1>{snapshot?.projects.find((p) => p.id === project)?.name ?? "Tarefas"}</h1>
                <span>{tasks.length} tarefas</span>
              </div>
              {!snapshot ? (
                <div className="empty">
                  {error ? (
                    <>
                      <span>Não foi possível carregar o workspace.</span>
                      <button disabled={busy} onClick={() => perform(refresh)}>
                        Tentar novamente
                      </button>
                    </>
                  ) : (
                    "Carregando workspace…"
                  )}
                </div>
              ) : tasks.length === 0 ? (
                <div className="empty welcome">
                  <TerminalSquare size={26} />
                  <h3>{query ? "Nenhuma tarefa encontrada" : "Nenhuma tarefa neste workspace"}</h3>
                  <p>
                    {query
                      ? "Tente outro termo de busca."
                      : "Crie uma tarefa ou selecione um projeto na navegação."}
                  </p>
                </div>
              ) : (
                <div className="task-overview">
                  <div className="task-table-head">
                    <span>Tarefa / branch</span>
                    <span>Agente</span>
                    <span>Estado</span>
                  </div>
                  {tasks.map((t) => (
                    <button
                      key={t.id}
                      aria-label={"Abrir workspace " + t.branch}
                      onClick={() => openTask(t.id)}
                    >
                      <span>
                        <strong>{t.title}</strong>
                        <small>
                          <GitBranch size={11} />
                          {t.branch}
                        </small>
                      </span>
                      <span><AgentIcon provider={t.provider} /> {t.provider}</span>
                      <span className={"status " + t.status}>{labels[t.status]}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {task && !dashboard && (
            <section className="detail" hidden={Boolean(activeGeneral) || sshView}>
              <div className="detail-head">
                <div>
                  <div className="eyebrow">TAREFA · {labels[task.status]}</div>
                  <h2>{task.title}</h2>
                  <p>
                    <GitBranch size={14} />
                    {task.branch}{" "}
                    <span>
                      ← {task.base} · {task.remote}
                    </span>
                  </p>
                </div>
                <button aria-label="Fechar tarefa" onClick={() => closeTask(task.id)}>
                  <X size={18} />
                </button>
              </div>
              {task.error && <div className="error">{task.error}</div>}
              {task.testCheckout && (
                <p className="notice notice-warn" role="status">
                  A pasta do projeto está no código desta tarefa, para teste. A branch original era{" "}
                  <strong>{task.testCheckout.branch || task.testCheckout.sha.slice(0, 7)}</strong>.
                  Volte antes de trabalhar em outra coisa.
                </p>
              )}
              {notice && (
                <p className="notice notice-ok" role="status" onClick={() => setNotice("")}>
                  {notice}
                </p>
              )}
              <div className="workbar">
                <div className="tab-group">
                  <div className="tabs">
                  {["Terminal", "Chat", "Shell", "Diff", "Arquivos", "Histórico", "Checks"]
                    .filter((t) => t !== "Chat" || task.provider !== "antigravity")
                    .filter((t) => t !== "Shell" || task.branchCreated)
                    .map((t) => (
                    <button
                      key={t}
                      className={tab === t ? "active" : secondTab === t ? "active secondary" : ""}
                      draggable
                      onDragStart={(e) => dragStart(e, t)}
                      onDragEnd={dragEnd}
                      onClick={() => navigate(() => selectTab(t))}
                    >
                      {t}
                    </button>
                  ))}
                  {(sessions[task.id] ?? []).map((s) => (
                    <span
                      key={s.key}
                      className={"session-tab " + (tab === `session:${s.key}` ? "active" : "")}
                    >
                      <button
                        className={
                          tab === `session:${s.key}`
                            ? "active"
                            : secondTab === `session:${s.key}`
                              ? "active secondary"
                              : ""
                        }
                        draggable
                        onDragStart={(e) => dragStart(e, `session:${s.key}`)}
                        onDragEnd={dragEnd}
                        onClick={() => navigate(() => selectTab(`session:${s.key}`))}
                      >
                        {s.label}
                      </button>
                      <button
                        className="session-close"
                        aria-label={`Fechar ${s.label}`}
                        title="Fecha a sessão e encerra o processo dela"
                        onClick={() =>
                          navigate(() => {
                            setSessions((all) => ({
                              ...all,
                              [task.id]: (all[task.id] ?? []).filter((x) => x.key !== s.key),
                            }));
                            if (tab === `session:${s.key}`) setTab("Terminal");
                          })
                        }
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                {task.branchCreated && (
                  <div className="session-new">
                      <button
                        aria-label="Nova sessão"
                        title="Nova sessão nesta pasta"
                        aria-expanded={sessionMenu}
                        onClick={() => setSessionMenu((open) => !open)}
                      >
                        <Plus size={12} />
                      </button>
                      {sessionMenu && (
                        <div className="session-menu">
                          <button
                            onClick={() => {
                              setSessionMenu(false);
                              navigate(() => addSession(task.id, "Shell"));
                            }}
                          >
                            Shell
                          </button>
                          {(snapshot?.agents ?? []).map((agent) => (
                            <button
                              key={agent.provider}
                              disabled={!agent.available}
                              title={
                                agent.available
                                  ? "Abre o agente vazio, nesta pasta"
                                  : "CLI não encontrada. Configure o caminho em Configurações."
                              }
                              onClick={() => {
                                setSessionMenu(false);
                                navigate(() => addSession(task.id, agent.label, agent.provider));
                              }}
                            >
                              <AgentIcon provider={agent.provider} /> {agent.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="actions">
                  {task.branchCreated && !task.worktreePath && !task.adoptedBranch && !["running", "waiting", "queued"].includes(task.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        navigate(() => {
                          setFile("");
                          setTab("Terminal");
                          setReview(null);
                          void act("activate");
                        })
                      }
                    >
                      Ativar branch no repositório
                    </button>
                  )}
                  {["draft", "failed", "cancelled", "interrupted", "review"].includes(
                    task.status,
                  ) && (
                    <button
                      disabled={busy}
                      className="primary"
                      title={
                        task.sessionId
                          ? "Reabre a conversa da CLI de onde parou, sem reenviar as instruções"
                          : "Inicia a CLI com as instruções da tarefa, em conversa nova"
                      }
                      onClick={() => act("queue")}
                    >
                      <Play size={14} />
                      {task.sessionId && task.branchCreated ? "Retomar sessão" : "Colocar na fila"}
                    </button>
                  )}
                  {["running", "waiting", "queued"].includes(task.status) && (
                    <button disabled={busy} onClick={() => act("cancel")}>
                      Cancelar execução
                    </button>
                  )}
                  {task.worktreePath &&
                    !["running", "waiting", "queued"].includes(task.status) &&
                    !task.testCheckout && (
                      <button
                        disabled={busy}
                        title="Coloca a pasta do projeto no código desta tarefa, para você testar. Sua branch original é guardada e volta com o botão ao lado."
                        onClick={() => {
                          if (
                            window.confirm(
                              `Colocar a pasta do projeto no código de "${task.branch}" para teste? A branch atual da sua pasta muda temporariamente. Alterações não commitadas impedem a troca.`,
                            )
                          )
                            void act("testActivate");
                        }}
                      >
                        Testar na pasta do projeto
                      </button>
                    )}
                  {task.testCheckout && (
                    <button
                      disabled={busy}
                      className="primary"
                      title="Volta a pasta do projeto para a branch que estava antes do teste"
                      onClick={() => {
                        if (window.confirm("Voltar a pasta do projeto para a branch original?"))
                          void act("testRestore");
                      }}
                    >
                      Voltar pasta do projeto
                    </button>
                  )}
                  {["running", "waiting"].includes(task.status) && (
                    <button
                      disabled={busy || task.provider === "antigravity"}
                      title={
                        task.provider === "antigravity"
                          ? "O Antigravity não tem comando de saída verificado. Use Cancelar execução."
                          : "Pede à CLI para sair pelo comando dela e leva a tarefa à revisão. As alterações são preservadas."
                      }
                      onClick={() => {
                        if (
                          window.confirm(
                            "Encerrar a CLI e levar a tarefa para revisão? As alterações da pasta são preservadas.",
                          )
                        )
                          void act("endSession");
                      }}
                    >
                      Encerrar e revisar
                    </button>
                  )}
                  {task.branchCreated && !["running", "waiting", "queued"].includes(task.status) && (
                    <button disabled={busy} onClick={openReview}>
                      Revisar alterações
                    </button>
                  )}
                  {task.status === "review" && (
                    <button disabled={busy} onClick={() => act("finish")}>
                      Concluir tarefa
                    </button>
                  )}
                  {task.status === "completed" && !task.published && (
                    <button disabled={busy} className="primary" onClick={() => void openPublish()}>
                      Publicar branch no remoto
                    </button>
                  )}
                  {task.published && <span className="published">Branch publicada</span>}
                </div>
              </div>
              {task.status === "queued" &&
                events.at(-1)?.message.startsWith("Aguardando: a pasta do projeto") && (
                  <div className="notice">
                    <p>{events.at(-1)?.message}</p>
                    <div className="notice-actions">
                      <button
                        disabled={busy}
                        onClick={() => perform(() => request({ action: "retryStart", taskId: task.id }))}
                      >
                        Tentar agora
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Guardar as alterações da pasta do projeto com git stash? Para recuperar depois: git stash pop.",
                            )
                          )
                            perform(() => request({ action: "stashPending", taskId: task.id }));
                        }}
                      >
                        Guardar alterações (stash)
                      </button>
                    </div>
                  </div>
                )}
              {task.status === "interrupted" && (
                <p className="notice">
                  Processo interrompido. A sessão anterior não é recuperável: revise os arquivos ou
                  coloque a tarefa na fila de novo.
                </p>
              )}
              <div className="tab-body" ref={bodyRef} style={bodyStyle()}>
                {shown("Chat") && (
                  <div className="tab-slot bare" style={place("Chat")}>
                    <ChatPane taskId={task.id} provider={task.provider} onError={report} />
                  </div>
                )}
                {shown("Terminal") && (
                  <div className="tab-slot bare" style={place("Terminal")}>
                  <TerminalPane
                    key={task.id}
                    taskId={task.id}
                    provider={task.provider}
                    status={task.status}
                    active={
                      ["running", "waiting"].includes(task.status) && task.terminalReady !== false
                    }
                    onError={report}
                  />
                  </div>
                )}
                {task.branchCreated && (
                  // Fica montado ao trocar de aba: o shell não morre por você olhar o Diff.
                  <div className="shell-slot tab-slot bare" style={place("Shell")} hidden={!shown("Shell")}>
                    <ShellPane
                      key={task.id}
                      scopeKey={task.id}
                      openSession={() => request<string>({ action: "shellOpen", taskId: task.id })}
                      onError={report}
                    />
                  </div>
                )}
                {(sessions[task.id] ?? []).map((s) => (
                  <div
                    key={s.key}
                    className="shell-slot tab-slot bare"
                    style={place(`session:${s.key}`)}
                    hidden={!shown(`session:${s.key}`)}
                  >
                    <ShellPane
                      scopeKey={s.key}
                      openSession={() =>
                        request<string>({
                          action: "shellOpen",
                          taskId: task.id,
                          provider: s.provider,
                          prompt: s.prompt,
                        })
                      }
                      onError={report}
                    />
                  </div>
                ))}
                {shown("Diff") && (
                  <div className="tab-slot" style={place("Diff")}>
                  {
                  (!review ? (
                    <div className="empty">
                      Carregue a revisão para comparar as alterações.
                      <button disabled={busy} onClick={openReview}>
                        Carregar diff
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="file-tabs">
                        {review.files.map((f) => (
                          <button
                            key={f.path}
                            className={"chip " + (file === f.path ? "active" : "")}
                            style={{ ["--chip-color" as string]: CHANGE_COLOR[f.status] }}
                            title={`${CHANGE_WORD[f.status]} · ${f.path}`}
                            onClick={() => setFile(f.path)}
                          >
                            <span className="chip-status">{CHANGE_WORD[f.status]}</span>
                            <span className="chip-dir">{f.path.slice(0, f.path.lastIndexOf("/") + 1)}</span>
                            <span className="chip-name">{f.path.slice(f.path.lastIndexOf("/") + 1)}</span>
                          </button>
                        ))}
                      </div>
                      {review.files.find((f) => f.path === file) ? (
                        <DiffPane file={review.files.find((f) => f.path === file)!} />
                      ) : (
                        <div className="empty">Nenhuma alteração encontrada nesta branch.</div>
                      )}
                      {review.overlaps.map((o) => (
                        <p className="notice" key={o.taskId}>
                          Arquivos também alterados em “{o.title}”: {o.paths.join(", ")}
                        </p>
                      ))}
                      <label className="summary">
                        Resumo da revisão
                        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} />
                      </label>
                      <button
                        disabled={busy}
                        onClick={() =>
                          perform(() => request({ action: "summary", taskId: task.id, summary }))
                        }
                      >
                        Salvar resumo
                      </button>
                    </>
                  ))}
                  </div>
                )}
                {shown("Arquivos") && (
                  <div className="tab-slot" style={place("Arquivos")}>
                  <div className="files-layout">
                    <FileTree
                      taskId={task.id}
                      selected={file}
                      onError={report}
                      onOpen={(path, writable) =>
                        navigate(() => {
                          setFileWritable(writable);
                          setFile(path);
                        })
                      }
                    />
                    <div className="files-editor">
                      {file ? (
                        <FileEditor
                          key={task.id + file}
                          taskId={task.id}
                          path={file}
                          readOnly={!fileWritable}
                          onError={report}
                          onDirty={setDirty}
                        />
                      ) : (
                        <div className="empty">Escolha um arquivo na árvore.</div>
                      )}
                    </div>
                  </div>
                  </div>
                )}
                {shown("Histórico") && (
                  <div className="tab-slot" style={place("Histórico")}>
                  <div className="history">
                    {events.length === 0 ? (
                      <div className="empty">Nenhum evento registrado.</div>
                    ) : (
                      events.map((e) => (
                        <div key={e.id}>
                          <i />
                          <div>
                            <div className="history-head">
                              <strong>{e.kind}</strong>
                              <small>{date(e.createdAt)}</small>
                            </div>
                            <p>{e.message}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  </div>
                )}
                {shown("Checks") && (
                  <div className="tab-slot" style={place("Checks")}>
                  <>
                    <form
                      className="check-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void perform(() =>
                          request({ action: "runCheck", taskId: task.id, command }),
                        );
                      }}
                    >
                      <label>
                        Comando no repositório desta tarefa
                        <input
                          value={command}
                          onChange={(e) => setCommand(e.target.value)}
                          required
                          placeholder="Ex.: npm test"
                        />
                      </label>
                      <button
                        disabled={
                          busy ||
                          !command.trim() ||
                          ["running", "waiting", "queued"].includes(task.status)
                        }
                      >
                        Executar comando
                      </button>
                    </form>
                    <p className="notice">
                      Executa o comando digitado no repositório selecionado. Revise-o antes de
                      executar.
                    </p>
                    {checks.map((c) => (
                      <details key={c.id}>
                        <summary>
                          <span className={"status " + c.status}>{c.status}</span> {c.command} ·
                          saída {c.exitCode ?? "pendente"}
                        </summary>
                        <pre>{c.output || "Sem saída registrada."}</pre>
                      </details>
                    ))}
                  </>
                  </div>
                )}
                {secondTab && (
                  <div
                    className={"split-resize " + splitDir}
                    role="separator"
                    aria-label="Divisão entre painéis"
                    aria-orientation={splitDir === "right" ? "vertical" : "horizontal"}
                    style={splitDir === "right" ? { gridColumn: 2, gridRow: 1 } : { gridColumn: 1, gridRow: 2 }}
                    onPointerDown={resizeSplit}
                  />
                )}
                {secondTab && (
                  <button
                    className="pane-close"
                    style={place(secondTab)}
                    title="Fechar este painel"
                    aria-label="Fechar este painel"
                    onClick={() => navigate(() => setSecondTab(null))}
                  >
                    ×
                  </button>
                )}
                {dragTab && (
                  <div
                    className="drop-layer"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropZone(zoneAt(e, e.currentTarget));
                    }}
                    onDragLeave={() => setDropZone(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      const zone = zoneAt(e, e.currentTarget);
                      setDropZone(null);
                      setDragTab(null);
                      dropOn(dragTab, zone);
                    }}
                  >
                    {dropZone && <div className={"drop-preview " + dropZone} />}
                  </div>
                )}
              </div>
            </section>
          )}
          {remoteFile && (
            // Por cima da área atual: fechar devolve a tela de onde você saiu, com o terminal vivo.
            <div className="remote-overlay">
              <RemoteViewer
                key={remoteFile.connectionId + remoteFile.path}
                connectionId={remoteFile.connectionId}
                serverName={snapshot?.settings.ssh.find((c) => c.id === remoteFile.connectionId)?.name ?? "servidor"}
                path={remoteFile.path}
                onError={report}
                onClose={() => setRemoteFile(null)}
              />
            </div>
          )}
        </main>
        <footer className="statusbar">
          <span>
            <GitBranch size={11} />
            {task?.branch ?? "Golfinho"}
            {dirty && <em> · arquivo não salvo</em>}
          </span>
          <div className="agent-status">
            {snapshot?.agents.map((a) => (
              <span key={a.provider} title={a.executable}>
                <i className={a.available ? "ready" : "unavailable"} />
                <AgentIcon provider={a.provider} /> {a.label}
              </span>
            ))}
          </div>
          <span>
            {snapshot
              ? `${snapshot.tasks.filter((t) => t.status === "running").length} em execução · ${snapshot.tasks.filter((t) => t.status === "queued").length} na fila`
              : "Conectando…"}
          </span>
        </footer>
      </div>
      {inspector && (
        <aside className="inspector" aria-label="Inspetor da tarefa">
          <div className="inspector-heading">
            <Server size={14} />
            <strong>Servidores</strong>
          </div>
          <div className="inspector-section">

            {/* Só aparecem as VPS com terminal SSH aberto: a árvore acompanha a conexão. */}
            {(snapshot?.settings.ssh ?? []).filter((c) => general.some((g) => g.connectionId === c.id)).length === 0 && (
              <p className="notice">Conecte uma VPS pelo terminal SSH para ver os arquivos aqui.</p>
            )}
            {(snapshot?.settings.ssh ?? [])
              .filter((c) => general.some((g) => g.connectionId === c.id))
              .map((c) => (
              <div key={c.id} className="server-group">
                <div className="server-head">
                <button
                  className="server-row"
                  aria-expanded={Boolean(sshOpen[c.id])}
                  onClick={() => setSshOpen((open) => ({ ...open, [c.id]: !open[c.id] }))}
                >
                  {sshOpen[c.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Server size={12} />
                  <span>{c.name}</span>
                </button>
                <button
                  className="server-disconnect"
                  title="Desconectar: fecha os terminais SSH desta VPS e some com os arquivos"
                  onClick={() => {
                    setGeneral((all) => all.filter((g) => g.connectionId !== c.id));
                    setRemoteFile((current) => (current?.connectionId === c.id ? null : current));
                  }}
                >
                  Desconectar
                </button>
                </div>
                {sshOpen[c.id] && (
                  <RemoteTree
                    connection={c}
                    selected={remoteFile?.connectionId === c.id ? remoteFile.path : null}
                    onOpenFile={(path) => openRemoteFile(c.id, path)}
                  />
                )}
              </div>
            ))}
          </div>
          {!activeGeneral && !sshView && task ? (
            <>
              <div className="inspector-section">
                <h3>{task.title}</h3>
                <span className={"status " + task.status}>{labels[task.status]}</span>
                <dl>
                  <dt>Projeto</dt>
                  <dd>{snapshot?.projects.find((p) => p.id === task.projectId)?.name}</dd>
                  <dt>Agente</dt>
                  <dd><AgentIcon provider={task.provider} /> {task.provider}</dd>
                  <dt>Branch</dt>
                  <dd>{task.branch}</dd>
                  <dt>Base</dt>
                  <dd>{task.base}</dd>
                  <dt>Remoto</dt>
                  <dd>{task.remote}</dd>
                  <dt>Publicação</dt>
                  <dd>{task.published ? "Publicada" : "Não publicada"}</dd>
                </dl>
              </div>
              <div className="inspector-section instructions">
                <h4>Instruções</h4>
                <p>{task.prompt}</p>
              </div>
              <div className="inspector-files">
                <div className="sidebar-label">
                  Alterações
                  <button
                    disabled={busy || !task.branchCreated}
                    aria-label="Atualizar arquivos alterados"
                    title="Atualizar arquivos alterados"
                    onClick={openReview}
                  >
                    <Activity size={12} />
                  </button>
                </div>
                {review ? (
                  <>
                    <div className="search">
                      <Search size={12} />
                      <input
                        type="search"
                        aria-label="Buscar arquivos alterados"
                        placeholder="Buscar arquivos"
                        value={fileQuery}
                        onChange={(e) => setFileQuery(e.target.value)}
                      />
                    </div>
                    {review.files
                      .filter((f) =>
                        f.path.toLocaleLowerCase().includes(fileQuery.toLocaleLowerCase()),
                      )
                      .map((f) => (
                        <button
                          className={"inspector-file " + (file === f.path ? "selected" : "")}
                          key={f.path}
                          title={f.path}
                          onClick={() =>
                            navigate(() => {
                              setFile(f.path);
                              setTab("Diff");
                            })
                          }
                        >
                          <Files size={12} />
                          <span>{f.path}</span>
                          <small>{f.status}</small>
                        </button>
                      ))}
                    {review.files.length === 0 && (
                      <p className="side-hint">Nenhum arquivo alterado.</p>
                    )}
                  </>
                ) : (
                  <p className="side-hint">Carregue a revisão para ver os arquivos alterados.</p>
                )}
              </div>
            </>
          ) : !sshView && !activeGeneral ? (
            <div className="empty inspector-empty">
              <Files size={22} />
              <p>Selecione uma tarefa para inspecionar a branch e suas alterações.</p>
            </div>
          ) : null}
        </aside>
      )}
      {modal && snapshot && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal === "task" ? "Nova tarefa" : "Configurações"}
          >
            <div className="modal-title">
              <h2>{modal === "task" ? "Nova tarefa" : "Configurações"}</h2>
              <button
                aria-label="Fechar janela"
                disabled={busy}
                onClick={() => {
                  setModal(null);
                  setError("");
                }}
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {modal === "task" ? (
              <TaskForm
                snapshot={snapshot}
                projectId={project}
                busy={busy}
                onSubmit={(input) =>
                  perform(async () => {
                    await request({ action: "createTask", input });
                    setModal(null);
                  })
                }
              />
            ) : (
              <SettingsForm
                settings={snapshot.settings}
                projects={snapshot.projects}
                busy={busy}
                onSubmit={(settings) =>
                  perform(async () => {
                    await request({ action: "settings", settings });
                    setModal(null);
                  })
                }
              />
            )}
          </div>
        </div>
      )}
      {publishDialog && task && (
        <div className="modal-backdrop">
          <div className="modal confirm" role="dialog" aria-modal="true" aria-label="Publicar branch">
            <div className="modal-title">
              <h2>{publishDialog.count === 0 ? "Publicar branch" : "Fazer os commits antes de publicar"}</h2>
            </div>
            {publishDialog.count === 0 ? (
              <p>
                Não há alterações sem commit. A branch <strong>{task.branch}</strong> está pronta para
                ser enviada ao remoto <strong>{task.remote}</strong>.
              </p>
            ) : (
              <>
                <p>
                  Há {publishDialog.count} alteração(ões) sem commit em <strong>{task.branch}</strong>.
                  O pedido abaixo vai para o agente, que faz os commits na pasta da tarefa. Nada é
                  enviado ao remoto por ele.
                </p>
                <label>
                  Agente
                  <select
                    value={publishDialog.agent}
                    onChange={(e) =>
                      setPublishDialog({ ...publishDialog, agent: e.target.value as Provider })
                    }
                  >
                    {snapshot?.agents
                      .filter((a) => a.available)
                      .map((a) => (
                        <option key={a.provider} value={a.provider}>
                          {a.label}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Pedido
                  <textarea
                    rows={6}
                    value={publishDialog.prompt}
                    onChange={(e) => setPublishDialog({ ...publishDialog, prompt: e.target.value })}
                  />
                </label>
              </>
            )}
            <div className="modal-actions">
              <button onClick={() => setPublishDialog(null)}>Cancelar</button>
              {publishDialog.count === 0 ? (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setPublishDialog(null);
                    void act("publish");
                  }}
                >
                  Publicar branch
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!publishDialog.prompt.trim()}
                  onClick={sendCommitRequest}
                >
                  Enviar pedido ao agente
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {deleting && (
        <div className="modal-backdrop">
          <div className="modal confirm" role="dialog" aria-modal="true" aria-label="Excluir tarefa">
            <div className="modal-title">
              <h2>Excluir tarefa</h2>
              <button
                aria-label="Fechar janela"
                disabled={busy}
                onClick={() => {
                  setDeleting("");
                  setError("");
                }}
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <DeleteDialog
              taskId={deleting}
              busy={busy}
              onError={report}
              onCancel={() => {
                setDeleting("");
                setError("");
              }}
              onConfirm={() =>
                perform(async () => {
                  await request({ action: "deleteTask", taskId: deleting });
                  setDeleting("");
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
function TaskForm({
  snapshot,
  projectId,
  busy,
  onSubmit,
}: {
  snapshot: Snapshot;
  projectId: string;
  busy: boolean;
  onSubmit: (input: CreateTask) => void;
}) {
  const [p, setP] = useState(projectId || snapshot.projects[0]?.id || "");
  const project = snapshot.projects.find((x) => x.id === p);
  const [refs, setRefs] = useState<ProjectRefs | null>(null);
  const [refsFailed, setRefsFailed] = useState(false);
  // Trabalhar numa branch que já existe, em vez de criar uma golfinho/... nova.
  const [adopt, setAdopt] = useState(false);
  useEffect(() => {
    if (!p) return;
    let alive = true;
    setRefs(null);
    setRefsFailed(false);
    request<ProjectRefs>({ action: "branches", projectId: p })
      .then((result) => alive && setRefs(result))
      .catch(() => alive && setRefsFailed(true));
    return () => {
      alive = false;
    };
  }, [p]);
  // Sem lista utilizável o campo volta a aceitar texto, em vez de travar a criação.
  const typedBase = refsFailed || refs?.branches.length === 0;
  const loadingRefs = !refs && !refsFailed;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const existing = String(data.get("existing"));
        onSubmit({
          projectId: p,
          title: String(data.get("title")),
          prompt: String(data.get("prompt")),
          provider: data.get("provider") as Provider,
          branch: adopt ? existing : String(data.get("branch")),
          base: adopt ? existing : String(data.get("base")),
          remote: String(data.get("remote")),
          timeoutMinutes: Number(data.get("timeout")),
          ...(adopt ? { adopt: true } : {}),
        });
      }}
    >
      <p className="form-intro">
        Descreva o resultado esperado, se quiser. A tarefa será criada como rascunho.
      </p>
      <div className="form-grid">
        <label>
          Projeto
          <select value={p} onChange={(e) => setP(e.target.value)}>
            {snapshot.projects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agente
          <select name="provider">
            {(["codex", "claude", "antigravity"] as const).map((provider) => (
              <option key={provider}>{provider}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Título
        <input name="title" placeholder="Opcional. Sem ele, usa o nome da branch" />
      </label>
      <label>
        Instruções
        <textarea
          name="prompt"
          rows={5}
          placeholder="Opcional. Contexto, resultado esperado e critérios de aceite. Sem elas, a CLI abre vazia"
        />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={adopt} onChange={(e) => setAdopt(e.target.checked)} />
        Trabalhar em uma branch que já existe
      </label>
      <div className="form-grid">
        {adopt ? (
          <label>
            Branch existente
            <select key={`existing:${p}`} name="existing" required defaultValue={refs?.current || ""}>
              {(refs?.branches ?? []).map((b) => (
                <option key={b} value={b}>
                  {b}
                  {b === refs?.current ? " · atual" : ""}
                </option>
              ))}
            </select>
            <small className="form-hint-block">
              A tarefa entra nesta branch e trabalha diretamente nela. Ela não pode estar aberta em
              outra pasta. Excluir a tarefa nunca apaga essa branch.
            </small>
          </label>
        ) : (
          <label>
            Branch da tarefa
            <input name="branch" required placeholder="golfinho/minha-tarefa" />
          </label>
        )}
        {!adopt && (
        <label>
          Branch base
          {typedBase ? (
            <input name="base" defaultValue="main" required />
          ) : (
            <select
              key={`${p}:${refs ? "pronto" : "carregando"}`}
              name="base"
              required
              defaultValue={refs?.current || refs?.branches[0] || ""}
            >
              {refs ? (
                refs.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                    {b === refs.current ? " · atual" : ""}
                  </option>
                ))
              ) : (
                <option value="">Lendo branches…</option>
              )}
            </select>
          )}
        </label>
        )}
        <label>
          Remoto
          <select key={p} name="remote" required>
            {(project?.remotes ?? []).map((remote) => (
              <option key={remote}>{remote}</option>
            ))}
          </select>
        </label>
        <label>
          Timeout (minutos)
          <input name="timeout" type="number" min={0} max={1440} defaultValue={60} required />
        </label>
      </div>
      <p className="notice">
        Timeout 0 desativa o limite de tempo. A branch é criada localmente na execução. Publicação
        exige sua ação explícita.
      </p>
      {!project?.remotes.length && (
        <p className="notice">
          Este projeto não tem um remoto Git configurado. Configure um remoto no repositório antes
          de criar a tarefa.
        </p>
      )}
      <button className="primary full" disabled={busy || !project?.remotes.length || loadingRefs}>
        {busy ? "Criando…" : "Criar tarefa"}
      </button>
    </form>
  );
}
const LABELS: Record<string, string> = { "5h": "Janela de 5 h", weekly: "Semanal" };
const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
function reset(value: string) {
  if (!value) return "";
  const parsed = Date.parse(value);
  return isFinite(parsed) ? quando.format(parsed) : value;
}
// As CLIs não avisam quando o consumo muda, então o painel pergunta a cada minuto.
// Só existe enquanto está aberto: sair da aba para a consulta.
const USAGE_INTERVAL_MS = 60_000;
const PROVIDER_LABEL: Record<Provider, string> = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Antigravity",
};
type UsageState = { quota: ProviderQuota | null; busy: boolean; failed: boolean; at: Date | null };
function UsageDashboard() {
  const [usage, setUsage] = useState<Record<Provider, UsageState>>(() => ({
    codex: { quota: null, busy: false, failed: false, at: null },
    claude: { quota: null, busy: false, failed: false, at: null },
    antigravity: { quota: null, busy: false, failed: false, at: null },
  }));
  const update = (provider: Provider, patch: Partial<UsageState>) =>
    setUsage((current) => ({ ...current, [provider]: { ...current[provider], ...patch } }));
  const load = useCallback(async () => {
    await Promise.all(
      (Object.keys(PROVIDER_LABEL) as Provider[]).map(async (provider) => {
        update(provider, { busy: true });
        try {
          const quota = await request<ProviderQuota>({ action: "quota", provider, refresh: true });
          update(provider, { quota, busy: false, failed: false, at: new Date() });
        } catch {
          update(provider, { busy: false, failed: true });
        }
      }),
    );
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), USAGE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);
  const busy = Object.values(usage).some((u) => u.busy);
  return (
    <section className="usage-dashboard">
      <div className="overview-head">
        <h1>Consumo</h1>
        <span>Atualizado sozinho a cada minuto</span>
        <button disabled={busy} onClick={() => void load()}>
          <RefreshCw size={12} />
          Atualizar agora
        </button>
      </div>
      <div className="usage-cards">
        {(Object.keys(PROVIDER_LABEL) as Provider[]).map((provider) => {
          const u = usage[provider];
          return (
            <article className="usage-card" key={provider}>
              <header>
                <strong>{PROVIDER_LABEL[provider]}</strong>
                {u.quota?.plan && <span>{u.quota.plan}</span>}
              </header>
              <QuotaPanel quota={u.quota} busy={u.busy} failed={u.failed} />
              {u.at && (
                <small className="usage-stamp">
                  Atualizado às {u.at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </small>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
function QuotaPanel({
  quota,
  busy,
  failed,
}: {
  quota: ProviderQuota | null;
  busy: boolean;
  failed: boolean;
}) {
  if (!quota)
    return (
      <p className="usage-note">
        {busy ? "Consultando a CLI…" : failed ? "Não foi possível consultar a CLI." : "—"}
      </p>
    );
  if (!quota.available || !quota.groups.length)
    return <p className="usage-note">{quota.error || "A CLI não informou limites."}</p>;
  return (
    <>
      {quota.groups.map((group, index) => (
        <div className="quota-group" key={group.name || index}>
          {group.name && <h5>{group.name}</h5>}
          {group.windows.map((w) => (
            <div className="quota-row" key={w.window}>
              <div className="quota-head">
                <span>{LABELS[w.window] ?? w.window}</span>
                <strong>{w.usedPercent}%</strong>
              </div>
              <div
                className="quota-bar"
                role="meter"
                aria-label={`${LABELS[w.window] ?? w.window}: ${w.usedPercent}% usado`}
                aria-valuenow={w.usedPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i
                  data-level={w.usedPercent >= 90 ? "alto" : w.usedPercent >= 70 ? "medio" : "ok"}
                  style={{ width: `${w.usedPercent}%` }}
                />
              </div>
              {w.resetsAt && <small>renova em {reset(w.resetsAt)}</small>}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
function DeleteDialog({
  taskId,
  busy,
  onCancel,
  onConfirm,
  onError,
}: {
  taskId: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onError: (e: unknown) => void;
}) {
  const [info, setInfo] = useState<DeleteInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setFailed(false);
    request<DeleteInfo>({ action: "deleteInfo", taskId })
      .then((result) => alive && setInfo(result))
      .catch((e) => {
        if (!alive) return;
        setFailed(true);
        onError(e);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);
  // Sem os fatos do repositório não dá para dizer o que seria apagado, então a
  // exclusão não é oferecida.
  if (failed)
    return (
      <div className="confirm-body">
        <p className="form-intro">
          Não foi possível ler o estado do repositório, então não dá para mostrar o que seria
          apagado. Nada foi alterado.
        </p>
        <div className="confirm-actions">
          <button onClick={onCancel}>Fechar</button>
        </div>
      </div>
    );
  if (!info) return <p className="form-intro">Lendo o estado do repositório…</p>;
  return (
    <div className="confirm-body">
      <p className="form-intro">
        Excluir <strong>{info.title}</strong> e tudo que o Golfinho guarda sobre ela.
      </p>
      <ul className="confirm-list">
        {info.branchExists ? (
          <li>
            Apaga a branch local <code>{info.branch}</code> com <code>git branch -D</code>.
          </li>
        ) : (
          <li>
            A branch <code>{info.branch}</code> não existe mais no repositório; nada será apagado no
            git.
          </li>
        )}
        {info.branchExists &&
          (info.ahead === null ? (
            <li className="danger">
              Não foi possível medir o que há nesta branch além de <code>{info.base}</code>. Confira
              no git antes de seguir.
            </li>
          ) : info.ahead > 0 ? (
            <li className="danger">
              {info.ahead} commit{info.ahead > 1 ? "s" : ""} desta branch não {info.ahead > 1 ? "estão" : "está"} em{" "}
              <code>{info.base}</code> e {info.ahead > 1 ? "serão perdidos" : "será perdido"}.
            </li>
          ) : (
            <li>
              Não há commits além de <code>{info.base}</code>: nenhum trabalho commitado se perde.
            </li>
          ))}
        {info.active && (
          <li>
            O repositório está nesta branch, então ele será trocado para <code>{info.base}</code>{" "}
            antes da exclusão.
          </li>
        )}
        {info.published && (
          <li>
            A branch publicada no remoto <strong>não</strong> será removida; apague-a pelo seu
            fluxo normal se quiser.
          </li>
        )}
        <li>Apaga o histórico de eventos, os checks e o log do terminal desta tarefa.</li>
      </ul>
      {info.blocked ? (
        <p className="notice danger">
          <TriangleAlert size={14} /> {info.blocked}
        </p>
      ) : (
        <p className="notice">Esta ação não pode ser desfeita.</p>
      )}
      <div className="confirm-actions">
        <button disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button className="danger" disabled={busy || !!info.blocked} onClick={onConfirm}>
          {busy ? "Excluindo…" : "Excluir definitivamente"}
        </button>
      </div>
    </div>
  );
}
function SettingsForm({
  settings,
  projects,
  busy,
  onSubmit,
}: {
  settings: Settings;
  projects: Project[];
  busy: boolean;
  onSubmit: (s: Settings) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        onSubmit({
          concurrency: Number(d.get("concurrency")),
          executables: {
            codex: String(d.get("codex")),
            claude: String(d.get("claude")),
            antigravity: String(d.get("antigravity")),
          },
          ssh: settings.ssh,
          setup: Object.fromEntries(
            projects
              .map((p) => [p.id, String(d.get(`setup:${p.id}`) ?? "").trim()] as const)
              .filter(([, command]) => command),
          ),
        });
      }}
    >
      <label>
        Execuções simultâneas
        <input
          name="concurrency"
          type="number"
          min={1}
          max={8}
          defaultValue={settings.concurrency}
          required
        />
      </label>
      <p className="notice">
        Cada tarefa tem sua própria pasta de trabalho. O limite acima vale para o total de
        execuções e checks.
      </p>
      {(["codex", "claude", "antigravity"] as const).map((p) => (
        <label key={p}>
          Executável {p}
          <input name={p} defaultValue={settings.executables[p]} required />
        </label>
      ))}
      <h4>Setup das pastas de trabalho</h4>
      <p className="notice">
        Comando executado dentro da pasta nova de cada tarefa, antes de a CLI iniciar. Por
        exemplo, <code>npm ci</code>. Vazio significa que não há nada a fazer.
      </p>
      {projects.map((p) => (
        <label key={p.id}>
          {p.name}
          <input
            name={`setup:${p.id}`}
            defaultValue={settings.setup[p.id] ?? ""}
            placeholder="Ex.: npm ci"
            maxLength={2000}
          />
        </label>
      ))}
      <button className="primary full" disabled={busy}>
        Salvar configurações
      </button>
    </form>
  );
}
