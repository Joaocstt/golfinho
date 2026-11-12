import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight, ExternalLink, FileDiff, GitBranch } from "lucide-react";
import type { Changes, Request, Task } from "../shared/contracts";
import type { OfficeJob, OfficeLogEntry, OfficeState } from "../shared/office";

const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;

const JOB_STATUS: Record<OfficeJob["status"], string> = {
  fila: "Na fila",
  fazendo: "Fazendo",
  revisao: "Em revisão",
  entregue: "Entregue",
  erro: "Erro",
};
const TASK_STATUS: Record<Task["status"], string> = {
  draft: "Rascunho",
  queued: "Na fila",
  running: "Rodando",
  waiting: "Esperando você",
  interrupted: "Interrompida",
  review: "Para revisar",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};
const LOG_ICON: Record<OfficeLogEntry["kind"], string> = {
  pedido: "📝",
  inicio: "▶️",
  fala: "💬",
  ferramenta: "🔧",
  revisao: "🔍",
  tarefa: "🌿",
  fim: "✅",
  erro: "⚠️",
};
const CHANGE: Record<string, string> = { modified: "alterado", added: "novo", deleted: "apagado", untracked: "novo" };
const time = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
function duration(job: OfficeJob, now: number) {
  if (!job.startedAt) return "";
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  const s = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${s % 60}s`;
}

// Telão: o painel de controle do escritório. Quem está fazendo o quê agora, o histórico de cada
// trabalho passo a passo, e o que mudou no projeto pelas tarefas que a equipe criou.
export function OfficeMonitor({
  office,
  tasks,
  onOpenTask,
}: {
  office: OfficeState;
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
}) {
  const [filter, setFilter] = useState<string>("");
  const [view, setView] = useState<"trabalhos" | "linha">("trabalhos");
  const [open, setOpen] = useState<string | null>(office.jobs[0]?.id ?? null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const team = office.layout.agents;
  const jobs = office.jobs.filter((j) => !filter || j.agentId === filter);
  const count = (s: OfficeJob["status"]) => office.jobs.filter((j) => j.status === s).length;
  const timeline = useMemo(
    () =>
      office.jobs
        .filter((j) => !filter || j.agentId === filter)
        .flatMap((j) => (j.log ?? []).map((e) => ({ ...e, job: j })))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 200),
    [office.jobs, filter],
  );

  return (
    <div className="office-monitor">
      <div className="office-monitor-stats" role="list" aria-label="Resumo">
        {(["fazendo", "fila", "revisao", "entregue", "erro"] as const).map((s) => (
          <div key={s} role="listitem" className={`office-stat ${s}`}>
            <strong>{count(s)}</strong>
            <span>{JOB_STATUS[s]}</span>
          </div>
        ))}
        <div role="listitem" className="office-stat">
          <strong>{office.jobs.filter((j) => j.taskId).length}</strong>
          <span>Tarefas criadas</span>
        </div>
      </div>

      <section aria-label="Agora">
        <h3>Agora</h3>
        <div className="office-now">
          {team.map((a) => {
            const job = office.jobs.find(
              (j) =>
                (j.agentId === a.id && j.status === "fazendo") ||
                (a.id === office.layout.reviewer && j.status === "revisao" && j.activity.startsWith(a.name)),
            );
            const thinking = office.thinking.includes(a.id);
            const queued = office.jobs.filter((j) => j.agentId === a.id && j.status === "fila").length;
            const done = office.jobs.filter((j) => j.agentId === a.id && j.status === "entregue").length;
            return (
              <button
                type="button"
                key={a.id}
                className={`office-now-card${filter === a.id ? " active" : ""}`}
                onClick={() => setFilter(filter === a.id ? "" : a.id)}
                aria-pressed={filter === a.id}
              >
                <span className="office-now-head">
                  <i style={{ background: a.color }} />
                  <b>{a.name}</b>
                  <small>{a.role}</small>
                </span>
                <span className={`office-now-state ${job?.approval ? "thinking" : job ? "busy" : thinking ? "thinking" : "free"}`}>
                  {job?.approval
                    ? `✋ Pede: ${job.approval.text}`
                    : job
                    ? `💬 ${job.speech || (job.activity || job.title).replace(`${a.name}: `, "")}`
                    : thinking
                      ? "🤔 Pensando numa resposta"
                      : "Livre"}
                </span>
                <span className="office-muted">
                  {done} entregue{done === 1 ? "" : "s"} · {queued} na fila
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="office-monitor-tabs" role="tablist" aria-label="Visão do telão">
        <button role="tab" aria-selected={view === "trabalhos"} className={view === "trabalhos" ? "active" : ""} onClick={() => setView("trabalhos")}>
          Trabalhos
        </button>
        <button role="tab" aria-selected={view === "linha"} className={view === "linha" ? "active" : ""} onClick={() => setView("linha")}>
          Linha do tempo
        </button>
        {filter && (
          <button className="office-chip" onClick={() => setFilter("")}>
            Só {team.find((a) => a.id === filter)?.name ?? "agente"} ✕
          </button>
        )}
      </div>

      {view === "trabalhos" ? (
        jobs.length ? (
          <ul className="office-monitor-jobs">
            {jobs.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                now={now}
                task={tasks.find((t) => t.id === j.taskId)}
                open={open === j.id}
                onToggle={() => setOpen(open === j.id ? null : j.id)}
                onOpenTask={onOpenTask}
                onDecide={(jobId, behavior, always) =>
                  void request({ action: "officeDecide", projectId: office.projectId, jobId, behavior, always }).catch(() => undefined)
                }
              />
            ))}
          </ul>
        ) : (
          <p className="office-muted">Nenhum trabalho ainda.</p>
        )
      ) : timeline.length ? (
        <ol className="office-timeline">
          {timeline.map((e, i) => (
            <li key={i} className={e.kind}>
              <time>{day(e.at)}</time>
              <span>{LOG_ICON[e.kind]}</span>
              <b>{e.who}</b>
              <span className="office-timeline-text" title={e.detail}>
                {e.text}
              </span>
              <em>{e.job.title}</em>
            </li>
          ))}
        </ol>
      ) : (
        <p className="office-muted">Nada aconteceu ainda.</p>
      )}
    </div>
  );
}

function JobRow({
  job,
  task,
  now,
  open,
  onToggle,
  onOpenTask,
  onDecide,
}: {
  job: OfficeJob;
  task: Task | undefined;
  now: number;
  open: boolean;
  onToggle: () => void;
  onOpenTask: (taskId: string) => void;
  onDecide: (jobId: string, behavior: "allow" | "deny", always: boolean) => void;
}) {
  const [changes, setChanges] = useState<Changes | null | "erro">(null);
  // Arquivos que a tarefa já mudou na branch dela: só quando abre, e de novo se o status mudar.
  useEffect(() => {
    if (!open || !job.taskId) return;
    let alive = true;
    request<Changes>({ action: "changes", taskId: job.taskId })
      .then((c) => alive && setChanges(c))
      .catch(() => alive && setChanges("erro"));
    return () => {
      alive = false;
    };
  }, [open, job.taskId, task?.status]);
  const tools = (job.log ?? []).filter((e) => e.kind === "ferramenta");
  const raw = (e: OfficeLogEntry) => e.detail ?? e.text;
  const read = new Set(tools.filter((e) => /^(Read|Glob|Grep) /.test(raw(e))).map((e) => raw(e).replace(/^\w+ /, "")));
  const web = tools.filter((e) => /^Web(Search|Fetch) /.test(raw(e))).length;
  return (
    <li className={`office-monitor-job ${job.status}`}>
      <button type="button" className="office-monitor-row" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="office-monitor-title">
          <strong>{job.title}</strong>
          <span className="office-muted">
            {job.agentName} · pedido às {time(job.createdAt)}
            {job.startedAt ? ` · ${duration(job, now)}` : ""}
          </span>
        </span>
        <span className={`office-pill ${job.status}`}>{JOB_STATUS[job.status]}</span>
      </button>
      {open && (
        <div className="office-monitor-detail">
          <p className="office-quote">“{job.request}”</p>
          <div className="office-monitor-facts">
            <span>🔧 {tools.length} ações</span>
            <span>📄 {read.size} arquivos ou buscas no projeto</span>
            {web > 0 && <span>🌐 {web} pesquisas na web</span>}
            {job.reviewedBy && <span>🔍 revisado por {job.reviewedBy}</span>}
          </div>

          {job.approval && job.status === "fazendo" && (
            <div className="office-approval inline">
              <span>
                ✋ <b>{job.agentName}</b> pede: {job.approval.text}
              </span>
              <button type="button" className="primary" onClick={() => onDecide(job.id, "allow", false)}>
                Permitir
              </button>
              {job.approval.canAlways && (
                <button type="button" onClick={() => onDecide(job.id, "allow", true)}>
                  Sempre
                </button>
              )}
              <button type="button" className="danger" onClick={() => onDecide(job.id, "deny", false)}>
                Negar
              </button>
            </div>
          )}
          {job.taskId && (
            <div className="office-monitor-task">
              <div>
                <GitBranch size={13} /> <b>{task?.title || "Tarefa criada"}</b>
                {task?.branch && <code>{task.branch}</code>}
                {task && <span className="office-pill">{TASK_STATUS[task.status]}</span>}
              </div>
              <div className="office-monitor-changes">
                <FileDiff size={13} /> <b>O que foi alterado</b>
                {changes === null ? (
                  <span className="office-muted"> carregando...</span>
                ) : changes === "erro" || Object.keys(changes).length === 0 ? (
                  <span className="office-muted">
                    {" "}
                    nada ainda{task?.status === "draft" ? ": a tarefa está em rascunho, coloque na fila para o agente de código trabalhar" : ""}.
                  </span>
                ) : (
                  <ul>
                    {Object.entries(changes).map(([path, kind]) => (
                      <li key={path}>
                        <code>{path}</code> <span className={`office-change ${kind}`}>{CHANGE[kind] ?? kind}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" className="office-open-task" onClick={() => onOpenTask(job.taskId!)}>
                <ExternalLink size={12} /> Abrir a tarefa
              </button>
            </div>
          )}

          <h4>Passo a passo</h4>
          {job.log?.length ? (
            <ol className="office-timeline compact">
              {job.log.map((e, i) => (
                <li key={i} className={e.kind}>
                  <time>{time(e.at)}</time>
                  <span>{LOG_ICON[e.kind]}</span>
                  <b>{e.who}</b>
                  <span className={`office-timeline-text${e.kind === "fala" ? " speech" : ""}`}>
                    {e.text}
                    {e.detail && <small>{e.detail}</small>}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="office-muted">Sem histórico (trabalho anterior ao telão).</p>
          )}

          {job.status === "erro" && <p className="office-error">Erro: {job.error}</p>}
          {job.result && (
            <details className="office-monitor-result">
              <summary>Entrega</summary>
              <div className="office-result">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.result}</ReactMarkdown>
              </div>
            </details>
          )}
        </div>
      )}
    </li>
  );
}
