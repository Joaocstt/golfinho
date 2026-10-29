import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Check as CheckMark,
  Files,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  History,
  ListChecks,
  MessageSquare,
  Play,
  Plus,
  Search,
  SquareTerminal,
  Terminal,
  TerminalSquare,
  X,
} from "lucide-react";
import type { Check, Provider, Request, Review, Snapshot, Task, TaskEvent } from "../shared/contracts";
import { TerminalPane, DiffPane, FileEditor, FileTree } from "./Editors";
import { ChatPane } from "./ChatPane";
import { ShellPane } from "./ShellPane";
import { AgentIcon } from "./agentIcons";
import { AgentPicker } from "./AgentPicker";
import { useConfirm } from "./ui";
import { CommitPanel } from "./CommitPanel";
import { ReviewFiles } from "./ReviewFiles";
import { TaskQuota } from "./AgentQuota";
import { HIDDEN_KEY, ORDER_EVENT, ORDER_KEY, TABS, arrangeTabs, mergeOrder, moveTab, storedHiddenTabs, storedTabOrder } from "./tabOrder";

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
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
function savedTab(taskId: string) {
  try {
    const value = localStorage.getItem(`golfinho.task.${taskId}.tab`);
    return value && TABS.includes(value) ? value : "Terminal";
  } catch { return "Terminal"; }
}
export const TAB_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Terminal: TerminalSquare,
  Chat: MessageSquare,
  Shell: SquareTerminal,
  Diff: GitCompare,
  Commit: GitCommitHorizontal,
  Arquivos: Files,
  Histórico: History,
  Checks: ListChecks,
};
function store(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem armazenamento: a preferência só não fica lembrada */
  }
  window.dispatchEvent(new Event(ORDER_EVENT));
}
// Cada tarefa aberta tem sua barra; todas acompanham a mesma ordem e as mesmas abas escondidas.
function useTabOrder() {
  const [order, setOrder] = useState(storedTabOrder);
  const [hidden, setHidden] = useState(storedHiddenTabs);
  useEffect(() => {
    const sync = () => {
      setOrder(storedTabOrder());
      setHidden(storedHiddenTabs());
    };
    window.addEventListener(ORDER_EVENT, sync);
    return () => window.removeEventListener(ORDER_EVENT, sync);
  }, []);
  const saveOrder = (next: string[]) => {
    setOrder(next);
    store(ORDER_KEY, next);
  };
  const saveHidden = (next: string[]) => {
    setHidden(next);
    store(HIDDEN_KEY, next);
  };
  return { order, saveOrder, hidden, saveHidden };
}
export interface TaskWorkspaceHandle {
  /** true na hora quando não há alteração; com alteração, a resposta da confirmação. */
  canLeave(): boolean | Promise<boolean>;
  openPermission(source: "Terminal" | "Chat", approvalId?: string): void;
}
interface Props {
  task: Task;
  snapshot: Snapshot;
  focused: boolean;
  visible: boolean;
  column: number;
  inspectorHost: HTMLDivElement | null;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onChanged: () => Promise<void>;
  onError: (error: unknown) => void;
  onDirtyChange: (dirty: boolean) => void;
  onTerminalInput: (taskId: string, data: string) => void;
}
export const TaskWorkspace = forwardRef<TaskWorkspaceHandle, Props>(function TaskWorkspace(
  { task, snapshot, focused, visible, column, inspectorHost, onFocus, onClose, onChanged, onError: report, onDirtyChange, onTerminalInput }, ref,
) {
  const selected = task.id;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [fileWritable, setFileWritable] = useState(true);
  const [sessions, setSessions] = useState<Record<string, { key: string; label: string; provider?: Provider; prompt?: string }[]>>({});
  const [notice, setNotice] = useState("");
  const [sessionMenu, setSessionMenu] = useState(false);
  const [permissionFocus, setPermissionFocus] = useState(0);
  const [approvalTarget, setApprovalTarget] = useState<{ id: string; version: number }>();
  const resizeCleanup = useRef<() => void>(() => {});
  useEffect(() => () => resizeCleanup.current(), []);
  const detailEpoch = useRef(0);
  const { order: tabOrder, saveOrder: saveTabOrder, hidden: hiddenTabs, saveHidden: saveHiddenTabs } = useTabOrder();
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number } | null>(null);
  // Posição de cada aba nesta tarefa, misturando fixas e sessões do +. Sessões não
  // sobrevivem ao reinício do app, então essa mistura também fica só na memória.
  const [placed, setPlaced] = useState<Record<string, string[]>>({});
  const [tab, setTab] = useState(() => savedTab(task.id)),
    [review, setReview] = useState<Review | null>(null),
    [events, setEvents] = useState<TaskEvent[]>([]),
    [checks, setChecks] = useState<Check[]>([]),
    [chatDraft, setChatDraft] = useState(""),
    [file, setFile] = useState(""),
    [command, setCommand] = useState(""),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(`golfinho.task.${task.id}.tab`, tab); } catch { /* preferência opcional */ }
  }, [task.id, tab]);
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
    void loadDetails(task.id);
    const unsubscribe = window.golfinho.subscribe((signal) => {
      if (signal.kind === "changed") {
        setReview(null);
        void loadDetails(task.id);
      }
    });
    return () => { detailEpoch.current++; unsubscribe(); };
  }, [task.id, loadDetails]);
  useEffect(() => { if (focused) onDirtyChange(dirty); }, [focused, dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  // Sair com o arquivo alterado pede confirmação; sem alteração, libera na hora.
  function canLeave(): boolean | Promise<boolean> {
    if (!dirty) return true;
    return confirm({
        title: "Descartar as alterações do arquivo?",
        message: "O arquivo aberto no editor tem alterações que ainda não foram salvas.",
        confirmLabel: "Descartar",
        cancelLabel: "Continuar editando",
        tone: "danger",
      });
  }
  // Roda a ação já, ou depois da confirmação, quando há alterações não salvas.
  function whenLeaving(action: () => void) {
    const leave = canLeave();
    if (leave === true) action();
    else if (leave !== false) void leave.then((ok) => ok && action());
  }
  useImperativeHandle(ref, () => ({
    canLeave,
    openPermission(source, approvalId) {
      const open = () => {
        selectTab(source);
        setPermissionFocus((value) => value + 1);
        if (approvalId) setApprovalTarget((current) => ({ id: approvalId, version: (current?.version ?? 0) + 1 }));
      };
      // Se a aba de destino já está visível, as abas apenas trocam de lado:
      // o editor continua montado e deve manter sua proteção contra descarte.
      if (tab === "Arquivos" && !shown(source))
        whenLeaving(() => {
          setDirty(false);
          open();
        });
      else open();
    },
  }));
  function navigate(action: () => void) {
    whenLeaving(() => { setDirty(false); setApprovalTarget(undefined); action(); });
  }
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true);
    try {
      await operation();
      await onChanged();
      await loadDetails(task.id);
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  // Tarefa de pasta sem Git: sem branch, sem painel de commit, sem publicação.
  const folderTask = task.branch === "";
  const sessionList = sessions[task.id] ?? [];
  const fixedTabs = tabOrder
    .filter((t) => (t !== "Shell" && t !== "Commit") || (task.branchCreated && (t !== "Commit" || !folderTask)))
    // Aba escondida que está aberta continua visível até o usuário sair dela.
    .filter((t) => !hiddenTabs.includes(t) || shown(t));
  const tabBar = arrangeTabs(
    placed[task.id] ?? [],
    fixedTabs,
    sessionList.map((s) => `session:${s.key}`),
  );
  // Põe a aba arrastada no lugar da outra. Se a ordem das fixas mudou, ela vale para
  // todas as tarefas; a posição das sessões é só desta tarefa.
  function placeTab(dragged: string, target: string) {
    const next = moveTab(tabBar, dragged, target);
    setPlaced((all) => ({ ...all, [task.id]: next }));
    const fixed = next.filter((k) => TABS.includes(k));
    if (fixed.join() !== fixedTabs.join()) saveTabOrder(mergeOrder(fixed, tabOrder));
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
  function addSession(taskId: string, label: string, provider?: Provider) {
    const key = crypto.randomUUID();
    setSessions((all) => ({
      ...all,
      [taskId]: [...(all[taskId] ?? []), { key, label, provider }],
    }));
    setTab(`session:${key}`);
  }
  async function openReview() {
    if (!task) return;
    if (dirty && !(await confirm({
        title: "Descartar as alterações do arquivo?",
        message: "O arquivo aberto no editor tem alterações que ainda não foram salvas.",
        confirmLabel: "Descartar",
        cancelLabel: "Continuar editando",
        tone: "danger",
      }))) return;
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
  async function changeAgent(provider: Provider) {
    if (provider === task.provider) return;
    const from = snapshot.agents.find((a) => a.provider === task.provider)?.label ?? task.provider;
    const to = snapshot.agents.find((a) => a.provider === provider)?.label ?? provider;
    // Só pede confirmação quando há conversa para perder.
    if (
      (task.sessionId || task.chatSessionId) &&
      !(await confirm({
        title: `Trocar o agente para ${to}?`,
        message: `A conversa com ${from} não será retomada: ${to} começa uma conversa nova, com o resumo da tarefa e a memória do projeto. A branch e os arquivos continuam como estão.`,
        confirmLabel: `Trocar para ${to}`,
      }))
    )
      return;
    void perform(() => request({ action: "setTaskAgent", taskId: task.id, provider }));
  }
  async function act(
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
      if (dirty && !(await confirm({
        title: "Descartar as alterações do arquivo?",
        message: "O arquivo aberto no editor tem alterações que ainda não foram salvas.",
        confirmLabel: "Descartar",
        cancelLabel: "Continuar editando",
        tone: "danger",
      })))
        return;
      setDirty(false);
      setFile("");
      if (action === "finish" || task.status === "draft") setTab("Terminal");
      setReview(null);
    }
    return perform(() => request({ action, taskId: task.id }));
  }
  return (<>
            <section className="detail" aria-label={`Tarefa ${task.branch}`} data-focused={focused || undefined}
              hidden={!visible} style={{ gridColumn: column, gridRow: 1 }}
              onPointerDownCapture={() => onFocus(task.id)} onFocusCapture={() => onFocus(task.id)}>
              <div className="detail-head">
                {/* Uma linha só: título, status, agente e de onde a branch saiu. */}
                <div className="detail-title">
                    <h2 title={task.title}>{task.title}</h2>
                    <span className={"status-pill " + task.status}>{labels[task.status]}</span>
                    <AgentPicker
                      value={task.provider}
                      agents={snapshot.agents}
                      disabled={busy || ["running", "waiting", "queued"].includes(task.status)}
                      title={
                        ["running", "waiting", "queued"].includes(task.status)
                          ? "Aguarde a tarefa terminar para trocar o agente"
                          : "Troca o agente desta tarefa. A branch e os arquivos continuam."
                      }
                      onChange={changeAgent}
                    />
                    {folderTask ? (
                      <span className="detail-branch" title="Pasta sem Git: a tarefa roda direto nela, sem branch">
                        <FolderOpen size={12} />
                        <span>direto na pasta, sem Git</span>
                      </span>
                    ) : (
                    <span className="detail-branch" title={`${task.branch} ← ${task.base}${task.remote ? ` · ${task.remote}` : ""}`}>
                      <GitBranch size={12} />
                      {task.branch !== task.title && <strong>{task.branch}</strong>}
                      <span>
                        {task.branch !== task.title ? "← " : "a partir de "}
                        {task.base}{task.remote ? ` · ${task.remote}` : " · sem remoto"}
                      </span>
                    </span>
                    )}
                </div>
                <button className="detail-close" aria-label="Fechar tarefa" title="Fechar tarefa" onClick={() => onClose(task.id)}>
                  <X size={15} />
                </button>
              </div>
              {task.error && <div className="error">{task.error}</div>}
              {(() => {
                // Projeto sem worktree: as tarefas dividem a pasta, que só fica numa branch por vez.
                const active = snapshot.activeBranches?.[task.projectId];
                if (task.worktreePath || !task.branchCreated || active === undefined || active === task.branch) return null;
                const owner = snapshot.tasks.find(
                  (t) => t.id !== task.id && t.projectId === task.projectId && !t.worktreePath && t.branch === active,
                );
                const live = (s: string) => ["running", "waiting", "queued"].includes(s);
                const blocker = snapshot.tasks.find(
                  (t) => t.id !== task.id && t.projectId === task.projectId && !t.worktreePath && live(t.status),
                );
                const running = live(task.status) || Boolean(blocker);
                return (
                  <div className="notice notice-warn branch-switch" role="status">
                    <p>
                      As tarefas deste projeto dividem a mesma pasta, e agora ela está em{" "}
                      <strong>{active || "nenhuma branch"}</strong>
                      {owner && <> (tarefa “{owner.title}”)</>}. Para ver os arquivos e rodar esta tarefa, troque a pasta
                      para <strong>{task.branch}</strong>.
                    </p>
                    <button
                      disabled={busy || running}
                      title={
                        blocker
                          ? `A tarefa “${blocker.title}” está executando nesta pasta. Espere ela terminar.`
                          : "Faz git switch na pasta do projeto. Alterações não commitadas impedem a troca."
                      }
                      onClick={() => act("activate")}
                    >
                      <GitBranch size={13} />
                      Trocar a pasta para {task.branch}
                    </button>
                  </div>
                );
              })()}
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
                  <div
                    className="tabs"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTabMenu({ x: e.clientX, y: e.clientY });
                    }}
                  >
                  {tabBar.map((key) => {
                    // Qualquer aba (fixa ou do +) pode passar por cima de qualquer outra.
                    const reorder = {
                      onDragOver: (e: React.DragEvent<HTMLElement>) => {
                        if (!dragTab || !tabBar.includes(dragTab)) return;
                        e.preventDefault();
                        if (dragTab === key) return;
                        // Só troca depois de passar do meio da outra aba: abas de larguras
                        // diferentes não ficam trocando de lugar sem parar sob o cursor.
                        const box = e.currentTarget.getBoundingClientRect();
                        const middle = box.left + box.width / 2;
                        const right = tabBar.indexOf(dragTab) < tabBar.indexOf(key);
                        if (right ? e.clientX < middle : e.clientX > middle) return;
                        placeTab(dragTab, key);
                      },
                      onDrop: (e: React.DragEvent<HTMLElement>) => {
                        if (!dragTab || !tabBar.includes(dragTab)) return;
                        e.preventDefault();
                        dragEnd();
                      },
                    };
                    const state =
                      (tab === key ? "active" : secondTab === key ? "active secondary" : "") +
                      (dragTab === key ? " dragging" : "");
                    const s = key.startsWith("session:")
                      ? sessionList.find((x) => `session:${x.key}` === key)
                      : undefined;
                    if (!s) {
                      const Icon = TAB_ICONS[key];
                      return (
                        <button
                          key={key}
                          title="Arraste para reordenar · botão direito para escolher as abas"
                          className={state}
                          draggable
                          onDragStart={(e) => dragStart(e, key)}
                          onDragEnd={dragEnd}
                          {...reorder}
                          onClick={() => navigate(() => selectTab(key))}
                        >
                          <Icon size={13} />
                          {key}
                        </button>
                      );
                    }
                    return (
                    <span
                      key={key}
                      className={"session-tab " + state}
                      {...reorder}
                    >
                      <button
                        className={tab === key ? "active" : secondTab === key ? "active secondary" : ""}
                        draggable
                        onDragStart={(e) => dragStart(e, key)}
                        onDragEnd={dragEnd}
                        onClick={() => navigate(() => selectTab(key))}
                        title="Arraste para reordenar"
                      >
                        {s.provider ? <AgentIcon provider={s.provider} /> : <Terminal size={13} />}
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
                            if (tab === key) setTab("Terminal");
                          })
                        }
                      >
                        <X size={11} />
                      </button>
                    </span>
                    );
                  })}
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
                {tabMenu && (
                  <TabMenu
                    at={tabMenu}
                    tabs={tabOrder.filter((t) => (t !== "Shell" && t !== "Commit") || (task.branchCreated && (t !== "Commit" || !folderTask)))}
                    hidden={hiddenTabs}
                    onToggle={(t) =>
                      saveHiddenTabs(hiddenTabs.includes(t) ? hiddenTabs.filter((x) => x !== t) : [...hiddenTabs, t])
                    }
                    onReset={() => {
                      saveHiddenTabs([]);
                      saveTabOrder(TABS);
                    }}
                    onClose={() => setTabMenu(null)}
                  />
                )}
                <div className="actions">
                  {["draft", "failed", "cancelled", "interrupted", "review", "completed"].includes(
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
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Testar esta tarefa na pasta do projeto?",
                              message: `A pasta do projeto passa para o código de "${task.branch}". A branch atual dela é guardada e volta com o botão "Voltar". Alterações não commitadas na pasta impedem a troca.`,
                              confirmLabel: "Testar no projeto",
                            })
                          )
                            void act("testActivate");
                        }}
                        aria-label="Testar na pasta do projeto"
                      >
                        Testar no projeto
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
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "Guardar as alterações com git stash?",
                              message: (
                                <p>
                                  As alterações não commitadas da pasta do projeto são guardadas e a pasta fica limpa
                                  para a tarefa começar. Para recuperar depois: <code>git stash pop</code>.
                                </p>
                              ),
                              confirmLabel: "Guardar (stash)",
                            })
                          )
                            perform(() => request({ action: "stashPending", taskId: task.id }));
                        }}
                      >
                        Guardar alterações (stash)
                      </button>
                    </div>
                  </div>
                )}
              {/* Com sessão salva, o botão Retomar sessão resolve; o aviso só faz sentido sem ela. */}
              {task.status === "interrupted" && !task.sessionId && (
                <p className="notice notice-compact">
                  Processo interrompido. A sessão anterior não é recuperável: revise os arquivos ou
                  coloque a tarefa na fila de novo.
                </p>
              )}
              <div className="tab-body" ref={bodyRef} style={bodyStyle()}>
                {shown("Chat") && (
                  <div className="tab-slot bare" style={place("Chat")}>
                    <ChatPane taskId={task.id} provider={task.provider} model={task.model ?? null} draft={chatDraft} onDraftChange={setChatDraft} onError={report}
                      approvalTarget={approvalTarget}
                      onOpenFile={(path) =>
                        navigate(() => {
                          // Somente leitura: para editar, o arquivo é aberto pela árvore.
                          setFileWritable(false);
                          setFile(path);
                          selectTab("Arquivos");
                        })
                      }
                      locked={
                        // Sessão parada (interrompida, cancelada ou com falha) esperando ser retomada:
                        // o chat só libera depois que ela volta.
                        task.sessionId && task.branchCreated && ["interrupted", "cancelled", "failed"].includes(task.status)
                          ? {
                              message: "A sessão desta tarefa está parada. Retome a sessão para voltar a usar o chat.",
                              actionLabel: "Retomar sessão",
                              onAction: () => void act("queue"),
                              busy,
                            }
                          : null
                      } />
                  </div>
                )}
                {shown("Terminal") && (
                  <div className="tab-slot bare" style={place("Terminal")}>
                  {task.status === "draft" ? (
                    <section className="task-start-guide" aria-labelledby={`task-start-${task.id}`}>
                      <div className="task-start-content">
                        <TerminalSquare size={32} aria-hidden="true" />
                        <h2 id={`task-start-${task.id}`}>Tudo pronto para começar</h2>
                        <p>
                          Esta tarefa ainda não foi iniciada. Clique em <b>Colocar na fila</b> para o
                          agente começar com as instruções cadastradas.
                        </p>
                        <p>
                          Acompanhe a execução por aqui e responda quando o agente precisar de você.
                          Depois, confira as alterações em <b>Diff</b> e as verificações em <b>Checks</b>.
                        </p>
                        <button className="primary" disabled={busy} onClick={() => act("queue")}>
                          <Play size={14} aria-hidden="true" /> Colocar na fila
                        </button>
                      </div>
                    </section>
                  ) : (
                    <TerminalPane
                      key={task.id}
                      taskId={task.id}
                      provider={task.provider}
                      status={task.status}
                      active={
                        ["running", "waiting"].includes(task.status) && task.terminalReady !== false
                      }
                      autoFocus={focused && visible}
                      focusRequest={permissionFocus}
                      onInput={(data) => onTerminalInput(task.id, data)}
                      onError={report}
                    />
                  )}
                  </div>
                )}
                {task.branchCreated && (
                  // Fica montado ao trocar de aba: o shell não morre por você olhar o Diff.
                  <div className="shell-slot tab-slot bare" style={place("Shell")} hidden={!shown("Shell")}>
                    <ShellPane
                      key={task.id}
                      scopeKey={task.id}
                      autoFocus={focused && visible && shown("Shell")}
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
                      autoFocus={focused && visible && shown(`session:${s.key}`)}
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
                      {review.files.length ? (
                        <div className="review-layout">
                          <ReviewFiles files={review.files} selected={file} onSelect={setFile} />
                          <div className="review-main">
                            {review.files.find((f) => f.path === file) ? (
                              <DiffPane file={review.files.find((f) => f.path === file)!} />
                            ) : (
                              <div className="empty">Escolha um arquivo na lista para ver o que mudou.</div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="empty">Nenhuma alteração encontrada nesta branch.</div>
                      )}
                      {review.overlaps.map((o) => (
                        <p className="notice" key={o.taskId}>
                          Arquivos também alterados em “{o.title}”: {o.paths.join(", ")}
                        </p>
                      ))}
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
                {shown("Commit") && task.branchCreated && (
                  <div className="tab-slot" style={place("Commit")}>
                    <CommitPanel
                      key={task.id}
                      taskId={task.id}
                      branch={task.branch}
                      request={request}
                      onError={report}
                    />
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
    {focused && inspectorHost && createPortal((
<>
              <div className="inspector-section">
                <h3>{task.title}</h3>
                <span className={"status " + task.status}>{labels[task.status]}</span>
                <dl>
                  <dt>Projeto</dt>
                  <dd>{snapshot?.projects.find((p) => p.id === task.projectId)?.name}</dd>
                  <dt>Agente</dt>
                  <dd><AgentIcon provider={task.provider} /> {task.provider}</dd>
                  {folderTask ? (
                    <>
                      <dt>Pasta</dt>
                      <dd>Sem Git, direto na pasta</dd>
                    </>
                  ) : (
                    <>
                      <dt>Branch</dt>
                      <dd>{task.branch}</dd>
                      <dt>Base</dt>
                      <dd>{task.base}</dd>
                      <dt>Remoto</dt>
                      <dd>{task.remote || "Nenhum"}</dd>
                      <dt>Publicação</dt>
                      <dd>{task.published ? "Publicada" : "Não publicada"}</dd>
                    </>
                  )}
                </dl>
              </div>
              {/* Tarefas antigas ainda têm instruções; as novas abrem a CLI vazia e não mostram a seção. */}
              {task.prompt.trim() && (
                <div className="inspector-section instructions">
                  <h4>Instruções</h4>
                  <p>{task.prompt}</p>
                </div>
              )}
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
              <TaskQuota
                provider={task.provider}
                label={snapshot.agents.find((a) => a.provider === task.provider)?.label ?? task.provider}
              />
            </>
    ), inspectorHost)}
  </>);
});

// Menu do botão direito na barra de abas: marca quais abas fixas aparecem.
function TabMenu({
  at,
  tabs,
  hidden,
  onToggle,
  onReset,
  onClose,
}: {
  at: { x: number; y: number };
  tabs: string[];
  hidden: string[];
  onToggle: (tab: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={menu}
      className="tab-menu"
      role="menu"
      aria-label="Abas visíveis"
      style={{ left: Math.min(at.x, window.innerWidth - 200), top: at.y }}
    >
      <p>Abas visíveis</p>
      {tabs.map((t) => {
        const Icon = TAB_ICONS[t];
        const on = !hidden.includes(t);
        return (
          <button
            key={t}
            role="menuitemcheckbox"
            aria-checked={on}
            disabled={t === "Terminal"}
            title={t === "Terminal" ? "O Terminal fica sempre visível" : undefined}
            onClick={() => onToggle(t)}
          >
            <span className="tab-menu-check">{on && <CheckMark size={12} />}</span>
            <Icon size={13} />
            {t}
          </button>
        );
      })}
      <hr />
      <button role="menuitem" onClick={onReset}>
        Restaurar ordem e abas
      </button>
    </div>,
    document.body,
  );
}
