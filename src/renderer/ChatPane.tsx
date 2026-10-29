import React, { createContext, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brain, Lock, Paperclip, Play, X } from "lucide-react";
import type { ChatBlock, ChatEvent, ChatHistoryItem, Provider, Request } from "../shared/contracts";
import { currentContext } from "../shared/chatContext";
import { absolutePathIn, asFilePath } from "./filePaths";
import { FilePreview } from "./FilePreview";
export interface ChatPaneProps {
  taskId: string;
  provider: string;
  model?: string | null;
  draft: string;
  onDraftChange: (draft: string) => void;
  onError: (e: unknown) => void;
  approvalTarget?: { id: string; version: number };
  /** Chat bloqueado enquanto a sessão da tarefa não é retomada: aviso e ação no lugar do campo. */
  locked?: { message: string; actionLabel: string; onAction: () => void; busy?: boolean } | null;
  /** Abre o arquivo no editor da aba Arquivos. */
  onOpenFile?: (path: string) => void;
}
// Cada provedor tem a sua cor de destaque, para não parecer a conversa de outro.
const LABELS: Record<string, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" };
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
const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 176;
const isImageFile = (file: File) => file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name);
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
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
const Blocks = memo(function Blocks({ blocks }: { blocks: ChatBlock[] }) {
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          <div key={index} className="chat-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock, code: InlineCode }}>
              {block.text}
            </ReactMarkdown>
          </div>
        ) : (
          <div key={index} className="chat-tool">
            <span className="chat-tool-icon" aria-hidden="true">⚙</span>
            <span className="chat-tool-name">{block.name}</span>
            {asFilePath(block.summary) ? (
              <FileLink path={asFilePath(block.summary)!}>{block.summary}</FileLink>
            ) : (
              <code>{block.summary}</code>
            )}
          </div>
        ),
      )}
    </>
  );
});
export function ChatPane({ taskId, provider, model, draft, onDraftChange, onError, approvalTarget, locked, onOpenFile }: ChatPaneProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [items, setItems] = useState<ChatHistoryItem[]>([]);
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
    setAttachments([]);
    const unsubscribe = window.golfinho.subscribe((signal) => {
      if (!active || signal.kind !== "chat" || signal.taskId !== taskId) return;
      setItems((current) => merge(current, [{ seq: signal.seq, event: signal.event }]));
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
  const resolved = useMemo(() => {
    const map = new Map<string, "allow" | "deny">();
    for (const event of events)
      if (event.type === "approval_resolved") map.set(event.id, event.behavior);
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
  async function send() {
    const text = draft.trim();
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
  useEffect(() => setShown(MESSAGES_PAGE), [taskId]);
  const shownItems = items.length > shown ? items.slice(items.length - shown) : items;
  const revealedApproval = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!approvalTarget) return;
    const key = `${approvalTarget.id}:${approvalTarget.version}`;
    if (revealedApproval.current === key) return;
    const index = items.findIndex(({ event }) => event.type === "approval" && event.id === approvalTarget.id);
    if (index < 0) return;
    if (index < items.length - shown) { setShown(items.length - index); return; }
    const card = [...(logRef.current?.querySelectorAll<HTMLElement>(".chat-approval") ?? [])]
      .find((element) => element.dataset.approvalId === approvalTarget.id);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.querySelector<HTMLButtonElement>("button")?.focus();
    revealedApproval.current = key;
  }, [items, shown, approvalTarget]);
  const messages = useMemo(
    () =>
      shownItems.map(({ seq, event }, i) => {
          if (event.type === "user")
            return (
              <div key={seq} className="chat-user">
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
                className="chat-assistant"
                data-agent={shownItems[i - 1]?.event.type === "user" ? (LABELS[provider] ?? provider) : undefined}
              >
                <Blocks blocks={event.blocks} />
                <SaveToMemory taskId={taskId} blocks={event.blocks} onError={onError} />
              </div>
            );
          if (event.type === "tool_result") {
            // Uma linha resumida; o conteúdo completo abre só ao clicar.
            const text = event.text.length > RESULT_LIMIT ? `${event.text.slice(0, RESULT_LIMIT)}…` : event.text;
            const summary = (event.text.split("\n")[0] ?? "").slice(0, 140) || "sem saída";
            return (
              <details key={seq} className={event.isError ? "chat-result-block error" : "chat-result-block"}>
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
          if (event.type === "approval") {
            const outcome = resolved.get(event.id);
            return (
              <div key={seq} className="chat-approval" data-approval-id={event.id}>
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
              <p key={seq} className="chat-note">
                {event.message}
              </p>
            );
          if (event.type === "agent_changed")
            return (
              <div key={seq}>
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
              <p key={seq} className="chat-error">
                {event.message ?? "Algo deu errado."}
              </p>
            );
          return null;
      }),
    [shownItems, resolved, provider, decide],
  );
  return (
    <OpenFile.Provider value={setPreview}>
    <div className={`chat-pane chat-${provider}`} onDragOver={dragOver} onDrop={dropFiles}>
      <div className="chat-log" ref={logRef} onScroll={onLogScroll}>
        {items.length === 0 && (
          <p className="chat-empty">Escreva uma mensagem para começar a conversa nesta tarefa.</p>
        )}
        {items.length > shownItems.length && (
          <button type="button" className="chat-more" onClick={() => setShown((n) => n + MESSAGES_PAGE)}>
            Carregar anteriores ({items.length - shownItems.length})
          </button>
        )}
        {messages}
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
        {busy && (
          <p className="chat-busy">
            <span className="chat-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {LABELS[provider] ?? "O agente"} está pensando
          </p>
        )}
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
              <label className="chat-model">
                Modelo
                <select
                  aria-label="Modelo do chat"
                  value={model ?? ""}
                  disabled={isRunning}
                  onChange={(e) =>
                    request({ action: "setChatModel", taskId, model: e.target.value || null }).catch(onError)
                  }
                >
                  {(MODELS[provider] ?? MODELS.claude).map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
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
            <Paperclip size={16} />
          </button>
          <textarea
            ref={composerRef}
            value={draft}
            placeholder={`Mensagem para ${LABELS[provider] ?? "o agente"} (Enter envia, Shift+Enter quebra linha)`}
            rows={2}
            onChange={(e) => onDraftChange(e.target.value)}
            onPaste={paste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {busy ? (
            <button type="button" className="chat-stop" title="Interromper o agente" onClick={interrupt}>
              Parar
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim() && !attachments.length}>
              Enviar
            </button>
          )}
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
