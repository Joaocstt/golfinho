import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, Files, GitBranch, Play, Plus, Search, TerminalSquare, X } from "lucide-react";
import type { Check, Provider, Request, Review, Snapshot, Task, TaskEvent } from "../shared/contracts";
import { TerminalPane, DiffPane, FileEditor, FileTree } from "./Editors";
import { ChatPane } from "./ChatPane";
import { ShellPane } from "./ShellPane";
import { AgentIcon } from "./agentIcons";
import { CommitPanel } from "./CommitPanel";
import { ReviewFiles } from "./ReviewFiles";

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
    return value && ["Terminal", "Chat", "Shell", "Diff", "Commit", "Arquivos", "Histórico", "Checks"].includes(value) ? value : "Terminal";
  } catch { return "Terminal"; }
}
export interface TaskWorkspaceHandle {
  canLeave(): boolean;
  openPermission(source: "Terminal" | "Chat", approvalId?: string): boolean;
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
  function canLeave() {
    if (dirty && !window.confirm("Descartar alterações não salvas do arquivo?")) return false;
    return true;
  }
  useImperativeHandle(ref, () => ({
    canLeave,
    openPermission(source, approvalId) {
      // Se a aba de destino já está visível, as abas apenas trocam de lado:
      // o editor continua montado e deve manter sua proteção contra descarte.
      if (tab === "Arquivos" && !shown(source)) {
        if (!canLeave()) return false;
        setDirty(false);
      }
      selectTab(source);
      setPermissionFocus((value) => value + 1);
      if (approvalId) setApprovalTarget((current) => ({ id: approvalId, version: (current?.version ?? 0) + 1 }));
      return true;
    },
  }));
  function navigate(action: () => void) {
    if (canLeave()) { setDirty(false); setApprovalTarget(undefined); action(); }
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
                <div>
                  {/* Status ao lado do título, no lugar da linha "TAREFA · …"; a branch só se repete se for diferente. */}
                  <div className="detail-title">
                    <h2>{task.title}</h2>
                    <span className={"status-pill " + task.status}>{labels[task.status]}</span>
                  </div>
                  <p>
                    <GitBranch size={13} />
                    {task.branch !== task.title && <>{task.branch} </>}
                    <span>
                      {task.branch !== task.title ? "← " : "a partir de "}
                      {task.base} · {task.remote}
                    </span>
                  </p>
                </div>
                <button aria-label="Fechar tarefa" onClick={() => onClose(task.id)}>
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
                  {["Terminal", "Chat", "Shell", "Diff", "Commit", "Arquivos", "Histórico", "Checks"]
                    .filter((t) => (t !== "Shell" && t !== "Commit") || task.branchCreated)
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
                        onClick={() => {
                          if (
                            window.confirm(
                              `Colocar a pasta do projeto no código de "${task.branch}" para teste? A branch atual da sua pasta muda temporariamente. Alterações não commitadas impedem a troca.`,
                            )
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
                      approvalTarget={approvalTarget} />
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
            </>
    ), inspectorHost)}
  </>);
});
