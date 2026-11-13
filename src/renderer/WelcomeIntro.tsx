import React, { useEffect, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import type { AgentInfo, Provider } from "../shared/contracts";
import { AgentIcon } from "./agentIcons";
import golfinhoLogo from "../../build/icon.png";

export const INTRO_DURATION = 15_000;
// Quando cada CLI aparece na busca (ms desde o início); o resultado sai 1 s depois.
const REVEAL: Record<Provider, number> = { claude: 4000, codex: 6200, antigravity: 8400 };
const SETTLE = 1000;
const SCAN_FROM = 3000;
const SUMMARY_FROM = 11000;
const ORDER: Provider[] = ["claude", "codex", "antigravity"];
const NAMES: Record<Provider, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity" };
// Mensagens que passam embaixo do título, uma a cada 2,5 s.
export const WELCOME_MESSAGES = [
  "Que bom ter você aqui.",
  "Arrumando as mesas do escritório…",
  "Procurando os agentes de código neste computador…",
  "Chamando a equipe para o trabalho…",
  "Conferindo os projetos e as branches…",
  "Tudo pronto. Bom trabalho!",
];
const MESSAGE_EVERY = 2500;

// Abertura do app: boas-vindas e a busca pelas CLIs dos agentes neste computador, com o
// resultado real (o que foi encontrado e onde). Dura 15 s e fecha sozinha.
export function WelcomeIntro({ agents, onDone }: { agents: AgentInfo[] | null; onDone: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const started = useRef(performance.now());
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let frame = 0;
    let closing: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const t = performance.now() - started.current;
      setElapsed(t);
      if (t >= INTRO_DURATION) {
        setLeaving(true);
        closing = setTimeout(() => doneRef.current(), 450);
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (closing) clearTimeout(closing);
    };
  }, []);

  const byProvider = new Map((agents ?? []).map((a) => [a.provider, a]));
  const found = ORDER.filter((p) => byProvider.get(p)?.available).length;
  const scanning = elapsed >= SCAN_FROM;
  const summary = elapsed >= SUMMARY_FROM;
  const progress = Math.min(1, elapsed / INTRO_DURATION);
  const message = Math.min(WELCOME_MESSAGES.length - 1, Math.floor(elapsed / MESSAGE_EVERY));

  return (
    <div className={`intro${leaving ? " leaving" : ""}`} role="dialog" aria-modal="true" aria-label="Boas-vindas ao Golfinho">
      <div className="intro-glow" aria-hidden="true" />
      <div className="intro-card">
        <div className="intro-logo">
          <span className={`intro-radar${scanning && !summary ? " on" : ""}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <img src={golfinhoLogo} alt="" width={84} height={84} />
        </div>
        <h1 className="intro-title">
          Bem-vindo ao <span>Golfinho</span>
        </h1>
        <p className="intro-sub">Seus agentes de código trabalhando em branches, num só lugar.</p>
        <p className="intro-message" aria-live="polite" key={message}>
          {WELCOME_MESSAGES[message]}
        </p>

        <section className={`intro-scan${scanning ? " on" : ""}`}>
          <p className="intro-scan-head">
            <Search size={14} aria-hidden="true" />
            {summary ? "Busca concluída" : "Procurando as CLIs no seu computador…"}
          </p>
          <ul>
            {ORDER.map((p) => {
              const info = byProvider.get(p);
              const shown = elapsed >= REVEAL[p];
              const settled = shown && elapsed >= REVEAL[p] + SETTLE && agents !== null;
              return (
                <li key={p} className={(shown ? "shown " : "") + (settled ? (info?.available ? "ok" : "missing") : "")}>
                  <span className="intro-agent">
                    <AgentIcon provider={p} />
                    {info?.label ?? NAMES[p]}
                  </span>
                  <span className="intro-result">
                    {!settled ? (
                      <span className="intro-spinner" aria-label="procurando" />
                    ) : info?.available ? (
                      <>
                        <Check size={14} aria-hidden="true" />
                        <code title={info.path ?? info.executable}>{info.path ?? info.executable}</code>
                      </>
                    ) : (
                      <>
                        <X size={14} aria-hidden="true" />
                        <span>não encontrado. Configure o caminho em Configurações.</span>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <div className={`intro-end${summary ? " on" : ""}`}>
          <p>
            {agents === null
              ? "Ainda conferindo os agentes…"
              : found === 0
                ? "Nenhum agente encontrado. Instale o Claude Code ou o Codex e aponte o caminho em Configurações."
                : `${found} de ${ORDER.length} agentes prontos para trabalhar.`}
          </p>
        </div>
      </div>
      <div className="intro-progress" aria-hidden="true">
        <i style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
