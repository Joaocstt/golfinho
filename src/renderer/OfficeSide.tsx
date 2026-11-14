import React, { useState } from "react";
import { MonitorPlay, Pencil, Users } from "lucide-react";
import type { Project } from "../shared/contracts";
import type { OfficeAgent, OfficeJob, OfficeLayout, OfficeState } from "../shared/office";
import { JobControls } from "./OfficeDeliveries";
import { statusLabel } from "./OfficePane";

type Tone = "neutro" | "ativo" | "atencao" | "ok" | "erro" | "chat";

/** Etiqueta curta do trabalho, para a lista lateral (o detalhe completo fica no texto de baixo). */
export function jobBadge(j: OfficeJob): { label: string; tone: Tone } {
  if (j.status === "fila") return { label: "na fila", tone: "neutro" };
  if (j.status === "fazendo") {
    if (j.approval) return { label: "espera você", tone: "atencao" };
    if (j.origin === "chat") return { label: "no chat", tone: "chat" };
    return { label: j.fixRequest ? "corrigindo" : "fazendo", tone: "ativo" };
  }
  if (j.status === "revisao") return { label: "em revisão", tone: "atencao" };
  if (j.status === "erro") return j.cancelled ? { label: "cancelado", tone: "neutro" } : { label: "erro", tone: "erro" };
  if (j.origin === "chat") return { label: "respondido", tone: "neutro" };
  if (j.stage === "plano" && !j.approved) return { label: "aprovar plano", tone: "atencao" };
  if (j.taskId && !j.committed && j.changed?.length) return { label: "falta commit", tone: "atencao" };
  return { label: "na sua mesa", tone: "ok" };
}

