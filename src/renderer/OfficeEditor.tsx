import React from "react";
import { Armchair, Eraser, MousePointer2, Monitor, Paintbrush, Trash2 } from "lucide-react";
import type { FurnitureKind, OfficeAgent, OfficeLayout, TileKind } from "../shared/office";
import {
  FURNITURE_LABEL,
  MAX_AGENTS,
  SINGLETONS,
  TEMPLATES,
  TILE_LABEL,
  layoutProblems,
  removeItem,
  updateAgent,
  type ItemRef,
} from "../shared/officeLayout";

export type Tool =
  | { kind: "select" }
  | { kind: "erase" }
  | { kind: "tile"; tile: TileKind }
  | { kind: "furniture"; furniture: FurnitureKind }
  | { kind: "desk" };

const TILES: TileKind[] = ["piso", "tapete", "azulejo", "parede", "janela"];
const FURNITURE: FurnitureKind[] = ["planta", "sofa", "estante", "bebedouro", "telao", "quadro", "chefe"];
const same = (a: Tool, b: Tool) => JSON.stringify(a) === JSON.stringify(b);

// Painel do modo de edição: ferramentas, modelos prontos e o cadastro do agente escolhido.
export function OfficeEditor({
  layout,
  tool,
  onTool,
  selected,
  onSelect,
  onChange,
  onTemplate,
  onSave,
  onCancel,
  saving,
  error,
}: {
  layout: OfficeLayout;
  tool: Tool;
  onTool: (tool: Tool) => void;
  selected: ItemRef | null;
  onSelect: (ref: ItemRef | null) => void;
  onChange: (layout: OfficeLayout) => void;
  onTemplate: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
}) {
  const problems = layoutProblems(layout);
  const agent = selected?.type === "agent" ? layout.agents.find((a) => a.id === selected.id) : undefined;
  const furniture = selected?.type === "furniture" ? layout.furniture.find((f) => f.id === selected.id) : undefined;
  const set = (patch: Partial<OfficeAgent>) => agent && onChange(updateAgent(layout, agent.id, patch));
  const button = (t: Tool, label: string, icon?: React.ReactNode) => (
    <button
      key={JSON.stringify(t)}
      type="button"
      className={same(tool, t) ? "active" : ""}
      aria-pressed={same(tool, t)}
      onClick={() => onTool(t)}
      title={label}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="office-editor">
      <div className="office-editor-actions">
        <button type="button" className="primary" disabled={saving || problems.length > 0} onClick={onSave}>
          {saving ? "Salvando..." : "Salvar escritório"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
      {error && <p className="office-error">{error}</p>}
      {problems.length > 0 && (
        <ul className="office-problems" aria-label="O que falta para salvar">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <fieldset>
        <legend>Ferramenta</legend>
        <div className="office-tools">
          {button({ kind: "select" }, "Selecionar e mover", <MousePointer2 size={12} />)}
          {button({ kind: "erase" }, "Remover", <Eraser size={12} />)}
          {layout.agents.length < MAX_AGENTS && button({ kind: "desk" }, "Nova mesa (agente)", <Monitor size={12} />)}
        </div>
      </fieldset>
      <fieldset>
        <legend>
          <Paintbrush size={12} /> Chão e paredes
        </legend>
        <div className="office-tools">{TILES.map((t) => button({ kind: "tile", tile: t }, TILE_LABEL[t]))}</div>
      </fieldset>
      <fieldset>
        <legend>
          <Armchair size={12} /> Móveis
        </legend>
        <div className="office-tools">
          {FURNITURE.map((f) =>
            button({ kind: "furniture", furniture: f }, SINGLETONS.includes(f) ? `${FURNITURE_LABEL[f]} (mover)` : FURNITURE_LABEL[f]),
          )}
        </div>
      </fieldset>

      <label className="office-project">
        Começar de um modelo
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onTemplate(e.target.value);
          }}
          aria-label="Modelo de escritório"
        >
          <option value="">Escolha um modelo...</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}: {t.hint}
            </option>
          ))}
        </select>
      </label>

      {furniture && (
        <div className="office-selected">
          <strong>{FURNITURE_LABEL[furniture.kind]}</strong>
          <p className="office-muted">Arraste no escritório para mudar de lugar.</p>
          {!SINGLETONS.includes(furniture.kind) && (
            <button
              type="button"
              onClick={() => {
                onChange(removeItem(layout, { type: "furniture", id: furniture.id }));
                onSelect(null);
              }}
            >
              <Trash2 size={12} /> Remover
            </button>
          )}
        </div>
      )}

      {agent && (
        <form className="office-agent-form" onSubmit={(e) => e.preventDefault()} aria-label={`Agente ${agent.name}`}>
          <div className="office-row">
            <label>
              Nome
              <input id="office-agent-name" value={agent.name} maxLength={30} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="office-narrow">
              Artigo
              <select id="office-agent-article" value={agent.article} onChange={(e) => set({ article: e.target.value as "a" | "o" })}>
                <option value="a">a</option>
                <option value="o">o</option>
              </select>
            </label>
          </div>
          <div className="office-row">
            <label>
              Cargo
              <input id="office-agent-role" value={agent.role} maxLength={40} onChange={(e) => set({ role: e.target.value })} />
            </label>
            <label>
              Área (curta)
              <input id="office-agent-area" value={agent.area} maxLength={60} onChange={(e) => set({ area: e.target.value })} />
            </label>
          </div>
          <label>
            Do que cuida
            <textarea
              id="office-agent-scope"
              rows={3}
              value={agent.scope}
              maxLength={400}
              onChange={(e) => set({ scope: e.target.value })}
            />
          </label>
          <label>
            Personalidade
            <input
              id="office-agent-personality"
              value={agent.personality}
              maxLength={200}
              onChange={(e) => set({ personality: e.target.value })}
            />
          </label>
          <label>
            O que entrega
            <select id="office-agent-mode" value={agent.mode} onChange={(e) => set({ mode: e.target.value as OfficeAgent["mode"] })}>
              <option value="deliver">Um texto na mesa do chefe</option>
              <option value="task">Uma tarefa de código no Golfinho</option>
            </select>
          </label>
          <label>
            Modelo
            <select id="office-agent-model" value={agent.model} onChange={(e) => set({ model: e.target.value as OfficeAgent["model"] })}>
              <option value="padrao">Padrão da CLI</option>
              <option value="haiku">Haiku (rápido)</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus (mais capaz)</option>
            </select>
          </label>
          <label className="office-check">
            <input id="office-agent-web" type="checkbox" checked={agent.web} onChange={(e) => set({ web: e.target.checked })} />
            Pode pesquisar na web
          </label>
          <label className="office-check">
            <input
              id="office-agent-reviewer"
              type="checkbox"
              checked={layout.reviewer === agent.id}
              onChange={(e) => onChange({ ...layout, reviewer: e.target.checked ? agent.id : null })}
            />
            Revisa as entregas da equipe
          </label>
          <div className="office-row">
            <label className="office-color">
              Roupa
              <input id="office-agent-color" type="color" value={agent.color} onChange={(e) => set({ color: e.target.value })} />
            </label>
            <label className="office-color">
              Cabelo
              <input id="office-agent-hair" type="color" value={agent.hair} onChange={(e) => set({ hair: e.target.value })} />
            </label>
          </div>
          <button
            type="button"
            className="danger"
            onClick={() => {
              onChange(removeItem(layout, { type: "agent", id: agent.id }));
              onSelect(null);
            }}
          >
            <Trash2 size={12} /> Tirar {agent.name} da equipe
          </button>
        </form>
      )}
      {!selected && (
        <p className="office-muted">
          Clique numa mesa para editar o agente dela. Arraste mesas e móveis para mudar de lugar. Com uma ferramenta de
          chão escolhida, clique ou arraste para pintar.
        </p>
      )}
    </div>
  );
}
