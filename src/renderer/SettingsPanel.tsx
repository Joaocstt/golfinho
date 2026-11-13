import React, { useEffect, useMemo, useState } from "react";
import { Bot, Brain, CircleCheck, CircleAlert, FolderCog, Minus, Plus, SlidersHorizontal, X } from "lucide-react";
import type { AgentInfo, Project, Provider, Settings } from "../shared/contracts";
import { AgentIcon } from "./agentIcons";
import { FileTypeIcon } from "./fileIcons";
import { UI_SCALES, applyUiScale, readUiScale } from "./uiScale";
import { useConfirm } from "./ui";

type Section = "geral" | "agentes" | "memoria" | "projetos";
const SECTIONS: { id: Section; label: string; hint: string; icon: typeof Bot }[] = [
  { id: "geral", label: "Geral", hint: "Aparência e execução", icon: SlidersHorizontal },
  { id: "agentes", label: "Agentes", hint: "CLIs de cada agente", icon: Bot },
  { id: "memoria", label: "Memória", hint: "Notas e ferramentas MCP", icon: Brain },
  { id: "projetos", label: "Projetos", hint: "Setup das pastas", icon: FolderCog },
];
const PROVIDERS: Provider[] = ["claude", "codex", "antigravity"];
const AGENT_HINTS: Record<Provider, string> = {
  claude: "Claude Code. Comando padrão: claude",
  codex: "OpenAI Codex. Comando padrão: codex",
  antigravity: "Google Antigravity. Comando padrão: agy",
};
const SECTION_KEY = "golfinho.ui.settingsSection";

