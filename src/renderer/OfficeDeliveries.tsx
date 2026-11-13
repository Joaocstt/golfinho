import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ExternalLink, FileText, GitBranch, GitCommitHorizontal, Hammer, ListChecks, RotateCcw, Square } from "lucide-react";
import type { Request, Task } from "../shared/contracts";
import { OFFICE_MAX_ROUNDS, type OfficeJob } from "../shared/office";

const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
const CHANGE: Record<string, string> = { modified: "alterado", added: "novo", deleted: "apagado", untracked: "novo" };

export type DeliveryKind = "relatorio" | "plano" | "codigo";
export const deliveryKind = (j: OfficeJob): DeliveryKind => (j.taskId || j.stage === "codigo" ? "codigo" : j.stage === "plano" ? "plano" : "relatorio");
const KIND_LABEL: Record<DeliveryKind, string> = { relatorio: "Relatório", plano: "Plano", codigo: "Código" };
const busy = (j: OfficeJob) => j.status === "fila" || j.status === "fazendo" || j.status === "revisao";

/** Voltas de correção, em palavras: "corrigindo (volta 1 de 2)" ou "", se não voltou. */
export function roundLabel(j: OfficeJob): string {
  if (!j.rounds) return "";
  const which = `volta ${j.rounds} de ${OFFICE_MAX_ROUNDS}`;
  return busy(j) && j.fixRequest ? `corrigindo o que a revisão pediu (${which})` : `${j.rounds}× corrigido na revisão`;
}

