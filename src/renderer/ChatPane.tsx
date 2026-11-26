import React, { createContext, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brain, ChevronDown, ChevronUp, CornerDownLeft, Lock, Play, Plus, Search, Square, X } from "lucide-react";
import type { ChatBlock, ChatCommandOption, ChatEvent, ChatHistoryItem, ChatEffort, ChatModelOption, ChatPermissionMode, ChatSearchHit, Provider, Request } from "../shared/contracts";
import { currentContext } from "../shared/chatContext";
import { CommandMenu, ModelMenu, PermissionMenu, matchCommands } from "./ChatMenus";
import { QuestionCard } from "./ChatQuestions";
import { AgentIcon } from "./agentIcons";
import { absolutePathIn, asFilePath } from "./filePaths";
import { FilePreview } from "./FilePreview";
import { findShortcutLabel, isFindShortcut } from "./shortcuts";
export interface ChatPaneProps {
  taskId: string;
  provider: string;
  model?: string | null;
  /** Modo de permissão do Claude; null = pedir aprovação. */
  permissionMode?: ChatPermissionMode | null;
  /** Esforço do Claude; null = padrão do modelo. */
  effort?: ChatEffort | null;
  draft: string;
  onDraftChange: (draft: string) => void;
  onError: (e: unknown) => void;
  approvalTarget?: { id: string; version: number };
  /** Mensagem específica a abrir e destacar (vinda da busca entre conversas). */
  jumpTarget?: { seq: number; version: number };
  /** Abre outra conversa numa mensagem específica (usado na busca "Todas as conversas"). */
  onOpenConversation?: (taskId: string, seq: number) => void;
  /** Controla se o atalho global Ctrl+F / Cmd+F pertence a este painel de chat. */
  active?: boolean;
  /** Chat bloqueado enquanto a sessão da tarefa não é retomada: aviso e ação no lugar do campo. */
  locked?: { message: string; actionLabel: string; onAction: () => void; busy?: boolean } | null;
  /** Abre o arquivo no editor da aba Arquivos. */
  onOpenFile?: (path: string) => void;
}
// Cada provedor tem a sua cor de destaque, para não parecer a conversa de outro.
const LABELS: Record<string, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" };
const WELCOME_TITLES: Record<string, string> = {
  claude: "Como posso ajudar?",
  codex: "Codex",
  antigravity: "Antigravity",
};
function isProvider(value: string): value is Provider {
  return value === "claude" || value === "codex" || value === "antigravity";
}
function AgentMark({ provider, size, busy }: { provider: string; size: number; busy?: boolean }) {
  if (provider === "claude" || !isProvider(provider)) {
    return <span className="chat-spark" aria-hidden="true">✻</span>;
  }
  return (
    <span className={busy ? "chat-busy-icon" : "chat-brand-mark"} aria-hidden="true">
      <AgentIcon provider={provider} size={size} />
    </span>
  );
}
// Modelos oferecidos em cada CLI. Vazio = padrão da própria CLI.
const MODELS: Record<string, { value: string; label: string }[]> = {
  claude: [
    { value: "", label: "Padrão" },
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
  ],
  codex: [
    { value: "", label: "Padrão" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-6-sol", label: "GPT-6 Sol" },
    { value: "gpt-6-luna", label: "GPT-6 Luna" },
  ],
  antigravity: [
    { value: "", label: "Padrão" },
    { value: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
    { value: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
    { value: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-6-thinking", label: "Claude Opus 4.6" },
    { value: "gpt-oss-120b-medium", label: "GPT-OSS 120B" },
  ],
};
const SUMMARY_REQUEST =
  "Escreva um resumo para continuar esta tarefa em uma conversa nova: objetivo, o que já foi feito, decisões tomadas, arquivos alterados e próximos passos. Responda só com o resumo, em português.";
const RESULT_LIMIT = 600;
const MESSAGES_PAGE = 200;
const MAX_ATTACHMENTS = 8;
const COMPOSER_MIN_HEIGHT = 24;
const COMPOSER_MAX_HEIGHT = 176;
const isImageFile = (file: File) => file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
function foldSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
function eventSearchText(event: ChatEvent): string {
  switch (event.type) {
    case "user":
      return event.text;
    case "assistant":
      return event.blocks
        .map((b) => (b.kind === "text" || b.kind === "thinking" ? b.text : `${b.name} ${b.summary}`))
        .join("\n");
    case "tool_result":
      return event.text;
    case "approval":
      return [
        event.toolName,
        event.summary,
        ...(event.questions?.flatMap((q) => [q.header, q.question, ...q.options.map((o) => o.label)]) ?? []),
      ].join("\n");
    case "status":
      return event.message ?? "";
    case "agent_changed":
      return `${event.from} ${event.to} ${event.handoff ?? ""}`;
    default:
      return "";
  }
}
// Preview das imagens: o main confere o caminho e devolve um data URL; aqui só fica o cache.
const previews = new Map<string, string>();
function useImage(path: string) {
  const [src, setSrc] = useState(() => previews.get(path) ?? "");
  useEffect(() => {
    const known = previews.get(path);
    if (known) {
      setSrc(known);
      return;
    }
    let alive = true;
    request<string>({ action: "chatImage", path })
      .then((url) => {
        previews.set(path, url);
        if (alive) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);
  return src;
}
function Thumb({ path, onOpen, onRemove }: { path: string; onOpen: (src: string) => void; onRemove?: () => void }) {
  const src = useImage(path);
  return (
    <div className="chat-thumb">
      {src ? (
        <img src={src} alt="Imagem anexada" onClick={() => onOpen(src)} />
      ) : (
        <span className="chat-thumb-loading" aria-label="Carregando imagem" />
      )}
      {onRemove && (
        <button type="button" aria-label="Remover imagem" title="Remover imagem" onClick={onRemove}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}
// Junta eventos pela posição no histórico: o que chega ao vivo e o que foi carregado não se repetem.
function merge(current: ChatHistoryItem[], incoming: ChatHistoryItem[]): ChatHistoryItem[] {
  const bySeq = new Map(current.map((item) => [item.seq, item]));
  for (const item of incoming) bySeq.set(item.seq, item);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
// Bloco de código das respostas: nome da linguagem e botão de copiar.
function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = React.Children.only(children) as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
  const language = /language-([\w+-]+)/.exec(child.props?.className ?? "")?.[1] ?? "texto";
  const text = String(child.props?.children ?? "").replace(/\n$/, "");
  function copy() {
    void window.golfinho.request({ action: "writeClipboard", text }).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }
  return (
    <div className="chat-code">
      <div className="chat-code-head">
        <span>{language}</span>
        <button type="button" onClick={copy}>
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}
// Arquivos citados nas respostas abrem um preview; o contexto evita passar a função bloco a bloco.
const OpenFile = createContext<(path: string) => void>(() => undefined);
function FileLink({ path, children }: { path: string; children: React.ReactNode }) {
  const open = React.useContext(OpenFile);
  return (
    <code
      className="chat-file-link"
      role="button"
      tabIndex={0}
      title={`Abrir ${path}`}
      onClick={(e) => {
        // Dentro do <summary> de um resultado, o clique não deve abrir/fechar o bloco.
        e.preventDefault();
        e.stopPropagation();
        open(path);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        open(path);
      }}
    >
      {children}
    </code>
  );
}
// Código inline que é só um caminho de arquivo vira link; o resto fica como está.
function InlineCode({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const text = typeof children === "string" ? children : null;
  const path = text && !className ? asFilePath(text) : null;
  if (path) return <FileLink path={path}>{children}</FileLink>;
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}
// Linha de resultado de ferramenta com o caminho absoluto clicável.
function ResultLine({ line }: { line: string }) {
  const found = absolutePathIn(line);
  if (!found) return <>{line}</>;
  return (
    <>
      {found.before}
      <FileLink path={found.path}>{found.path}</FileLink>
      {found.after}
    </>
  );
}
// Guarda a resposta como nota da memória do projeto, com a tarefa como origem.
function SaveToMemory({ taskId, blocks, onError }: { taskId: string; blocks: ChatBlock[]; onError: (e: unknown) => void }) {
  const [saved, setSaved] = useState(false);
  const text = blocks
    .flatMap((block) => (block.kind === "text" ? [block.text.trim()] : []))
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;
  return (
    <button
      type="button"
      className="chat-remember"
      title="Salvar esta resposta na memória do projeto"
      disabled={saved}
      onClick={() =>
        void request({ action: "memoryFromChat", taskId, text }).then(() => setSaved(true), onError)
      }
    >
      <Brain size={12} /> {saved ? "Salvo na memória" : "Salvar na memória"}
    </button>
  );
}
type ToolResult = Extract<ChatEvent, { type: "tool_result" }>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
// Diff simples do Edit: linhas removidas e depois as adicionadas, como no Claude Code.
function EditDiff({ edits }: { edits: { old_string?: unknown; new_string?: unknown }[] }) {
  return (
    <pre className="chat-diff">
      {edits.map((edit, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="chat-diff-gap">⋯{"\n"}</span>}
          {str(edit.old_string) &&
            str(edit.old_string).split("\n").map((line, j) => (
              <span key={`o${j}`} className="chat-diff-del">- {line}{"\n"}</span>
            ))}
          {str(edit.new_string).split("\n").map((line, j) => (
            <span key={`n${j}`} className="chat-diff-add">+ {line}{"\n"}</span>
          ))}
        </React.Fragment>
      ))}
    </pre>
  );
}
const TODO_MARK: Record<string, string> = { completed: "☑", in_progress: "◐", pending: "☐" };
// Corpo do cartão conforme a ferramenta; null quando a entrada não acrescenta nada ao resumo.
function toolBody(name: string, input: Record<string, unknown>): React.ReactNode {
  if (name === "Edit" && "new_string" in input) return <EditDiff edits={[input]} />;
  if (name === "edit_file" && ("Replacement" in input || "Target" in input))
    return <EditDiff edits={[{ old_string: input.Target, new_string: input.Replacement }]} />;
  if (name === "MultiEdit" && Array.isArray(input.edits)) return <EditDiff edits={input.edits as Record<string, unknown>[]} />;
  if (name === "Write" && typeof input.content === "string")
    return <pre className="chat-diff">{input.content.split("\n").map((line, i) => <span key={i} className="chat-diff-add">+ {line}{"\n"}</span>)}</pre>;
  if (name === "write_file" && typeof input.Content === "string")
    return <pre className="chat-diff">{input.Content.split("\n").map((line, i) => <span key={i} className="chat-diff-add">+ {line}{"\n"}</span>)}</pre>;
  if (name === "Bash" && typeof input.description === "string") return <p className="chat-tool-note">{input.description}</p>;
  if (name === "TodoWrite" && Array.isArray(input.todos))
    return (
      <ul className="chat-todos">
        {(input.todos as { content?: unknown; status?: unknown }[]).map((todo, i) => (
          <li key={i} className={`chat-todo ${str(todo.status)}`}>
            <span aria-hidden="true">{TODO_MARK[str(todo.status)] ?? "☐"}</span> {str(todo.content)}
          </li>
        ))}
      </ul>
    );
  return null;
}
function ToolResultBody({ result }: { result: ToolResult }) {
  const text = result.text.length > RESULT_LIMIT ? `${result.text.slice(0, RESULT_LIMIT)}…` : result.text;
  return <pre className={result.isError ? "chat-result error" : "chat-result"}>{text || "(sem saída)"}</pre>;
}
// Cartão da ferramenta: nome e resumo; ao abrir, a entrada (diff, comando, lista) e o resultado.
function ToolCard({ block, result }: { block: Extract<ChatBlock, { kind: "tool" }>; result?: ToolResult }) {
  const body = block.input ? toolBody(block.name, block.input) : null;
  const path = asFilePath(block.summary);
  const mark = !result ? "…" : result.isError ? "✗" : "✓";
  const todos = block.name === "TodoWrite";
  return (
    <details className={`chat-tool-card${result?.isError ? " error" : ""}`} open={todos || undefined}>
      <summary className="chat-tool">
        <span className="chat-tool-icon" aria-hidden="true">{block.id ? mark : "⚙"}</span>
        <span className="chat-tool-name">{block.name}</span>
        {todos ? null : path ? <FileLink path={path}>{block.summary}</FileLink> : <code>{block.summary}</code>}
      </summary>
      {body}
      {result && !todos && <ToolResultBody result={result} />}
    </details>
  );
}
function Thinking({ text, live }: { text: string; live?: boolean }) {
  return (
    <details className="chat-thinking" open={live || undefined}>
      <summary>{live ? "Pensando…" : "Raciocínio"}</summary>
      <div className="chat-thinking-text">{text}</div>
    </details>
  );
}
function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-text">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock, code: InlineCode }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
const Blocks = memo(function Blocks({ blocks, results }: { blocks: ChatBlock[]; results?: Map<string, ToolResult> }) {
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          <Markdown key={index} text={block.text} />
        ) : block.kind === "thinking" ? (
          <Thinking key={index} text={block.text} />
        ) : block.name === "AskUserQuestion" ? null : (
          // A pergunta aparece no cartão de opções; o cartão da ferramenta repetiria tudo.
          <ToolCard key={index} block={block} result={block.id ? results?.get(block.id) : undefined} />
        ),
      )}
    </>
  );
});
export function ChatPane({ taskId, provider, model, permissionMode, effort, draft, onDraftChange, onError, approvalTarget, jumpTarget, onOpenConversation, active = true, locked, onOpenFile }: ChatPaneProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [items, setItems] = useState<ChatHistoryItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<"current" | "all">("current");
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [allHits, setAllHits] = useState<ChatSearchHit[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [allActive, setAllActive] = useState(0);
  const [pinnedSeq, setPinnedSeq] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const openChatSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);
  const closeChatSearch = useCallback(() => {
    setSearchOpen(false);
    setPinnedSeq(null);
    composerRef.current?.focus();
  }, []);
  // Modelos informados pela CLI (com versão); enquanto não chegam, ou se falhar, fica a lista fixa.
  const [cliModels, setCliModels] = useState<ChatModelOption[] | null>(null);
  useEffect(() => {
    let alive = true;
    setCliModels(null);
    if (provider !== "claude") return;
    request<ChatModelOption[]>({ action: "chatModels", taskId })
      .then((list) => {
        if (alive && list?.length) setCliModels(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [taskId, provider]);
  // Comandos de barra do Claude (/usage, /compact, skills…), para o menu que abre ao digitar "/".
  const [commands, setCommands] = useState<ChatCommandOption[]>([]);
  useEffect(() => {
    let alive = true;
    setCommands([]);
    if (provider !== "claude") return;
    request<ChatCommandOption[]>({ action: "chatCommands", taskId })
      .then((list) => {
        if (alive && list?.length) setCommands(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [taskId, provider]);
  const [commandIndex, setCommandIndex] = useState(0);
  // Esc fecha o menu até o texto mudar.
  const [commandsDismissed, setCommandsDismissed] = useState<string | null>(null);
  const commandMatches = commandsDismissed === draft ? null : matchCommands(commands, draft);
  const commandMenu = commandMatches && commandMatches.length > 0 ? commandMatches : null;
  useEffect(() => setCommandIndex(0), [draft]);
  const baseModels: ChatModelOption[] = cliModels ?? MODELS[provider] ?? MODELS.claude;
  // O modelo salvo na tarefa sempre aparece, mesmo que a lista não o tenha.
  const modelOptions = model && !baseModels.some((m) => m.value === model) ? [...baseModels, { value: model, label: model }] : baseModels;
  // Resposta chegando token a token; some quando a mensagem completa é guardada.
  const [live, setLive] = useState<{ text: string; thinking: string } | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  // Último uso de contexto do agente atual (o chat guarda esses eventos no histórico).
  const context = currentContext(items.map((i) => i.event));
  // Nova conversa com resumo: a CLI atual escreve o resumo; quando ela termina, a conversa é
  // reaberta com esse resumo como primeira mensagem. O histórico visível continua.
  const runningNow = [...items].reverse().map((i) => i.event).find((e) => e.type === "status");
  const isRunning = runningNow?.type === "status" && runningNow.state === "running";
  const pct = context?.limit ? Math.round((context.used / context.limit) * 100) : null;
  const [handoff, setHandoff] = useState(false);
  const askedAt = useRef(0);
  const finishing = useRef(false);
  function startHandoff() {
    askedAt.current = items.length;
    finishing.current = false;
    setHandoff(true);
    request({ action: "chatSend", taskId, text: SUMMARY_REQUEST }).catch((e) => {
      setHandoff(false);
      onError(e);
    });
  }
  useEffect(() => {
    if (!handoff || finishing.current) return;
    const after = items.slice(askedAt.current).map((i) => i.event);
    const last = [...after].reverse().find((e) => e.type === "status");
    if (!last || last.type !== "status" || last.state === "running") return;
    finishing.current = true;
    setHandoff(false);
    if (last.state === "error") return onError(new Error("Não foi possível gerar o resumo."));
    const summary = after
      .filter((e) => e.type === "assistant")
      .flatMap((e) => (e.type === "assistant" ? e.blocks : []))
      .filter((b) => b.kind === "text")
      .map((b) => (b.kind === "text" ? b.text : ""))
      .join("\n")
      .trim();
    if (!summary) return onError(new Error("O agente não devolveu um resumo."));
    void (async () => {
      try {
        await request({ action: "chatReset", taskId });
        await request({ action: "chatSend", taskId, text: `Resumo da conversa anterior, para continuar:\n\n${summary}` });
      } catch (e) {
        onError(e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, handoff]);
  const bottom = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    const height = Math.min(Math.max(composer.scrollHeight, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT);
    composer.style.height = `${height}px`;
    composer.style.overflowY = composer.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }, [draft]);
  function onLogScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  }
  useEffect(() => {
    let active = true;
    setItems([]);
    setLive(null);
    setAttachments([]);
    const unsubscribe = window.golfinho.subscribe((signal) => {
      if (!active || signal.kind !== "chat" || signal.taskId !== taskId) return;
      const event = signal.event;
      if (event.type === "delta") {
        setLive((current) => {
          const next = current ?? { text: "", thinking: "" };
          return event.kind === "text" ? { ...next, text: next.text + event.text } : { ...next, thinking: next.thinking + event.text };
        });
        return;
      }
      if (event.type === "assistant" || event.type === "status" || event.type === "tool_result") setLive(null);
      setItems((current) => merge(current, [{ seq: signal.seq, event }]));
    });
    request<ChatHistoryItem[]>({ action: "chatHistory", taskId })
      .then((history) => {
        if (active) setItems((current) => merge(current, history));
      })
      .catch((e) => {
        if (active) onError(e);
      });
    return () => {
      active = false;
      unsubscribe();
    };
    // onError muda a cada render do app; o histórico só é recarregado ao trocar de tarefa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  useEffect(() => {
    if (!viewer) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [viewer]);
  const events = useMemo(() => items.map((item) => item.event), [items]);
  const lastStatus = [...events].reverse().find((e): e is Extract<ChatEvent, { type: "status" }> => e.type === "status");
  const busy = lastStatus?.state === "running";
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, busy]);
  // Resultado de cada ferramenta pelo id: aparece dentro do cartão dela, não solto na conversa.
  const results = useMemo(() => {
    const map = new Map<string, ToolResult>();
    for (const event of events) if (event.type === "tool_result" && event.toolUseId) map.set(event.toolUseId, event);
    return map;
  }, [events]);
  const toolIds = useMemo(() => {
    const ids = new Set<string>();
    for (const event of events)
      if (event.type === "assistant") for (const b of event.blocks) if (b.kind === "tool" && b.id) ids.add(b.id);
    return ids;
  }, [events]);
  // Mapeia toolUseId → seq da mensagem do assistente para que buscas em resultados embutidos rolem até o cartão.
  const toolOwnerSeq = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items)
      if (item.event.type === "assistant")
        for (const b of item.event.blocks) if (b.kind === "tool" && b.id) map.set(b.id, item.seq);
    return map;
  }, [items]);
  const resolveDisplaySeq = useCallback(
    (seq: number) => {
      const found = items.find((item) => item.seq === seq);
      if (found?.event.type === "tool_result" && found.event.toolUseId)
        return toolOwnerSeq.get(found.event.toolUseId) ?? seq;
      return seq;
    },
    [items, toolOwnerSeq],
  );
  // Atalho global Ctrl+F / Cmd+F quando este chat está ativo (não rouba foco de terminal nem editor).
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isFindShortcut(e)) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(".xterm, .monaco-editor, .shell-pane, .terminal-pane")) return;
      e.preventDefault();
      openChatSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, openChatSearch]);
  const normalizedQuery = useMemo(() => foldSearch(searchQuery.trim()), [searchQuery]);
  const currentMatches = useMemo(() => {
    if (!searchOpen || searchScope !== "current" || !normalizedQuery) return [];
    const seen = new Set<number>();
    const list: number[] = [];
    for (const item of items) {
      const text = eventSearchText(item.event);
      if (!text || !foldSearch(text).includes(normalizedQuery)) continue;
      const displaySeq =
        item.event.type === "tool_result" && item.event.toolUseId
          ? (toolOwnerSeq.get(item.event.toolUseId) ?? item.seq)
          : item.seq;
      if (!seen.has(displaySeq)) {
        seen.add(displaySeq);
        list.push(displaySeq);
      }
    }
    return list;
  }, [items, searchOpen, searchScope, normalizedQuery, toolOwnerSeq]);
  const matchSet = useMemo(() => new Set(currentMatches), [currentMatches]);
  useEffect(() => {
    setMatchIndex(0);
  }, [normalizedQuery, taskId, searchScope]);
  const activeMatchSeq =
    searchOpen && searchScope === "current" && currentMatches.length > 0
      ? currentMatches[Math.min(matchIndex, currentMatches.length - 1)]
      : pinnedSeq;
  // Busca em todas as conversas do Golfinho (com pequeno debounce).
  useEffect(() => {
    if (!searchOpen || searchScope !== "all") return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setAllHits([]);
      setAllLoading(false);
      return;
    }
    let alive = true;
    setAllLoading(true);
    const timer = setTimeout(() => {
      request<ChatSearchHit[]>({ action: "chatSearch", query: trimmed, taskId })
        .then((hits) => {
          if (alive) {
            setAllHits(Array.isArray(hits) ? hits : []);
            setAllActive(0);
          }
        })
        .catch(() => {
          if (alive) setAllHits([]);
        })
        .finally(() => {
          if (alive) setAllLoading(false);
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searchOpen, searchScope, searchQuery, taskId]);
  const resolved = useMemo(() => {
    const map = new Map<string, { behavior: "allow" | "deny"; answers?: Record<string, string> }>();
    for (const event of events)
      if (event.type === "approval_resolved") map.set(event.id, { behavior: event.behavior, answers: event.answers });
    return map;
  }, [events]);
  function addAttachments(paths: string[]) {
    setAttachments((current) => {
      const next = [...current, ...paths.filter((p) => !current.includes(p))];
      if (next.length > MAX_ATTACHMENTS) onError(new Error(`Limite de ${MAX_ATTACHMENTS} imagens por mensagem.`));
      return next.slice(0, MAX_ATTACHMENTS);
    });
  }
  function attach() {
    request<string[]>({ action: "chatPickImages" }).then(addAttachments).catch(onError);
  }
  // O macOS pode representar uma imagem colada como arquivo (Files) em vez de image/*.
  function paste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const hasImage = [...e.clipboardData.items].some((item) => item.type.startsWith("image/")) ||
      [...e.clipboardData.files].some(isImageFile);
    if (!hasImage) return;
    e.preventDefault();
    request<string | null>({ action: "pasteImage" })
      .then((path) => {
        if (path) addAttachments([path]);
      })
      .catch(onError);
  }
  function dragOver(e: React.DragEvent<HTMLDivElement>) {
    if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
  }
  function dropFiles(e: React.DragEvent<HTMLDivElement>) {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter(isImageFile);
    if (!files.length) return;
    try {
      const paths = files.slice(0, MAX_ATTACHMENTS).map((file) => window.golfinho.getPathForFile(file)).filter(Boolean);
      if (!paths.length) throw new Error("Não foi possível ler os arquivos arrastados.");
      request<string[]>({ action: "chatImportImages", paths }).then(addAttachments).catch(onError);
    } catch (error) { onError(error); }
  }
  async function send(override?: string) {
    const text = (override ?? draft).trim();
    if (!text && !attachments.length) return;
    const images = attachments;
    onDraftChange("");
    setAttachments([]);
    try {
      await request({ action: "chatSend", taskId, text, ...(images.length ? { images } : {}) });
    } catch (e) {
      onError(e);
      setAttachments(images);
    }
  }
  // Comando sem argumentos roda na hora; com argumentos, entra no campo para completar.
  function pickCommand(command: ChatCommandOption, run: boolean) {
    if (run && !command.hint) void send(`/${command.name}`);
    else onDraftChange(`/${command.name} `);
  }
  function interrupt() {
    request({ action: "chatInterrupt", taskId }).catch(onError);
  }
  const decide = useCallback(
    (id: string, behavior: "allow" | "deny", always = false) => {
      request({ action: "chatDecide", taskId, id, behavior, always }).catch(onError);
    },
    [taskId, onError],
  );
  // Últimas mensagens; as anteriores entram com "Carregar anteriores". A lista é memorizada:
  // digitar no campo não refaz as mensagens.
  const [shown, setShown] = useState(MESSAGES_PAGE);
  useEffect(() => {
    setShown(MESSAGES_PAGE);
    setPinnedSeq(null);
  }, [taskId]);
  const shownItems = items.length > shown ? items.slice(items.length - shown) : items;
  const revealedJump = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!jumpTarget) return;
    const key = `${jumpTarget.seq}:${jumpTarget.version}`;
    if (revealedJump.current === key) return;
    const targetSeq = resolveDisplaySeq(jumpTarget.seq);
    const index = items.findIndex((item) => item.seq === targetSeq);
    if (index < 0) return;
    if (index < items.length - shown) {
      setShown(items.length - index);
      return;
    }
    setPinnedSeq(targetSeq);
    const el = logRef.current?.querySelector<HTMLElement>(`[data-seq="${targetSeq}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      revealedJump.current = key;
    }
  }, [items, shown, jumpTarget, resolveDisplaySeq]);
  useEffect(() => {
    if (activeMatchSeq == null) return;
    const index = items.findIndex((item) => item.seq === activeMatchSeq);
    if (index < 0) return;
    if (index < items.length - shown) {
      setShown(items.length - index);
      return;
    }
    const el = logRef.current?.querySelector<HTMLElement>(`[data-seq="${activeMatchSeq}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [activeMatchSeq, items, shown]);
  function openHit(hit: ChatSearchHit) {
    if (hit.taskId === taskId) {
      const displaySeq = resolveDisplaySeq(hit.seq);
      setPinnedSeq(displaySeq);
      setSearchScope("current");
      return;
    }
    if (onOpenConversation) {
      setSearchOpen(false);
      onOpenConversation(hit.taskId, hit.seq);
    }
  }
  const revealedApproval = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!approvalTarget) return;
    const key = `${approvalTarget.id}:${approvalTarget.version}`;
    if (revealedApproval.current === key) return;
    const index = items.findIndex(({ event }) => event.type === "approval" && event.id === approvalTarget.id);
    if (index < 0) return;
    if (index < items.length - shown) { setShown(items.length - index); return; }
    const card = [...(logRef.current?.querySelectorAll<HTMLElement>(".chat-approval, .chat-approval-question") ?? [])]
      .find((element) => element.dataset.approvalId === approvalTarget.id);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.querySelector<HTMLButtonElement>("button")?.focus();
    revealedApproval.current = key;
  }, [items, shown, approvalTarget]);
  const messages = useMemo(
    () =>
      shownItems.map(({ seq, event }, i) => {
          const matchClass =
            activeMatchSeq === seq ? " chat-match chat-match-active" : matchSet.has(seq) ? " chat-match" : "";
          if (event.type === "user")
            return (
              <div key={seq} data-seq={seq} className={`chat-user${matchClass}`}>
                {event.images?.length ? (
                  <div className="chat-thumbs">
                    {event.images.map((path) => (
                      <Thumb key={path} path={path} onOpen={setViewer} />
                    ))}
                  </div>
                ) : null}
                {event.text && <div>{event.text}</div>}
              </div>
            );
          if (event.type === "assistant")
            return (
              <div
                key={seq}
                data-seq={seq}
                className={`chat-assistant${matchClass}`}
                data-agent={shownItems[i - 1]?.event.type === "user" ? (LABELS[provider] ?? provider) : undefined}
              >
                <Blocks blocks={event.blocks} results={results} />
                {/* "Salvar na memória" só no fim da resposta, não entre uma ferramenta e outra. */}
                {!["assistant", "tool_result", "approval", "approval_resolved"].includes(shownItems[i + 1]?.event.type ?? "") && (
                  <SaveToMemory taskId={taskId} blocks={event.blocks} onError={onError} />
                )}
              </div>
            );
          if (event.type === "tool_result" && event.toolUseId && toolIds.has(event.toolUseId)) return null;
          if (event.type === "tool_result") {
            // Uma linha resumida; o conteúdo completo abre só ao clicar.
            const text = event.text.length > RESULT_LIMIT ? `${event.text.slice(0, RESULT_LIMIT)}…` : event.text;
            const summary = (event.text.split("\n")[0] ?? "").slice(0, 140) || "sem saída";
            return (
              <details key={seq} data-seq={seq} className={`${event.isError ? "chat-result-block error" : "chat-result-block"}${matchClass}`}>
                <summary>
                  <span className="chat-result-mark">{event.isError ? "✗" : "✓"}</span> <ResultLine line={summary} />
                  {event.text.includes("\n") && (
                    <em className="chat-result-lines">{event.text.split("\n").length} linhas</em>
                  )}
                </summary>
                <pre className="chat-result">{text || "(sem saída)"}</pre>
              </details>
            );
          }
          if (event.type === "approval" && event.questions) {
            const outcome = resolved.get(event.id);
            return (
              <div key={seq} data-seq={seq} className={`chat-approval-question${matchClass}`} data-approval-id={event.id}>
                <QuestionCard
                  questions={event.questions}
                  answered={outcome ? (outcome.answers ?? null) : undefined}
                  onAnswer={(answers) => request({ action: "chatAnswer", taskId, id: event.id, answers }).catch(onError)}
                  onSkip={() => decide(event.id, "deny")}
                />
              </div>
            );
          }
          if (event.type === "approval") {
            const outcome = resolved.get(event.id)?.behavior;
            return (
              <div key={seq} data-seq={seq} className={`chat-approval${matchClass}`} data-approval-id={event.id}>
                <div className="chat-approval-title">Permitir {event.toolName}?</div>
                <code>{event.summary}</code>
                {outcome ? (
                  <span className="chat-approval-outcome">{outcome === "allow" ? "Permitido" : "Negado"}</span>
                ) : (
                  <div className="chat-approval-actions">
                    <button onClick={() => decide(event.id, "allow")}>Permitir</button>
                    {event.canAlwaysAllow && (
                      <button onClick={() => decide(event.id, "allow", true)}>Sempre permitir</button>
                    )}
                    <button className="secondary" onClick={() => decide(event.id, "deny")}>
                      Negar
                    </button>
                  </div>
                )}
              </div>
            );
          }
          if (event.type === "status" && event.state === "idle" && event.message)
            return (
              <p key={seq} data-seq={seq} className={`chat-note${matchClass}`}>
                {event.message}
              </p>
            );
          if (event.type === "agent_changed")
            return (
              <div key={seq} data-seq={seq} className={matchClass.trim() || undefined}>
                <div className="chat-divider" role="separator">
                  <span>
                    Agente trocado de {event.from} para {event.to}. A conversa anterior não é retomada.
                  </span>
                </div>
                {event.handoff && (
                  <details className="chat-handoff-details">
                    <summary>Contexto passado a {event.to}</summary>
                    <pre>{event.handoff}</pre>
                  </details>
                )}
              </div>
            );
          if (event.type === "status" && event.state === "error")
            return (
              <p key={seq} data-seq={seq} className={`chat-error${matchClass}`}>
                {event.message ?? "Algo deu errado."}
              </p>
            );
          return null;
      }),
    [shownItems, resolved, results, toolIds, provider, decide, activeMatchSeq, matchSet],
  );
  return (
    <OpenFile.Provider value={setPreview}>
    <div
      className={`chat-pane chat-${provider}`}
      onDragOver={dragOver}
      onDrop={dropFiles}
      onKeyDown={(e) => {
        if (isFindShortcut(e.nativeEvent)) {
          e.preventDefault();
          e.stopPropagation();
          openChatSearch();
        }
      }}
    >
      <div className="chat-search-chrome">
        <button
          type="button"
          className="chat-search-toggle"
          title={`Buscar no chat (${findShortcutLabel()})`}
          aria-label="Buscar no chat"
          aria-pressed={searchOpen}
          onClick={() => (searchOpen ? closeChatSearch() : openChatSearch())}
        >
          <Search size={13} />
        </button>
      </div>
      {searchOpen && (
        <div className="chat-search" role="search" aria-label="Buscar no chat">
          <div className="chat-search-row">
            <Search size={13} className="chat-search-icon" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="Buscar mensagens"
              placeholder={searchScope === "current" ? "Buscar nesta conversa…" : "Buscar em todas as conversas…"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeChatSearch();
                  return;
                }
                if (searchScope === "current" && e.key === "Enter" && currentMatches.length > 0) {
                  e.preventDefault();
                  const step = e.shiftKey ? -1 : 1;
                  setMatchIndex((i) => (i + step + currentMatches.length) % currentMatches.length);
                  return;
                }
                if (searchScope === "all" && allHits.length > 0) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const step = e.key === "ArrowDown" ? 1 : -1;
                    setAllActive((i) => (i + step + allHits.length) % allHits.length);
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    openHit(allHits[Math.min(allActive, allHits.length - 1)]);
                  }
                }
              }}
            />
            <div className="chat-search-scopes" role="tablist" aria-label="Escopo da busca">
              <button
                type="button"
                role="tab"
                aria-selected={searchScope === "current"}
                className={searchScope === "current" ? "active" : undefined}
                onClick={() => setSearchScope("current")}
              >
                Conversa
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={searchScope === "all"}
                className={searchScope === "all" ? "active" : undefined}
                onClick={() => setSearchScope("all")}
              >
                Todas
              </button>
            </div>
            {searchScope === "current" ? (
              <>
                <span className="chat-search-count" role="status">
                  {currentMatches.length
                    ? `${Math.min(matchIndex, currentMatches.length - 1) + 1} de ${currentMatches.length}`
                    : searchQuery.trim()
                      ? "Nenhum resultado"
                      : ""}
                </span>
                <button
                  type="button"
                  aria-label="Resultado anterior"
                  title="Resultado anterior (Shift+Enter)"
                  disabled={!currentMatches.length}
                  onClick={() => setMatchIndex((i) => (i - 1 + currentMatches.length) % currentMatches.length)}
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  aria-label="Próximo resultado"
                  title="Próximo resultado (Enter)"
                  disabled={!currentMatches.length}
                  onClick={() => setMatchIndex((i) => (i + 1) % currentMatches.length)}
                >
                  <ChevronDown size={13} />
                </button>
              </>
            ) : (
              <span className="chat-search-count" role="status">
                {allLoading
                  ? "Buscando…"
                  : allHits.length
                    ? `${allHits.length} ${allHits.length === 1 ? "resultado" : "resultados"}`
                    : searchQuery.trim()
                      ? "Nenhum resultado"
                      : ""}
              </span>
            )}
            <button type="button" aria-label="Fechar busca do chat" title="Fechar busca (Esc)" onClick={closeChatSearch}>
              <X size={13} />
            </button>
          </div>
          {searchScope === "all" && searchQuery.trim() && (
            <div className="chat-search-results" role="listbox" aria-label="Resultados em todas as conversas">
              {allHits.length === 0 && !allLoading ? (
                <p className="chat-search-empty">Nenhuma conversa encontrada para "{searchQuery.trim()}".</p>
              ) : (
                allHits.map((hit, idx) => (
                  <button
                    key={`${hit.taskId}:${hit.seq}`}
                    type="button"
                    role="option"
                    aria-selected={idx === allActive}
                    className={`chat-search-hit${idx === allActive ? " active" : ""}`}
                    onMouseEnter={() => setAllActive(idx)}
                    onClick={() => openHit(hit)}
                  >
                    <span className="chat-search-hit-head">
                      <strong>{hit.taskTitle}</strong>
                      {hit.taskId === taskId ? (
                        <em className="chat-search-hit-tag">Atual</em>
                      ) : hit.projectName ? (
                        <em className="chat-search-hit-project">{hit.projectName}</em>
                      ) : null}
                      <small>{hit.who}</small>
                    </span>
                    <span className="chat-search-hit-excerpt">{hit.excerpt}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      <div className="chat-log" ref={logRef} onScroll={onLogScroll}>
        {items.length === 0 && (
          <div className="chat-welcome">
            <AgentMark provider={provider} size={38} />
            <h2>{WELCOME_TITLES[provider] ?? "Como posso ajudar?"}</h2>
            <p className="chat-empty">Escreva uma mensagem para começar a conversa nesta tarefa.</p>
          </div>
        )}
        {items.length > shownItems.length && (
          <button type="button" className="chat-more" onClick={() => setShown((n) => n + MESSAGES_PAGE)}>
            Carregar anteriores ({items.length - shownItems.length})
          </button>
        )}
        {messages}
        {live && (
          <div className="chat-assistant chat-live">
            {live.thinking && <Thinking text={live.thinking} live={!live.text} />}
            {live.text && <Markdown text={live.text} />}
          </div>
        )}
        {busy && !live?.text && (
          <p className="chat-busy">
            <AgentMark provider={provider} size={16} busy />
            {LABELS[provider] ?? "O agente"} está pensando
          </p>
        )}
        <div ref={bottom} />
      </div>
      {away && (
        <button
          type="button"
          className="chat-to-end"
          aria-label="Ir para o fim da conversa"
          onClick={() => bottom.current?.scrollIntoView({ block: "end" })}
        >
          ↓
        </button>
      )}
      {locked ? (
        <div className="chat-locked" role="status">
          <Lock size={15} aria-hidden="true" />
          <p>{locked.message}</p>
          <button type="button" className="primary" disabled={locked.busy} onClick={locked.onAction}>
            <Play size={13} /> {locked.actionLabel}
          </button>
        </div>
      ) : (
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {attachments.length > 0 && (
          <div className="chat-thumbs chat-attachments">
            {attachments.map((path) => (
              <Thumb
                key={path}
                path={path}
                onOpen={setViewer}
                onRemove={() => setAttachments((current) => current.filter((p) => p !== path))}
              />
            ))}
          </div>
        )}
        {/* Como no Claude Code: campo de uma linha com o enviar dentro; ações e seletores embaixo, fora da caixa. */}
        <div className="chat-input-box">
          {commandMenu && (
            <CommandMenu
              commands={commandMenu}
              active={Math.min(commandIndex, commandMenu.length - 1)}
              onHover={setCommandIndex}
              onPick={(c) => pickCommand(c, true)}
            />
          )}
          <textarea
            ref={composerRef}
            value={draft}
            placeholder={items.length ? "Responder" : `Mensagem para ${LABELS[provider] ?? "o agente"}`}
            title="Enter envia, Shift+Enter quebra linha"
            rows={1}
            onChange={(e) => onDraftChange(e.target.value)}
            onPaste={paste}
            onKeyDown={(e) => {
              if (commandMenu) {
                const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                if (move) {
                  e.preventDefault();
                  setCommandIndex((i) => (i + move + commandMenu.length) % commandMenu.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  pickCommand(commandMenu[Math.min(commandIndex, commandMenu.length - 1)], e.key === "Enter");
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setCommandsDismissed(draft);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button type="button" className="chat-send chat-stop" aria-label="Parar" title="Interromper o agente" onClick={interrupt}>
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="chat-send" aria-label="Enviar" title="Enviar (Enter)" disabled={!draft.trim() && !attachments.length}>
              <CornerDownLeft size={16} />
            </button>
          )}
        </div>
        <div className="chat-input-row">
          <button
            type="button"
            className="chat-attach"
            aria-label="Anexar imagens"
            title="Anexar imagens (ou cole com ⌘V / Ctrl+V)"
            onClick={attach}
          >
            <Plus size={18} strokeWidth={1.75} />
          </button>
          <div className="chat-tools">
            {context && (
            <div className="chat-context" title={`${context.used.toLocaleString("pt-BR")}${context.limit ? ` / ${context.limit.toLocaleString("pt-BR")}` : ""} tokens (última chamada)`}>
              <span>
                Contexto{context.limit ? ` ${Math.round((context.used / context.limit) * 100)}%` : ""}
              </span>
              {context.limit && (
                <div className="chat-context-bar">
                  <i style={{ width: `${Math.min(100, (context.used / context.limit) * 100)}%` }} />
                </div>
              )}
            </div>
          )}
            {handoff ? (
              <span className="chat-handoff">Pedindo resumo ao agente atual…</span>
            ) : (
              <>
                {pct !== null && pct >= 80 && (
                  <button disabled={isRunning} onClick={startHandoff}>
                    Nova conversa com resumo
                  </button>
                )}
                {pct !== null && pct >= 80 && provider === "codex" && (
                  <button
                    disabled={isRunning}
                    onClick={() => request({ action: "chatCompact", taskId }).catch(onError)}
                  >
                    Compactar
                  </button>
                )}
                <span className="chat-disclaimer">{LABELS[provider] ?? "O agente"} é uma IA e pode cometer erros.</span>
                <ModelMenu
                  models={modelOptions}
                  model={model ?? null}
                  effort={effort ?? null}
                  canChangeModel
                  showEffort={provider === "claude"}
                  onModel={(value) => request({ action: "setChatModel", taskId, model: value }).catch(onError)}
                  onEffort={(value) => request({ action: "setChatEffort", taskId, effort: value }).catch(onError)}
                />
                {provider === "claude" && (
                  <PermissionMenu
                    mode={permissionMode ?? "default"}
                    onMode={(mode) => request({ action: "setChatPermissionMode", taskId, mode }).catch(onError)}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </form>
      )}
      {viewer && (
        <div className="chat-viewer" role="dialog" aria-label="Imagem ampliada" onClick={() => setViewer(null)}>
          <img src={viewer} alt="Imagem ampliada" />
        </div>
      )}
      {preview && (
        <FilePreview
          taskId={taskId}
          path={preview}
          onClose={() => setPreview(null)}
          onOpenInFiles={
            onOpenFile &&
            ((path) => {
              setPreview(null);
              onOpenFile(path);
            })
          }
        />
      )}
    </div>
    </OpenFile.Provider>
  );
}