// Configurações em abas laterais. As alterações ficam num rascunho e só valem ao salvar; a
// escala da interface é preferência de tela e vale na hora, sem passar pelo "Salvar".
export function SettingsPanel({
  settings,
  projects,
  agents,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  settings: Settings;
  projects: Project[];
  agents: AgentInfo[];
  busy: boolean;
  error?: React.ReactNode;
  onSubmit: (settings: Settings) => void;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const [section, setSection] = useState<Section>(() => {
    try {
      const saved = localStorage.getItem(SECTION_KEY) as Section | null;
      return saved && SECTIONS.some((s) => s.id === saved) ? saved : "geral";
    } catch {
      return "geral";
    }
  });
  const [draft, setDraft] = useState<Settings>(() => structuredClone(settings));
  const [uiScale, setUiScale] = useState(readUiScale);
  const dirty = useMemo(() => JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(settings)), [draft, settings]);
  const memoryOn = draft.memory?.enabled !== false;

  function go(next: Section) {
    setSection(next);
    try {
      localStorage.setItem(SECTION_KEY, next);
    } catch {
      /* vale só nesta sessão */
    }
  }
  async function close() {
    if (
      dirty &&
      !(await confirm({
        title: "Descartar as alterações?",
        message: "Há configurações alteradas que ainda não foram salvas.",
        confirmLabel: "Descartar",
        cancelLabel: "Continuar editando",
        tone: "danger",
      }))
    )
      return;
    onClose();
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const setConcurrency = (value: number) =>
    setDraft({ ...draft, concurrency: Math.min(8, Math.max(1, Math.round(value) || 1)) });

  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(normalize(draft));
      }}
    >
      <header className="settings-head">
        <h2>Configurações</h2>
        <button type="button" className="settings-close" aria-label="Fechar janela" disabled={busy} onClick={() => void close()}>
          <X size={18} />
        </button>
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Seções das configurações">
          {SECTIONS.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <Icon size={16} />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {error}
          {section === "geral" && (
            <>
              <SectionHead title="Geral" text="Como o Golfinho aparece e quantas coisas ele roda ao mesmo tempo." />
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-label">
                    <strong id="ui-scale-label">Tamanho da interface</strong>
                    <small>Vale na hora e fica salvo neste computador.</small>
                  </div>
                </div>
                <div className="settings-segments" role="radiogroup" aria-labelledby="ui-scale-label">
                  {UI_SCALES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      role="radio"
                      aria-checked={uiScale === s.value}
                      className={uiScale === s.value ? "active" : ""}
                      onClick={() => {
                        applyUiScale(s.value);
                        setUiScale(s.value);
                      }}
                    >
                      <span style={{ fontSize: `${12 * s.value}px` }}>Aa</span>
                      <small>{s.label.replace(/ \(.*\)/, "")}</small>
                      <em>{Math.round(s.value * 100)}%</em>
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-label">
                    <label htmlFor="settings-concurrency">
                      <strong>Execuções simultâneas</strong>
                    </label>
                    <small>
                      Máximo de agentes e checks rodando ao mesmo tempo, somando todos os projetos. Cada projeto
                      roda uma tarefa por vez.
                    </small>
                  </div>
                  <div className="settings-stepper">
                    <button
                      type="button"
                      aria-label="Diminuir execuções simultâneas"
                      disabled={draft.concurrency <= 1}
                      onClick={() => setConcurrency(draft.concurrency - 1)}
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      id="settings-concurrency"
                      aria-label="Execuções simultâneas"
                      type="number"
                      min={1}
                      max={8}
                      required
                      value={draft.concurrency}
                      onChange={(e) => setConcurrency(Number(e.target.value))}
                    />
                    <button
                      type="button"
                      aria-label="Aumentar execuções simultâneas"
                      disabled={draft.concurrency >= 8}
                      onClick={() => setConcurrency(draft.concurrency + 1)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
          {section === "agentes" && (
            <>
              <SectionHead
                title="Agentes"
                text="O comando ou caminho de cada CLI. O login é feito na própria CLI; o Golfinho não pede nem guarda chaves de API."
              />
              {PROVIDERS.map((provider) => {
                const info = agents.find((a) => a.provider === provider);
                const changed = draft.executables[provider] !== settings.executables[provider];
                return (
                  <div key={provider} className="settings-card settings-agent">
                    <div className="settings-agent-head">
                      <AgentIcon provider={provider} size={22} />
                      <div className="settings-label">
                        <strong>{info?.label ?? provider}</strong>
                        <small>{AGENT_HINTS[provider]}</small>
                      </div>
                      {changed ? (
                        <span className="settings-badge neutral">Salve para verificar</span>
                      ) : info?.available ? (
                        <span className="settings-badge ok">
                          <CircleCheck size={13} /> Instalado
                        </span>
                      ) : (
                        <span className="settings-badge warn">
                          <CircleAlert size={13} /> Não encontrado
                        </span>
                      )}
                    </div>
                    <input
                      aria-label={`Executável ${provider}`}
                      value={draft.executables[provider]}
                      spellCheck={false}
                      required
                      onChange={(e) =>
                        setDraft({ ...draft, executables: { ...draft.executables, [provider]: e.target.value } })
                      }
                    />
                  </div>
                );
              })}
            </>
          )}
          {section === "memoria" && (
            <>
              <SectionHead
                title="Memória"
                text="Notas de cada projeto que os agentes recebem e consultam. Tudo fica só neste computador."
              />
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-label">
                    <strong id="memory-switch-label">Usar a memória do projeto nas tarefas</strong>
                    <small>Desligada, as notas continuam guardadas na aba Memória, mas não vão para os agentes.</small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={memoryOn}
                    aria-labelledby="memory-switch-label"
                    className={"settings-switch" + (memoryOn ? " on" : "")}
                    onClick={() => setDraft({ ...draft, memory: { enabled: !memoryOn } })}
                  >
                    <span />
                  </button>
                </div>
              </div>
              <div className={"settings-card settings-list" + (memoryOn ? "" : " muted")}>
                <strong>Com a memória ligada</strong>
                <ul>
                  <li>Numa conversa nova, inclusive ao trocar de agente, o agente recebe todas as notas não arquivadas, as fixadas primeiro.</li>
                  <li>Cada tarefa ganha uma nota automática com a linha do tempo da conversa, atualizada a cada etapa.</li>
                  <li>
                    Claude e Codex ganham as ferramentas MCP do Golfinho para buscar nas notas e no histórico das conversas, e
                    para gravar notas novas.
                  </li>
                  <li>O Antigravity recebe as notas na primeira mensagem, sem as ferramentas MCP.</li>
                </ul>
              </div>
            </>
          )}
          {section === "projetos" && (
            <>
              <SectionHead
                title="Projetos"
                text="Comando executado na pasta de cada tarefa antes de a CLI iniciar, por exemplo npm ci. Vazio: não há nada a fazer."
              />
              {projects.length === 0 && <p className="settings-empty">Nenhum projeto adicionado ainda.</p>}
              {projects.map((p) => (
                <div key={p.id} className="settings-card settings-project">
                  <div className="settings-agent-head">
                    <FileTypeIcon name={p.name} kind="directory" size={20} />
                    <div className="settings-label">
                      <strong>{p.name}</strong>
                      <small title={p.path}>{p.path}</small>
                    </div>
                  </div>
                  <input
                    aria-label={`Setup de ${p.name}`}
                    placeholder="Ex.: npm ci"
                    maxLength={2000}
                    spellCheck={false}
                    value={draft.setup[p.id] ?? ""}
                    onChange={(e) => setDraft({ ...draft, setup: { ...draft.setup, [p.id]: e.target.value } })}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <footer className="settings-foot">
        <span className={"settings-status" + (dirty ? " dirty" : "")}>
          {dirty ? "Alterações não salvas" : "Tudo salvo"}
        </span>
        <button type="button" disabled={busy} onClick={() => void close()}>
          Cancelar
        </button>
        <button className="primary" disabled={busy || !dirty}>
          Salvar configurações
        </button>
      </footer>
    </form>
  );
}

function SectionHead({ title, text }: { title: string; text: string }) {
  return (
    <div className="settings-section-head">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

// O que vai para o backend: setups vazios saem, executáveis sem espaços nas pontas.
function normalize(s: Settings): Settings {
  return {
    ...s,
    executables: {
      codex: s.executables.codex.trim(),
      claude: s.executables.claude.trim(),
      antigravity: s.executables.antigravity.trim(),
    },
    setup: Object.fromEntries(
      Object.entries(s.setup)
        .map(([id, command]) => [id, command.trim()] as const)
        .filter(([, command]) => command),
    ),
    memory: { enabled: s.memory?.enabled !== false },
  };
}
