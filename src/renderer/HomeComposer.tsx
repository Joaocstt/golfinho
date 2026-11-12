import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, FolderOpen } from "lucide-react";
import type { AgentInfo, Project, Provider } from "../shared/contracts";
import { AgentIcon } from "./agentIcons";

// Tela inicial: como começar uma conversa nova. O pedido vira uma tarefa com branch própria e
// já abre no chat, com o agente trabalhando.
export function HomeComposer({
  projects,
  agents,
  defaultProject,
  onStart,
}: {
  projects: Project[];
  agents: AgentInfo[];
  defaultProject: string;
  onStart: (projectId: string, provider: Provider, text: string) => Promise<void>;
}) {
  const available = agents.filter((a) => a.available);
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState(defaultProject || projects[0]?.id || "");
  const [provider, setProvider] = useState<Provider>(
    (available.find((a) => a.provider === "claude") ?? available[0])?.provider ?? "claude",
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (defaultProject) setProjectId(defaultProject);
  }, [defaultProject]);
  useEffect(() => {
    if (!projects.some((p) => p.id === projectId)) setProjectId(projects[0]?.id ?? "");
  }, [projects, projectId]);
  // A caixa cresce com o texto, até um limite.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  async function submit() {
    const value = text.trim();
    if (!value || !projectId || sending) return;
    setSending(true);
    setError("");
    try {
      await onStart(projectId, provider, value);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  return (
    <div className="home">
      <h1 className="home-title">{greeting}. O que vamos fazer?</h1>
      <form
        className="home-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={box}
          id="home-input"
          aria-label="Pedido para a nova tarefa"
          placeholder={projects.length ? "Descreva a tarefa: corrigir um bug, criar uma tela, revisar o README…" : "Adicione um projeto para começar"}
          value={text}
          disabled={!projects.length}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="home-composer-bar">
          <label className="home-select" title="Projeto da tarefa">
            <FolderOpen size={14} />
            <select aria-label="Projeto da nova tarefa" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="home-select" title="Agente que vai trabalhar">
            <AgentIcon provider={provider} />
            <select aria-label="Agente da nova tarefa" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
              {available.map((a) => (
                <option key={a.provider} value={a.provider}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="home-send"
            aria-label="Começar tarefa"
            title="Cria a tarefa numa branch nova e começa a conversa (Enter)"
            disabled={!text.trim() || !projectId || sending}
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </form>
      {error && (
        <p className="home-error" role="alert">
          {error}
        </p>
      )}
      <p className="home-hint">
        Cada pedido vira uma tarefa com branch própria. O agente trabalha nela e você acompanha pela conversa.
      </p>
    </div>
  );
}
