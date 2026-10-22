import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Archive, ArchiveRestore, Pencil, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import type { Memory, MemoryKind, Project, Request, Task } from "../shared/contracts";
import { useConfirm } from "./ui";
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;

const KINDS: { value: MemoryKind; label: string }[] = [
  { value: "decisao", label: "Decisão" },
  { value: "convencao", label: "Convenção" },
  { value: "armadilha", label: "Armadilha" },
  { value: "contexto", label: "Contexto" },
  { value: "tarefa", label: "Tarefa" },
];
const kindLabel = (kind: MemoryKind) => KINDS.find((k) => k.value === kind)?.label ?? kind;
const ORIGINS: Record<Memory["origin"], string> = {
  usuario: "criada por você",
  agente: "criada pelo agente",
  automatica: "registro automático",
};
interface Draft {
  id?: string;
  kind: MemoryKind;
  title: string;
  content: string;
  pinned: boolean;
  archived: boolean;
}
const empty: Draft = { kind: "decisao", title: "", content: "", pinned: false, archived: false };
const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Memória de um projeto: notas que os agentes recebem nas próximas tarefas e que podem consultar
// e gravar pelas ferramentas MCP. Tudo fica no banco local do Golfinho.
export function MemoryPane({
  projects,
  tasks,
  initialProject,
  enabled,
  onOpenTask,
}: {
  projects: Project[];
  tasks: Task[];
  initialProject: string;
  enabled: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const confirm = useConfirm();
  const [projectId, setProjectId] = useState(initialProject || projects[0]?.id || "");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MemoryKind | "">("");
  const [archived, setArchived] = useState(false);
  const [items, setItems] = useState<Memory[]>([]);
  // Nota nova (sem id) aparece no topo; a edição de uma nota existente abre dentro do próprio cartão.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projects.some((p) => p.id === projectId)) setProjectId(projects[0]?.id ?? "");
  }, [projects, projectId]);

  const load = useCallback(async () => {
    if (!projectId) return setItems([]);
    try {
      const list = await request<Memory[]>({
        action: "memoryList",
        projectId,
        ...(query.trim() ? { query: query.trim() } : {}),
        ...(kind ? { kind } : {}),
        archived,
      });
      setItems(list);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId, query, kind, archived]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 150);
    return () => clearTimeout(timer);
  }, [load]);
  // Notas gravadas pelo agente ou pelo registro automático aparecem sem recarregar.
  useEffect(() => window.golfinho.subscribe((s) => s.kind === "changed" && void load()), [load]);

  async function save(next: Draft) {
    try {
      await request<Memory>({
        action: "memorySave",
        memory: {
          ...(next.id ? { id: next.id } : {}),
          projectId,
          kind: next.kind,
          title: next.title,
          content: next.content,
          pinned: next.pinned,
          archived: next.archived,
        },
      });
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      void load();
    }
  }
  const draftOf = (m: Memory): Draft => ({
    id: m.id,
    kind: m.kind,
    title: m.title,
    content: m.content,
    pinned: m.pinned,
    archived: m.archived,
  });
  async function remove(memory: Memory) {
    if (
      !(await confirm({
        title: "Excluir esta nota?",
        message: `"${memory.title}" sai da memória do projeto e não pode ser recuperada. Para só tirá-la do envio aos agentes, arquive.`,
        confirmLabel: "Excluir nota",
        tone: "danger",
      }))
    )
      return;
    try {
      await request({ action: "memoryDelete", id: memory.id });
    } catch (e) {
      setError((e as Error).message);
    }
    void load();
  }

  if (!projects.length)
    return (
      <section className="memory-pane">
        <div className="memory-inner">
          <div className="overview-head">
            <h1>Memória</h1>
          </div>
          <p className="notice">Adicione um projeto para começar a guardar a memória dele.</p>
        </div>
      </section>
    );

  const editor = (value: Draft) => (
    <MemoryEditor
      value={value}
      onChange={setDraft}
      onCancel={() => setDraft(null)}
      onSave={async () => {
        if (await save(value)) setDraft(null);
      }}
    />
  );

  return (
    <section className="memory-pane">
      <div className="memory-inner">
        <div className="overview-head">
          <h1>Memória</h1>
          <span>Notas que os agentes recebem nas próximas tarefas deste projeto</span>
        </div>
        {!enabled && (
          <p className="notice notice-warn">
            A memória está desligada nas Configurações: as notas ficam guardadas, mas não vão para os agentes.
          </p>
        )}
        <div className="memory-toolbar">
          <select aria-label="Projeto" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="memory-search">
            <Search size={14} />
            <input
              type="search"
              aria-label="Buscar na memória"
              placeholder="Buscar (ignora acentos)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="primary memory-new" onClick={() => setDraft({ ...empty })}>
            <Plus size={14} /> Nova nota
          </button>
        </div>
        <div className="memory-filters" role="group" aria-label="Filtrar por tipo">
          {[{ value: "" as const, label: "Todas" }, ...KINDS].map((k) => (
            <button
              key={k.value || "todas"}
              className={"memory-chip" + (kind === k.value ? " active" : "") + (k.value ? ` kind-${k.value}` : "")}
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
            >
              {k.label}
            </button>
          ))}
          <label className="check-row memory-archived">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Arquivadas
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        {draft && !draft.id && editor(draft)}
        <div className="memory-list">
          {items.length === 0 && (
            <p className="memory-empty">
              {query || kind
                ? "Nenhuma nota encontrada."
                : archived
                  ? "Nenhuma nota arquivada."
                  : "Nenhuma nota ainda. Cada tarefa ganha uma nota automática assim que o agente responde, e você pode salvar respostas do chat ou criar notas aqui."}
            </p>
          )}
          {items.map((m) => {
            if (draft?.id === m.id) return <div key={m.id}>{editor(draft)}</div>;
            const source = m.source ? tasks.find((t) => t.id === m.source!.taskId) : undefined;
            return (
              <article key={m.id} className={"memory-card" + (m.pinned ? " pinned" : "")}>
                <header>
                  <span className={`memory-kind kind-${m.kind}`}>{kindLabel(m.kind)}</span>
                  <strong title={m.title}>{m.title}</strong>
                  <div className="memory-actions">
                    <button
                      className={m.pinned ? "on" : ""}
                      title={m.pinned ? "Desafixar" : "Fixar: vai para toda conversa nova"}
                      aria-label={m.pinned ? "Desafixar" : "Fixar"}
                      onClick={() => void save({ ...draftOf(m), pinned: !m.pinned })}
                    >
                      {m.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                    </button>
                    <button title="Editar" aria-label="Editar" onClick={() => setDraft(draftOf(m))}>
                      <Pencil size={14} />
                    </button>
                    <button
                      title={m.archived ? "Restaurar" : "Arquivar: deixa de ir para os agentes"}
                      aria-label={m.archived ? "Restaurar" : "Arquivar"}
                      onClick={() => void save({ ...draftOf(m), archived: !m.archived })}
                    >
                      {m.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    </button>
                    <button className="danger" title="Excluir" aria-label="Excluir" onClick={() => void remove(m)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </header>
                <Collapsible>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </Collapsible>
                <footer>
                  {m.pinned && <span className="memory-pinned">Fixada</span>}
                  <span>{ORIGINS[m.origin]}</span>
                  {m.source &&
                    (source ? (
                      <button className="link" onClick={() => onOpenTask(source.id)}>
                        {m.source.title}
                      </button>
                    ) : (
                      <span>{m.source.title} (tarefa excluída)</span>
                    ))}
                  <span>{when(m.updatedAt)}</span>
                  <span>usada {m.uses}×</span>
                </footer>
              </article>
            );
          })}
        </div>
        <p className="memory-foot">
          As notas ficam só neste computador. Numa conversa nova, inclusive ao trocar de agente, o agente
          recebe todas as notas não arquivadas (as fixadas primeiro). Se forem muitas, as últimas vão só
          pelo título. Claude e Codex também podem buscar e gravar notas pelas ferramentas MCP do Golfinho.
        </p>
      </div>
    </section>
  );
}

// Conteúdo longo fica recolhido em poucas linhas, com um botão para abrir, em vez de rolar
// dentro do cartão.
function Collapsible({ children }: { children: React.ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  // Mede com o conteúdo recolhido: se passa da altura, o botão aparece.
  useLayoutEffect(() => {
    const el = body.current;
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 4);
  }, [children, open]);
  return (
    <>
      <div ref={body} className={"memory-content" + (open ? "" : " clamped")}>
        {children}
      </div>
      {long && (
        <button className="memory-more" onClick={() => setOpen(!open)}>
          {open ? "Mostrar menos" : "Mostrar mais"}
        </button>
      )}
    </>
  );
}

function MemoryEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: Draft;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="memory-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div className="memory-form-row">
        <select
          aria-label="Tipo da nota"
          value={value.kind}
          onChange={(e) => onChange({ ...value, kind: e.target.value as MemoryKind })}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Título"
          placeholder="Título curto (ex.: Migrations sempre versionadas)"
          maxLength={200}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          autoFocus
        />
      </div>
      <textarea
        aria-label="Conteúdo"
        placeholder="O que o agente precisa saber. Aceita Markdown."
        rows={7}
        maxLength={8000}
        value={value.content}
        onChange={(e) => onChange({ ...value, content: e.target.value })}
      />
      <div className="memory-form-foot">
        <label className="check-row">
          <input type="checkbox" checked={value.pinned} onChange={(e) => onChange({ ...value, pinned: e.target.checked })} />
          Fixar: vai para toda conversa nova
        </label>
        <span className="memory-count">{value.content.length}/8000</span>
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button className="primary" disabled={!value.title.trim() || !value.content.trim()}>
          {value.id ? "Salvar alterações" : "Salvar nota"}
        </button>
      </div>
    </form>
  );
}