/** Cancelar o que está na fila ou em andamento; tentar de novo o que parou. */
export function JobControls({ projectId, job, compact }: { projectId: string; job: OfficeJob; compact?: boolean }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const canCancel = busy(job);
  const canRetry = job.status === "erro";
  if (!canCancel && !canRetry) return null;
  async function act(r: Request) {
    setSending(true);
    setError("");
    try {
      await request(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <span className={`job-controls${compact ? " compact" : ""}`}>
      {canCancel && (
        <button
          type="button"
          className="danger"
          disabled={sending}
          title="Para o trabalho agora; dá para tentar de novo depois"
          onClick={(e) => {
            e.stopPropagation();
            void act({ action: "officeCancel", projectId, jobId: job.id });
          }}
        >
          <Square size={11} /> Cancelar
        </button>
      )}
      {canRetry && (
        <button
          type="button"
          disabled={sending}
          title={job.taskId ? "Retoma na mesma tarefa e branch" : "Faz o mesmo pedido de novo"}
          onClick={(e) => {
            e.stopPropagation();
            void act({ action: "officeRetry", projectId, jobId: job.id });
          }}
        >
          <RotateCcw size={11} /> Tentar de novo
        </button>
      )}
      {error && <small className="office-error">{error}</small>}
    </span>
  );
}

/** O que aparece na mesa: o que chegou nela, e o que o chefe mandou implementar e ainda está sendo feito. */
export function onDesk(jobs: OfficeJob[]) {
  return jobs.filter((j) => j.status === "entregue" || j.status === "erro" || (j.approved && busy(j)));
}

// Em que ponto a entrega está, em palavras, e o que o chefe pode fazer agora.
function situation(j: OfficeJob, followUp?: OfficeJob): string {
  if (j.status === "erro" && j.cancelled) return "Você cancelou este trabalho. Dá para tentar de novo de onde parou.";
  if (j.status === "erro") return "Não deu certo. Veja o erro abaixo e tente de novo se quiser.";
  if (busy(j) && j.fixRequest)
    return `A revisão pediu correções e ${j.agentName} está ajustando (volta ${j.rounds} de ${OFFICE_MAX_ROUNDS}).`;
  if (busy(j)) return `${j.agentName} está implementando. Você acompanha por aqui e aprova as alterações quando ele pedir.`;
  const kind = deliveryKind(j);
  if (kind === "relatorio")
    return followUp
      ? `Implementação pedida a ${followUp.agentName}.`
      : "Isto é um relatório: nada foi alterado no projeto. Se quiser que vire código, mande implementar.";
  if (kind === "plano") return "Plano pronto: nada foi alterado ainda. O código só é feito se você mandar implementar.";
  if (j.committed) return "Implementado e com commit na branch da tarefa. Para publicar, abra a tarefa.";
  return j.changed?.length
    ? "Implementado na branch da tarefa, ainda sem commit. Confira o diff e faça o commit quando estiver bom."
    : "A implementação terminou sem alterar arquivos.";
}

function Steps({ j }: { j: OfficeJob }) {
  const kind = deliveryKind(j);
  const delivered = j.status === "entregue";
  const steps: [string, boolean][] =
    kind === "relatorio"
      ? [
          ["Pedido", true],
          ["Feito", Boolean(j.result)],
          ["Revisado", Boolean(j.reviewedBy)],
          ["Na sua mesa", delivered],
        ]
      : [
          ["Pedido", true],
          ["Plano", true],
          ["Você aprovou", Boolean(j.approved)],
          ["Implementado", kind === "codigo" && Boolean(j.taskId) && (delivered || j.status === "revisao")],
          ["Revisado", kind === "codigo" && delivered && Boolean(j.reviewedBy)],
          ["Commit", Boolean(j.committed)],
        ];
  const current = steps.findIndex(([, done]) => !done);
  return (
    <ol className="desk-steps" aria-label="Etapas">
      {steps.map(([label, done], i) => (
        <li key={label} className={done ? "done" : i === current ? "current" : ""}>
          <span>{done ? <Check size={11} /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

// Mesa do chefe: a lista do que chegou à esquerda e a entrega aberta à direita. Nada vira código
// sem passar por aqui: relatório e plano têm o botão Implementar; código tem o commit.
export function OfficeDeliveries({
  projectId,
  jobs,
  tasks,
  onOpenTask,
}: {
  projectId: string;
  jobs: OfficeJob[];
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
}) {
  const desk = onDesk(jobs);
  const [selected, setSelected] = useState<string>(desk[0]?.id ?? "");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!desk.some((j) => j.id === selected)) setSelected(desk[0]?.id ?? "");
  }, [desk, selected]);
  useEffect(() => setError(""), [selected]);
  const job = desk.find((j) => j.id === selected);
  if (!desk.length)
    return <p className="office-muted desk-empty">Nada na sua mesa ainda. As entregas da equipe chegam aqui.</p>;

  async function act(r: Request) {
    setSending(true);
    setError("");
    try {
      await request(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const followUp = job?.followUp ? jobs.find((j) => j.id === job.followUp) : undefined;
  const basedOn = job?.basedOn ? jobs.find((j) => j.id === job.basedOn) : undefined;
  const task = job?.taskId ? tasks.find((t) => t.id === job.taskId) : undefined;
  const kind = job ? deliveryKind(job) : "relatorio";
  const [summary, ...rest] = (job?.result ?? "").split(/\n\s*\n/);
  const more = rest.join("\n\n").trim();
  return (
    <div className="desk">
      <ul className="desk-list" aria-label="Entregas">
        {desk.map((j) => {
          const k = deliveryKind(j);
          const waiting = j.status === "entregue" && ((k === "plano" && !j.approved) || (k === "relatorio" && !j.followUp));
          return (
            <li key={j.id}>
              <button
                type="button"
                className={(j.id === selected ? "active" : "") + (j.read ? "" : " unread")}
                aria-current={j.id === selected}
                onClick={() => setSelected(j.id)}
              >
                <span className={`desk-kind ${k}`}>{KIND_LABEL[k]}</span>
                <strong>{j.title}</strong>
                <small>
                  {j.agentName} ·{" "}
                  {j.status === "erro"
                    ? j.cancelled
                      ? "cancelado"
                      : "erro"
                    : busy(j)
                      ? j.fixRequest
                        ? "corrigindo"
                        : "implementando"
                      : waiting
                        ? "esperando sua decisão"
                        : k === "codigo"
                          ? j.committed
                            ? "commit feito"
                            : "pronto para commit"
                          : "lido"}
                </small>
              </button>
            </li>
          );
        })}
      </ul>

      {job && (
        <article className="desk-detail" aria-label={job.title}>
          <header>
            <span className={`desk-kind ${kind}`}>{KIND_LABEL[kind]}</span>
            <h3>{job.title}</h3>
            <p className="office-muted">
              por {job.agentName}
              {job.reviewedBy ? `, revisado por ${job.reviewedBy}` : ""}
              {roundLabel(job) ? ` · ${roundLabel(job)}` : ""}
              {basedOn ? ` · a partir do relatório "${basedOn.title}"` : ""}
            </p>
          </header>
          <Steps j={job} />
          <p className={`desk-situation ${kind}`}>{situation(job, followUp)}</p>

          <div className="desk-actions">
            {job.status === "entregue" && kind !== "codigo" && !job.followUp && !(kind === "plano" && job.approved) && (
              <button
                type="button"
                className="primary"
                disabled={sending}
                onClick={() => void act({ action: "officeImplement", projectId, jobId: job.id })}
              >
                <Hammer size={13} /> Implementar
              </button>
            )}
            {job.status === "entregue" && kind === "codigo" && job.changed && job.changed.length > 0 && !job.committed && (
              <button
                type="button"
                className="primary"
                disabled={sending}
                onClick={() => void act({ action: "officeCommit", projectId, jobId: job.id })}
              >
                <GitCommitHorizontal size={13} /> Commitar alterações
              </button>
            )}
            {followUp && (
              <button type="button" onClick={() => setSelected(followUp.id)} disabled={!onDesk(jobs).some((j) => j.id === followUp.id)}>
                <ListChecks size={13} /> Ver a implementação
              </button>
            )}
            {job.taskId && (
              <button type="button" onClick={() => onOpenTask(job.taskId!)}>
                <ExternalLink size={13} /> Ver a tarefa e o diff
              </button>
            )}
            <JobControls projectId={projectId} job={job} />
          </div>
          {error && <p className="office-error">{error}</p>}

          {busy(job) && job.activity && <p className="desk-activity">⚙️ {job.speech || job.activity}</p>}
          {job.status === "erro" && !job.cancelled && <p className="office-error">Erro: {job.error}</p>}
          {busy(job) && job.fixRequest && (
            <section className="desk-box review">
              <h4>
                <RotateCcw size={13} /> O que a revisão pediu para corrigir
              </h4>
              <div className="office-result">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.fixRequest}</ReactMarkdown>
              </div>
            </section>
          )}

          {kind === "codigo" && (task || job.changed) && (
            <section className="desk-box">
              <h4>
                <GitBranch size={13} /> Onde está
              </h4>
              {task && (
                <p>
                  Branch <code>{task.branch || "pasta do projeto"}</code>
                </p>
              )}
              {job.changed && job.changed.length > 0 && (
                <ul className="desk-files">
                  {job.changed.map((c) => (
                    <li key={c.path}>
                      <code>{c.path}</code> <span className={`office-change ${c.kind}`}>{CHANGE[c.kind] ?? c.kind}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {job.notes.length > 0 && (
            <section className="desk-box review">
              <h4>
                <Check size={13} /> Revisão {job.reviewedBy ? `da ${job.reviewedBy}` : ""}
              </h4>
              <ul>
                {job.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </section>
          )}

          {job.result && (
            <section className="desk-result">
              <h4>
                <FileText size={13} /> {kind === "plano" ? "O plano" : kind === "codigo" ? "O que foi feito" : "O relatório"}
              </h4>
              <div className="office-result">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
              </div>
              {more && (
                <details>
                  <summary>Ler tudo</summary>
                  <div className="office-result">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{more}</ReactMarkdown>
                  </div>
                </details>
              )}
            </section>
          )}
        </article>
      )}
    </div>
  );
}
