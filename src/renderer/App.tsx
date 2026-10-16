import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderGit2,
  Plus,
  Settings as SettingsIcon,
  GitBranch,
  List,
  X,
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
  CircleHelp,
  Columns2,
  Maximize2,
  ShieldQuestion,
} from "lucide-react";
import type {
  Snapshot,
  Task,
  Request,
  CreateTask,
  Settings,
  Project,
  Provider,
  ProjectRefs,
  DeleteInfo,
  ProviderQuota,
} from "../shared/contracts";
import { TaskWorkspace, type TaskWorkspaceHandle } from "./TaskWorkspace";
import { PermissionNotices } from "./PermissionNotices";
import { usePermissionRequests } from "./usePermissionRequests";
import type { PermissionRequest } from "./permissionRequests";
import { ShellPane } from "./ShellPane";
import { AgentIcon } from "./agentIcons";
import { AgentQuotaTip } from "./AgentQuota";
import { SshPanel } from "./SshPanel";
import { HelpPane } from "./HelpPane";
import { RemoteTree } from "./RemoteTree";
import { RemoteViewer } from "./RemoteViewer";
import { UI_SCALES, applyUiScale, readUiScale } from "./uiScale";
import { UpdateBanner } from "./UpdateBanner";
import golfinhoLogo from "../../build/icon.png";