/** Ação do agente sem os caminhos inteiros: só o nome do arquivo, sem o "cd ... &&" da frente. */
export function tidyActivity(text: string): string {
  return text
    .replace(/^(Rodando:\s*)cd\s+("[^"]*"|\S+)\s*(&&|;)\s*/, "$1")
    .replace(/"?(?:[A-Za-z]:)?[\\/](?:[^"\s\\/]+[\\/])+([^"\s\\/]+)"?/g, "$1")
    .trim();
}

const live = (j: OfficeJob) => j.status === "fila" || j.status === "fazendo" || j.status === "revisao";

function agentState(a: OfficeAgent, office: OfficeState | null): { label: string; tone: Tone } {
  const job = office?.jobs.find((j) => j.agentId === a.id && j.status === "fazendo");
  if (job?.approval) return { label: "esperando você", tone: "atencao" };
  if (job) return { label: job.origin === "chat" ? "no chat" : "trabalhando", tone: job.origin === "chat" ? "chat" : "ativo" };
  if (office?.layout.reviewer === a.id && office.jobs.some((j) => j.status === "revisao")) return { label: "revisando", tone: "atencao" };
  if (office?.thinking.includes(a.id)) return { label: "pensando", tone: "ativo" };
  const queued = office?.jobs.filter((j) => j.agentId === a.id && j.status === "fila").length ?? 0;
  if (queued) return { label: `${queued} na fila`, tone: "neutro" };
  return { label: "livre", tone: "neutro" };
}

// Painel ao lado da sala: projeto e ações no topo, a equipe com a situação de cada um, e os
// trabalhos separados entre o que está andando e o que já terminou.
export function OfficeSide({
  projects,
  projectId,
  onProject,
  office,
  layout,
  onEdit,
  onTelao,
  onMeeting,
  onAgent,
}: {
  projects: Project[];
  projectId: string;
  onProject: (id: string) => void;
  office: OfficeState | null;
  layout: OfficeLayout | null;
  onEdit: () => void;
  onTelao: () => void;
  onMeeting: () => void;
  onAgent: (a: OfficeAgent) => void;
}) {
  const [all, setAll] = useState(false);
  const jobs = office?.jobs ?? [];
  const running = jobs.filter(live);
  const done = jobs.filter((j) => !live(j));
  const shown = all ? done : done.slice(0, 6);
  const color = (id: string) => layout?.agents.find((a) => a.id === id)?.color ?? "#94a3b8";
  const busy = layout?.agents.filter((a) => agentState(a, office).tone !== "neutro").length ?? 0;

  const card = (j: OfficeJob) => {
    const badge = jobBadge(j);
    const detail = j.status === "fazendo" && j.activity ? tidyActivity(j.activity) : statusLabel(j);
    return (
      <li key={j.id} className={`side-job ${j.status}`}>
        <div className="side-job-head">
          <strong title={j.title}>{j.title}</strong>
          {office && <JobControls projectId={office.projectId} job={j} compact icons />}
        </div>
        <div className="side-job-meta">
          <i style={{ background: color(j.agentId) }} />
          <span>{j.agentName}</span>
          <em className={`side-badge ${badge.tone}`}>{badge.label}</em>
        </div>
        {detail && detail !== badge.label && (
          <p className={`side-job-detail${j.status === "fazendo" ? " live" : ""}`} title={j.activity || detail}>
            {detail}
          </p>
        )}
      </li>
    );
  };

  return (
    <div className="side">
      <label className="side-project">
        <span>Projeto</span>
        <select value={projectId} onChange={(e) => onProject(e.target.value)} aria-label="Projeto do Escritório">
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <small>Cada projeto tem o seu escritório, com a própria equipe.</small>
      </label>

      <div className="side-actions">
        <button type="button" disabled={!layout} onClick={onEdit} title="Editar a equipe: quem é, personagem, mesa e lugar (e a sala)" aria-label="Editar escritório">
          <Pencil size={15} />
          <span>Editar</span>
        </button>
        <button type="button" disabled={!office} onClick={onTelao} title="Telão: tudo o que a equipe fez" aria-label="Telão: tudo o que a equipe fez">
          <MonitorPlay size={15} />
          <span>Telão</span>
        </button>
        <button type="button" disabled={!office} onClick={onMeeting} title="Reunião: dividir um pedido grande" aria-label="Reunião: dividir um pedido grande">
          <Users size={15} />
          <span>Reunião</span>
        </button>
      </div>

      <section className="side-section">
        <h3>
          Equipe <small>{busy ? `${busy} ocupad${busy > 1 ? "os" : "o"}` : "todos livres"}</small>
        </h3>
        <ul className="side-team" aria-label="Equipe">
          {layout?.agents.map((a) => {
            const st = agentState(a, office);
            return (
              <li key={a.id}>
                <button type="button" onClick={() => onAgent(a)} aria-label={`${a.name} · ${a.role}`}>
                  <span className="side-avatar" style={{ background: a.color }}>
                    {a.name.charAt(0)}
                    <i className={`side-dot ${st.tone}`} />
                  </span>
                  <span className="side-who">
                    <b>{a.name}</b>
                    <small>
                      {a.role} · <span className={`side-state ${st.tone}`}>{st.label}</span>
                    </small>
                  </span>
                  <span className="side-tags">
                    {a.provider === "codex" && <em>Codex</em>}
                    {layout.reviewer === a.id && <em>revisa</em>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="side-section side-work">
        <h3>
          Trabalhos <small>{running.length ? `${running.length} em andamento` : "nada andando"}</small>
        </h3>
        {!jobs.length && <p className="office-muted">Nenhum pedido ainda. Vá até a mesa de alguém e peça algo sobre o projeto.</p>}
        {running.length > 0 && <ul className="side-jobs office-jobs">{running.map(card)}</ul>}
        {done.length > 0 && (
          <>
            <h4>Recentes</h4>
            <ul className="side-jobs office-jobs">{shown.map(card)}</ul>
            {done.length > 6 && (
              <button type="button" className="side-more" onClick={() => setAll(!all)}>
                {all ? "Mostrar menos" : `Ver todos (${done.length})`}
              </button>
            )}
          </>
        )}
      </section>

      <p className="side-help">
        <kbd>WASD</kbd> andar · <kbd>E</kbd> interagir · <kbd>F</kbd> tela cheia · arraste para girar
      </p>
    </div>
  );
}
