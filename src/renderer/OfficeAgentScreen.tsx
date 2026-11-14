import React, { Suspense, lazy, useEffect, useState } from "react";
import { ExternalLink, FileDiff, ListChecks, TerminalSquare } from "lucide-react";
import type { Changes, FileChange, Request } from "../shared/contracts";
import type { OfficeAgent, OfficeJob, OfficeLogEntry } from "../shared/office";

const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
// O diff usa o mesmo editor das tarefas (Monaco), carregado só quando a tela abre.
const DiffPane = lazy(() => import("./Editors").then((m) => ({ default: m.DiffPane })));

const ICON: Record<OfficeLogEntry["kind"], string> = {
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
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** O trabalho que a tela mostra: o que o agente está fazendo, ou o último que ele fez. */
export function screenJob(agent: OfficeAgent, jobs: OfficeJob[]): OfficeJob | undefined {
  return (
    jobs.find((j) => j.agentId === agent.id && (j.status === "fazendo" || j.status === "revisao")) ??
    jobs.find((j) => j.agentId === agent.id && j.status !== "fila")
  );
}

// A tela do agente, ampliada: o passo a passo ao vivo, a saída do último comando (testes, erros)
// e os arquivos que a tarefa já mudou, com o diff de cada um.
export function OfficeAgentScreen({
  agent,
  jobs,
  onOpenTask,
}: {
  agent: OfficeAgent;
  jobs: OfficeJob[];
  onOpenTask: (taskId: string) => void;
}) {
  const job = screenJob(agent, jobs);
  const [changes, setChanges] = useState<Changes | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileChange | null>(null);
  const [diffError, setDiffError] = useState("");
  const live = job?.status === "fazendo" || job?.status === "revisao";

  // Arquivos alterados: lê de novo a cada 3 s enquanto o agente trabalha.
  useEffect(() => {
    setChanges(null);
    if (!job?.taskId) return;
    let alive = true;
    const load = () =>
      request<Changes>({ action: "changes", taskId: job.taskId! })
        .then((c) => alive && setChanges(c))
        .catch(() => alive && setChanges({}));
    void load();
    const timer = live ? window.setInterval(load, 3000) : 0;
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [job?.taskId, live]);

  useEffect(() => {
    setDiff(null);
    setDiffError("");
    if (!file || !job?.taskId) return;
    let alive = true;
    request<FileChange>({ action: "changeDiff", taskId: job.taskId, path: file })
      .then((d) => alive && setDiff(d))
      .catch((e) => alive && setDiffError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [file, job?.taskId, changes]);

  if (!job) return <p className="office-muted screen-empty">{agent.name} ainda não trabalhou em nada. A tela dele está esperando um pedido.</p>;

  const files = Object.entries(changes ?? {});
  const steps = (job.log ?? []).slice(-40);
  return (
    <div className="agent-screen">
      <header>
        <span className={`office-pill ${job.status}`}>{live ? (job.approval ? "Esperando você" : "Ao vivo") : job.status === "erro" ? "Deu erro" : "Terminado"}</span>
        <strong>{job.title}</strong>
        {job.taskId && (
          <button type="button" onClick={() => onOpenTask(job.taskId!)}>
            <ExternalLink size={12} /> Abrir a tarefa
          </button>
        )}
      </header>
      {live && <p className="agent-screen-now">⚙️ {job.speech || job.activity || "Começando..."}</p>}

      <section>
        <h4>
          <ListChecks size={13} /> Passo a passo
        </h4>
        {steps.length ? (
          <ol className="office-timeline compact">
            {steps.map((e, i) => (
              <li key={i} className={e.kind}>
                <time>{time(e.at)}</time>
                <span>{ICON[e.kind]}</span>
                <b>{e.who}</b>
                <span className="office-timeline-text">{e.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="office-muted">Nada ainda.</p>
        )}
      </section>

      {job.output && (
        <section>
          <h4>
            <TerminalSquare size={13} /> Saída do último comando {job.outputError ? "(com erro)" : ""}
          </h4>
          <pre className={`agent-screen-output${job.outputError ? " error" : ""}`}>{job.output}</pre>
        </section>
      )}

      {job.taskId && (
        <section>
          <h4>
            <FileDiff size={13} /> Arquivos alterados {files.length ? `(${files.length})` : ""}
          </h4>
          {changes === null ? (
            <p className="office-muted">Carregando...</p>
          ) : files.length ? (
            <ul className="agent-screen-files">
              {files.map(([path, kind]) => (
                <li key={path}>
                  <button type="button" className={file === path ? "active" : ""} onClick={() => setFile(file === path ? null : path)}>
                    <code>{path}</code> <span className={`office-change ${kind}`}>{CHANGE[kind] ?? kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="office-muted">Nenhum arquivo mudou ainda.</p>
          )}
          {file && (
            <div className="agent-screen-diff">
              {diffError ? (
                <p className="office-error">{diffError}</p>
              ) : diff ? (
                <Suspense fallback={<p className="office-muted">Abrindo o diff...</p>}>
                  <DiffPane file={diff} />
                </Suspense>
              ) : (
                <p className="office-muted">Abrindo o diff...</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