const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
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
const AGENT_NAMES: Record<string, string> = { codex: "Codex", claude: "Claude", antigravity: "Antigravity" };
const OPEN_KEY = "golfinho.workspaces";
const clampTaskRatio = (value: number) => Math.max(0.2, Math.min(0.8, value));
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [project, setProject] = useState(""),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState<"task" | "settings" | null>(null);
  const [dirty, setDirty] = useState(false);
  const { pending: permissionRequests, answeredTerminal } = usePermissionRequests(snapshot?.tasks);
  const permissionTasks = new Set(permissionRequests.map((request) => request.taskId));
  const [permissionTarget, setPermissionTarget] = useState<PermissionRequest | null>(null);
  const [query, setQuery] = useState(""),
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
  const [splitTasks, setSplitTasks] = useState<string[]>([]);
  const [taskRatio, setTaskRatio] = useState(0.5);
  const taskArea = useRef<HTMLDivElement>(null);
  const panels = useRef<Record<string, TaskWorkspaceHandle>>({});
  const [inspectorHost, setInspectorHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!permissionTarget || selected !== permissionTarget.taskId) return;
    const panel = panels.current[permissionTarget.taskId];
    if (!panel) return;
    panel.openPermission(permissionTarget.source, permissionTarget.approvalId);
    setPermissionTarget(null);
  }, [permissionTarget, selected, open]);
  const [dashboard, setDashboard] = useState(false);
  const [sshView, setSshView] = useState(false);
  const [helpView, setHelpView] = useState(false);
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
  // Qualquer outra visão desliga a Ajuda.
  useEffect(() => {
    if (dashboard || activeGeneral || selected || sshView) setHelpView(false);
  }, [dashboard, activeGeneral, selected, sshView]);
  const resizeCleanup = useRef<() => void>(() => {});
  useEffect(() => () => resizeCleanup.current(), []);
  const snapshotEpoch = useRef(0);
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
  useEffect(() => {
    void refresh();
    const dispose = window.golfinho.subscribe((s) => {
      if (s.kind === "changed") {
        void refresh();
      }
    });
    return dispose;
  }, [refresh]);
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
    const remaining = splitTasks.filter((id) => snapshot.tasks.some((t) => t.id === id));
    if (remaining.length !== splitTasks.length) setSplitTasks(remaining.length === 2 ? remaining : []);
    if (selectedRef.current && !snapshot.tasks.some((t) => t.id === selectedRef.current))
      setSelected(remaining[0] ?? "");
  }, [snapshot, splitTasks]);
  const task = snapshot?.tasks.find((t) => t.id === selected);
  const matches = (t: Task) =>
    [t.title, t.branch, t.prompt, snapshot?.projects.find((p) => p.id === t.projectId)?.name ?? ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase());
  const tasks =
    snapshot?.tasks.filter((t) => (!project || t.projectId === project) && matches(t)) ?? [];
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  // Consumo mostrado ao passar o mouse na barra inferior. O serviço já guarda a leitura por um minuto.
  const [quotaTips, setQuotaTips] = useState<Partial<Record<Provider, ProviderQuota>>>({});
  const [quotaLoading, setQuotaLoading] = useState<Set<Provider>>(new Set());
  async function loadQuotaTip(provider: Provider) {
    setQuotaLoading((all) => new Set(all).add(provider));
    try {
      const quota = await request<ProviderQuota>({ action: "quota", provider });
      setQuotaTips((all) => ({ ...all, [provider]: quota }));
    } catch (e) {
      setQuotaTips((all) => ({
        ...all,
        [provider]: { provider, available: true, plan: "", groups: [], error: (e as Error).message },
      }));
    } finally {
      setQuotaLoading((all) => {
        const next = new Set(all);
        next.delete(provider);
        return next;
      });
    }
  }
  function navigate(action: () => void) {
    // Mudar de visão apenas oculta os painéis; os editores e sessões continuam montados.
    setDirty(false);
    action();
  }
  function splitWith(id: string) {
    if (!selected || selected === id) return;
    setSplitTasks([selected, id]);
    setOpen((current) => current.includes(id) ? current : [...current, id]);
    setSelected(id);
    setDashboard(false);
    setSshView(false);
    setHelpView(false);
    setActiveGeneral("");
  }
  function showOnlyFocused() {
    setSplitTasks([]);
  }
  function resizeTasks(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeCleanup.current();
    const move = (event: PointerEvent) => {
      const box = taskArea.current?.getBoundingClientRect();
      if (box?.width) setTaskRatio(clampTaskRatio((event.clientX - box.left) / box.width));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    resizeCleanup.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
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
  function openTask(id: string) {
    if (splitTasks.includes(id)) {
      setSelected(id);
      setDashboard(false);
      setActiveGeneral("");
      setSshView(false);
      setHelpView(false);
      return;
    }
    navigate(() => {
      setDashboard(false);
      setActiveGeneral("");
      setSelected(id);
      setSplitTasks((current) => current.length === 2
        ? current.map((item, index) => (current.includes(selected) ? item === selected : index === 0) ? id : item)
        : []);
      setOpen((list) => (list.includes(id) ? list : [...list, id]));
    });
  }
  // Fechar é só tirar da barra: não toca na tarefa nem no repositório.
  function closeTask(id: string) {
    if (panels.current[id]?.canLeave() === false) return;
    const drop = () => {
      const position = open.indexOf(id);
      const rest = open.filter((x) => x !== id);
      setOpen(rest);
      if (splitTasks.includes(id)) {
        setSplitTasks([]);
        setSelected(splitTasks.find((item) => item !== id) ?? "");
      } else if (selectedRef.current === id) setSelected(rest[position] ?? rest[position - 1] ?? "");
    };
    drop();
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
      <UpdateBanner />
      <aside className="sidebar" aria-label="Projetos e tarefas">
        <div className="brand">
          <span className="brand-mark">
            <img src={golfinhoLogo} alt="" width={23} height={23} />
          </span>
          <strong>golfinho</strong>
          <button
            aria-label="Ajuda"
            title="Ajuda: como o Golfinho funciona"
            className={helpView ? "active" : ""}
            onClick={() => navigate(() => (setDashboard(false), setSshView(false), setActiveGeneral(""), setSelected(""), setHelpView(true)))}
          >
            <CircleHelp size={14} />
          </button>
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
                  {snapshot.activeBranches?.[p.id] && (
                    <span className="project-branch" title="Branch ativa na pasta do projeto">
                      <GitBranch size={11} />
                      {snapshot.activeBranches[p.id]}
                    </span>
                  )}
                  <small>{snapshot.tasks.filter((t) => t.projectId === p.id).length}</small>
                </button>
                <button
                  className="project-remove"
                  aria-label={`Remover ${p.name} do Golfinho`}
                  title={
                    snapshot.tasks.some((t) => t.projectId === p.id)
                      ? "Exclua as tarefas deste projeto antes de removê-lo"
                      : "Remover do Golfinho (a pasta não é apagada)"
                  }
                  disabled={busy || snapshot.tasks.some((t) => t.projectId === p.id)}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Remover "${p.name}" do Golfinho? A pasta e o repositório Git não são alterados.`,
                      )
                    )
                      return;
                    perform(async () => {
                      await request({ action: "removeProject", projectId: p.id });
                      if (project === p.id) setProject("");
                    });
                  }}
                >
                  <X size={12} />
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
                            <span className="branch-task-dot">
                              <i className={"state-dot " + t.status} />
                            </span>
                            <span className="branch-task-name">{t.title}</span>
                            {permissionTasks.has(t.id) && <ShieldQuestion size={13} className="permission-indicator" aria-label="Aguardando permissão" />}
                            {!t.worktreePath && snapshot.activeBranches?.[p.id] === t.branch && (
                              <span className="branch-active" title="A pasta do projeto está nesta branch">
                                ativa
                              </span>
                            )}
                          </div>
                          <div className="branch-task-meta">
                            <span className={"branch-task-status " + t.status}>
                              {labels[t.status]}
                              {t.status === "running" && ` · ${ago(t.updatedAt, now)}`}
                            </span>
                            <span className="branch-task-agent">
                              <AgentIcon provider={t.provider} />
                              {AGENT_NAMES[t.provider] ?? t.provider}
                            </span>
                          </div>
                          {/* A branch só aparece quando diz algo que o título não diz. */}
                          {t.branch !== t.title && (
                            <div className="branch-task-branch" title={t.branch}>
                              <GitBranch size={11} />
                              <span>{t.branch}</span>
                            </div>
                          )}
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
          {/* Com abas de tarefa ou terminal abertas, as abas fixas mostram só o ícone. */}
          <div
            className={"workspace-tabs" + (open.length || general.length ? " compact" : "")}
            role="tablist"
            aria-label="Workspaces"
          >
            <button
              role="tab"
              aria-label="Visão geral das tarefas"
              title="Tarefas"
              aria-selected={!selected && !dashboard && !sshView && !helpView && !activeGeneral}
              className={!selected && !dashboard && !sshView && !helpView && !activeGeneral ? "active" : ""}
              onClick={() => navigate(() => (setDashboard(false), setSshView(false), setHelpView(false), setActiveGeneral(""), setSelected("")))}
            >
              <List size={12} />
              <span className="nav-label">Tarefas</span>
            </button>
            <button
              role="tab"
              aria-label="Painel de consumo"
              title="Consumo"
              aria-selected={dashboard}
              className={dashboard ? "active" : ""}
              onClick={() => navigate(() => (setDashboard(true), setSshView(false), setActiveGeneral(""), setSelected("")))}
            >
              <Gauge size={12} />
              <span className="nav-label">Consumo</span>
            </button>
            <button
              role="tab"
              aria-label="Conexões SSH"
              title="SSH"
              aria-selected={sshView}
              className={sshView ? "active" : ""}
              onClick={() => navigate(() => (setDashboard(false), setActiveGeneral(""), setSelected(""), setSshView(true)))}
            >
              <Server size={12} />
              <span className="nav-label">SSH</span>
            </button>
            {open
              .map((id) => snapshot?.tasks.find((t) => t.id === id))
              .filter((t): t is Task => !!t)
              .map((t) => (
                <div
                  role="presentation"
                  key={t.id}
                  className={"workspace-tab " + (selected === t.id ? "active" : splitTasks.includes(t.id) ? "visible" : "")}
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
                    {permissionTasks.has(t.id) && <ShieldQuestion size={13} className="permission-indicator" aria-label="Aguardando permissão" />}
                  </button>
                  {selected && selected !== t.id && !splitTasks.includes(t.id) && (
                    <button className="workspace-split" aria-label={`Abrir ${t.branch} ao lado`}
                      title="Abrir esta tarefa ao lado da tarefa atual" onClick={() => splitWith(t.id)}>
                      <Columns2 size={12} />
                    </button>
                  )}
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
          {splitTasks.length === 2 && (
            <button className="workspace-unsplit" aria-label="Exibir apenas esta tarefa"
              title="Exibir apenas a tarefa em foco" onClick={showOnlyFocused}>
              <Maximize2 size={14} />
            </button>
          )}
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
          <PermissionNotices pending={permissionRequests} tasks={snapshot?.tasks ?? []} onOpen={(request) => {
            openTask(request.taskId);
            setRemoteFile(null);
            setPermissionTarget(request);
          }} />
          {error && !modal && (
            <div className="error" role="alert">
              {error}
              <button aria-label="Fechar erro" onClick={() => setError("")}>
                <X size={13} />
              </button>
            </div>
          )}
          {dashboard && <UsageDashboard />}
          {helpView && <HelpPane />}
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
          {!task && !dashboard && !sshView && !helpView && !activeGeneral && (
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
          {snapshot && open.length > 0 && (
            <div className={"task-workspaces" + (splitTasks.length === 2 ? " divided" : "")}
              hidden={!task || dashboard || Boolean(activeGeneral) || sshView || helpView}
              style={splitTasks.length === 2 ? { gridTemplateColumns: `minmax(0, ${taskRatio}fr) 6px minmax(0, ${1 - taskRatio}fr)` } : undefined}
              ref={taskArea}>
              {open.map((id) => {
                const item = snapshot.tasks.find((t) => t.id === id);
                if (!item) return null;
                return <TaskWorkspace key={id} task={item} snapshot={snapshot}
                  ref={(handle) => { if (handle) panels.current[id] = handle; else delete panels.current[id]; }}
                  focused={selected === id} visible={splitTasks.length === 2 ? splitTasks.includes(id) : selected === id}
                  column={splitTasks.indexOf(id) === 1 ? 3 : 1} inspectorHost={inspectorHost}
                  onFocus={setSelected} onClose={closeTask} onChanged={refresh} onError={report} onDirtyChange={setDirty}
                  onTerminalInput={answeredTerminal} />;
              })}
              {splitTasks.length === 2 && <div className="task-divider" role="separator"
                aria-label="Divisão entre tarefas" aria-orientation="vertical" tabIndex={0}
                aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(taskRatio * 100)}
                onPointerDown={resizeTasks} onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    setTaskRatio((value) => clampTaskRatio(value + (event.key === "ArrowRight" ? 0.05 : -0.05)));
                  } else if (event.key === "Home" || event.key === "End") {
                    event.preventDefault(); setTaskRatio(event.key === "Home" ? 0.2 : 0.8);
                  }
                }} />}
            </div>
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
              <span key={a.provider} onMouseEnter={() => void loadQuotaTip(a.provider)}>
                <i className={a.available ? "ready" : "unavailable"} />
                <AgentIcon provider={a.provider} /> {a.label}
                <AgentQuotaTip
                  label={a.label}
                  quota={quotaTips[a.provider]}
                  loading={quotaLoading.has(a.provider)}
                />
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
            <div ref={setInspectorHost} className="task-inspector-host" />
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
  const [provider, setProvider] = useState<Provider>("codex");
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
      className="task-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const existing = String(data.get("existing"));
        onSubmit({
          projectId: p,
          // Sem título e instruções no formulário: o título vira o nome da branch e a CLI abre vazia,
          // pronta para a conversa no Terminal ou no Chat.
          title: "",
          prompt: "",
          provider,
          branch: adopt ? existing : String(data.get("branch")),
          base: adopt ? existing : String(data.get("base")),
          remote: String(data.get("remote")),
          timeoutMinutes: Number(data.get("timeout")),
          ...(adopt ? { adopt: true } : {}),
        });
      }}
    >
      <p className="form-intro">
        A tarefa é criada como rascunho. Depois, converse com o agente pelo Terminal ou pelo Chat.
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
        {/* Botões em vez de <select>: a lista nativa não mostra ícones. */}
        <div className="agent-field">
          <span className="agent-field-label" id="agent-label">
            Agente
          </span>
          <div
            className="agent-picker"
            role="radiogroup"
            aria-labelledby="agent-label"
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const all: Provider[] = ["codex", "claude", "antigravity"];
              const next = all[(all.indexOf(provider) + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
              setProvider(next);
              e.currentTarget.querySelector<HTMLButtonElement>(`[data-provider="${next}"]`)?.focus();
            }}
          >
            {(["codex", "claude", "antigravity"] as const).map((option) => {
              const info = snapshot.agents.find((a) => a.provider === option);
              const missing = info ? !info.available : false;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  data-provider={option}
                  aria-checked={provider === option}
                  tabIndex={provider === option ? 0 : -1}
                  className={"agent-option" + (provider === option ? " active" : "") + (missing ? " missing" : "")}
                  title={missing ? "CLI não encontrada. Configure o caminho em Configurações." : info?.label}
                  onClick={() => setProvider(option)}
                >
                  <AgentIcon provider={option} size={16} />
                  <span>{info?.label ?? option}</span>
                </button>
              );
            })}
          </div>
          {snapshot.agents.find((a) => a.provider === provider)?.available === false && (
            <small className="agent-hint">CLI não encontrada. Configure o caminho em Configurações.</small>
          )}
        </div>
      </div>
      <div className="notice notice-warn task-folder-notice" role="note">
        <strong>As tarefas deste projeto compartilham a mesma pasta.</strong>
        <p>
          Ao iniciar uma tarefa, o app pode trocar a branch dessa pasta. Antes de iniciar outra,
          encerre ou interrompa os agentes que estiverem trabalhando no mesmo projeto pelo Terminal,
          Chat ou sessões avulsas, para evitar misturar alterações entre tarefas.
        </p>
      </div>
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
        <label className="wide">
          Encerrar se parado (minutos)
          <input
            name="timeout"
            type="number"
            min={0}
            max={1440}
            defaultValue={60}
            required
            aria-describedby="timeout-hint"
          />
        </label>
        <small id="timeout-hint" className="form-hint-block wide">
          Se o agente ficar esse tempo sem mostrar nada e sem você digitar, a execução é encerrada.
          Conversas ativas nunca são cortadas. Use 0 para desativar.
        </small>
      </div>
      <p className="form-footnote">
        A branch é criada localmente na execução. Publicar exige sua ação explícita.
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
  // A escala é preferência de tela: aplica na hora e não passa pelo "Salvar".
  const [uiScale, setUiScale] = useState(readUiScale);
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
      <h4>Aparência</h4>
      <label>
        Tamanho da fonte da interface
        <select
          value={uiScale}
          onChange={(e) => {
            const scale = Number(e.target.value);
            applyUiScale(scale);
            setUiScale(scale);
          }}
        >
          {UI_SCALES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <p className="notice">Vale na hora e fica salvo neste computador.</p>
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
