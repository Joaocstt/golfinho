import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { AgentInfo, Provider } from "../shared/contracts";
import { AgentIcon } from "./agentIcons";

// Seletor do agente da tarefa, com o ícone de cada um. O <select> nativo não mostra ícones,
// então a lista é própria: abre abaixo do botão, fecha com Esc ou clique fora.
export function AgentPicker({
  value,
  agents,
  disabled,
  title,
  onChange,
}: {
  value: Provider;
  agents: AgentInfo[];
  disabled?: boolean;
  title?: string;
  onChange: (provider: Provider) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = agents.find((a) => a.provider === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function choose(provider: Provider) {
    setOpen(false);
    if (provider !== value) onChange(provider);
  }

  return (
    <div
      ref={root}
      className="task-agent-picker"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className={"task-agent-picker-button" + (open ? " open" : "")}
        aria-label="Agente da tarefa"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={() => setOpen(!open)}
      >
        <AgentIcon provider={value} size={14} />
        <span>{current?.label ?? value}</span>
        <ChevronDown size={13} className="task-agent-picker-chevron" />
      </button>
      {open && (
        <div className="task-agent-picker-menu" role="listbox" aria-label="Escolher agente">
          {agents.map((agent) => (
            <button
              key={agent.provider}
              type="button"
              role="option"
              aria-selected={agent.provider === value}
              disabled={!agent.available}
              className={agent.provider === value ? "selected" : ""}
              title={agent.available ? undefined : "CLI não encontrada. Configure o caminho em Configurações."}
              onClick={() => choose(agent.provider)}
              autoFocus={agent.provider === value}
            >
              <AgentIcon provider={agent.provider} size={15} />
              <span className="task-agent-picker-label">
                {agent.label}
                {!agent.available && <small>não instalado</small>}
              </span>
              {agent.provider === value && <Check size={14} className="task-agent-picker-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
