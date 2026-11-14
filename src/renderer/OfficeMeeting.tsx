import React, { useState } from "react";
import { Users } from "lucide-react";
import type { Request } from "../shared/contracts";
import type { OfficeAgent, OfficeState } from "../shared/office";
import { statusLabel } from "./OfficePane";

const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;

/** Quem vem para a reunião por padrão: o de código e mais dois de áreas diferentes. */
export function defaultInvites(team: OfficeAgent[], reviewer: string | null): string[] {
  const coder = team.find((a) => a.mode === "task");
  const others = team.filter((a) => a.id !== coder?.id && a.id !== reviewer);
  return [...(coder ? [coder.id] : []), ...others.map((a) => a.id)].slice(0, 3);
}

// Reunião: o chefe escolhe quem participa e descreve o pedido grande. A equipe senta na mesa de
// reunião, discute (as falas aparecem nos balões) e cada um sai com a sua parte na fila.
export function OfficeMeeting({ office, onStarted }: { office: OfficeState; onStarted: () => void }) {
  const team = office.layout.agents;
  const meeting = office.meeting;
  const [fresh, setFresh] = useState(!meeting || meeting.status !== "discutindo");
  const [text, setText] = useState("");
  const [invited, setInvited] = useState<string[]>(() => defaultInvites(team, office.layout.reviewer));
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const name = (id: string) => team.find((a) => a.id === id)?.name ?? id;
  const color = (id: string) => team.find((a) => a.id === id)?.color ?? "#94a3b8";
  const showLast = meeting && (!fresh || meeting.status === "discutindo");

  async function start() {
    setSending(true);
    setError("");
    try {
      await request({ action: "officeMeeting", projectId: office.projectId, agentIds: invited, text });
      setText("");
      setFresh(false);
      onStarted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (showLast && meeting)
    return (
      <div className="meeting">
        <p className="meeting-topic">
          <Users size={14} /> {meeting.request}
        </p>
        <p className="office-muted">Com {meeting.agentIds.map(name).join(", ")}.</p>
        {meeting.status === "discutindo" && <p className="meeting-live">💭 A equipe está discutindo na mesa de reunião...</p>}
        {meeting.status === "erro" && <p className="office-error">A reunião não fechou um plano: {meeting.error}</p>}
        {meeting.lines.length > 0 && (
          <ol className="meeting-lines">
            {meeting.lines.map((l, i) => (
              <li key={i}>
                <b style={{ color: color(l.agentId) }}>{name(l.agentId)}</b> {l.text}
              </li>
            ))}
          </ol>
        )}
        {meeting.summary && <p className="meeting-summary">{meeting.summary}</p>}
        {meeting.tasks.length > 0 && (
          <>
            <h4>Quem ficou com o quê</h4>
            <ul className="meeting-tasks">
              {meeting.tasks.map((t) => {
                const job = office.jobs.find((j) => j.id === t.jobId);
                return (
                  <li key={t.jobId}>
                    <b style={{ color: color(t.agentId) }}>{name(t.agentId)}</b> {t.title}
                    {job && <small> · {statusLabel(job)}</small>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {meeting.status !== "discutindo" && (
          <button type="button" className="primary" onClick={() => setFresh(true)}>
            Nova reunião
          </button>
        )}
      </div>
    );

  return (
    <form
      className="meeting"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <p className="office-muted">
        Leve um pedido grande para a mesa de reunião. A equipe discute, divide o trabalho e cada um sai com a sua parte na fila. Código ainda vira plano para você aprovar.
      </p>
      <fieldset className="meeting-people">
        <legend>Quem participa (2 a 4)</legend>
        {team.map((a) => {
          const on = invited.includes(a.id);
          return (
            <label key={a.id} className={on ? "on" : ""}>
              <input
                type="checkbox"
                checked={on}
                disabled={!on && invited.length >= 4}
                onChange={() => setInvited(on ? invited.filter((id) => id !== a.id) : [...invited, a.id])}
              />
              <i style={{ background: a.color }} />
              {a.name} · {a.role}
            </label>
          );
        })}
      </fieldset>
      <label>
        O pedido
        <textarea
          aria-label="Assunto da reunião"
          value={text}
          rows={4}
          maxLength={4000}
          autoFocus
          placeholder="Ex.: Quero um modo offline no app. Vejam o que precisa, pesquisem como os concorrentes fazem e montem o plano."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {error && <p className="office-error">{error}</p>}
      <div className="meeting-actions">
        {meeting && (
          <button type="button" onClick={() => setFresh(false)}>
            Ver a última reunião
          </button>
        )}
        <button type="submit" className="primary" disabled={sending || invited.length < 2 || !text.trim()}>
          {sending ? "Chamando..." : "Começar a reunião"}
        </button>
      </div>
    </form>
  );
}
