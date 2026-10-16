import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Paperclip, X } from "lucide-react";
import type { ChatBlock, ChatEvent, ChatHistoryItem, Request } from "../shared/contracts";
export interface ChatPaneProps {
  taskId: string;
  provider: string;
  onError: (e: unknown) => void;
}
// Cada provedor tem a sua cor de destaque, para não parecer a conversa de outro.
const LABELS: Record<string, string> = { claude: "Claude", codex: "Codex" };
const RESULT_LIMIT = 600;
const MAX_ATTACHMENTS = 8;
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
function Blocks({ blocks }: { blocks: ChatBlock[] }) {
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          <div key={index} className="chat-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
          </div>
        ) : (
          <div key={index} className="chat-tool">
            <span className="chat-tool-name">{block.name}</span>
            <code>{block.summary}</code>
          </div>
        ),
      )}
    </>
  );
}
export function ChatPane({ taskId, provider, onError }: ChatPaneProps) {
  const [items, setItems] = useState<ChatHistoryItem[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
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
  const events = items.map((item) => item.event);
  const lastStatus = [...events].reverse().find((e): e is Extract<ChatEvent, { type: "status" }> => e.type === "status");
  const busy = lastStatus?.state === "running";
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, busy]);
  const resolved = new Map<string, "allow" | "deny">();
  for (const event of events)
    if (event.type === "approval_resolved") resolved.set(event.id, event.behavior);
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
  // Colar uma imagem (Ctrl+V) reaproveita a mesma rotina do terminal: o main salva o arquivo.
  function paste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const hasImage = [...e.clipboardData.items].some((item) => item.type.startsWith("image/"));
    if (!hasImage) return;
    e.preventDefault();
    request<string | null>({ action: "pasteImage" })
      .then((path) => {
        if (path) addAttachments([path]);
      })
      .catch(onError);
  }
  async function send() {
    const text = draft.trim();
    if (!text && !attachments.length) return;
    const images = attachments;
    setDraft("");
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
  function decide(id: string, behavior: "allow" | "deny", always = false) {
    request({ action: "chatDecide", taskId, id, behavior, always }).catch(onError);
  }
  return (
    <div className={`chat-pane chat-${provider}`}>
      <div className="chat-log">
        {items.length === 0 && (
          <p className="chat-empty">Escreva uma mensagem para começar a conversa nesta tarefa.</p>
        )}
        {items.map(({ seq, event }) => {
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
              <div key={seq} className="chat-assistant">
                <Blocks blocks={event.blocks} />
              </div>
            );
          if (event.type === "tool_result") {
            // Uma linha resumida; o conteúdo completo abre só ao clicar.
            const text = event.text.length > RESULT_LIMIT ? `${event.text.slice(0, RESULT_LIMIT)}…` : event.text;
            const summary = (event.text.split("\n")[0] ?? "").slice(0, 140) || "sem saída";
            return (
              <details key={seq} className={event.isError ? "chat-result-block error" : "chat-result-block"}>
                <summary>
                  <span className="chat-result-mark">{event.isError ? "✗" : "✓"}</span> {summary}
                </summary>
                <pre className="chat-result">{text || "(sem saída)"}</pre>
              </details>
            );
          }
          if (event.type === "approval") {
            const outcome = resolved.get(event.id);
            return (
              <div key={seq} className="chat-approval">
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
          if (event.type === "status" && event.state === "error")
            return (
              <p key={seq} className="chat-error">
                {event.message ?? "Algo deu errado."}
              </p>
            );
          return null;
        })}
        {busy && <p className="chat-busy">Pensando…</p>}
        <div ref={bottom} />
      </div>
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
        <div className="chat-input-row">
          <button
            type="button"
            className="chat-attach"
            aria-label="Anexar imagens"
            title="Anexar imagens (ou cole com Ctrl+V)"
            onClick={attach}
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={draft}
            placeholder={`Mensagem para ${LABELS[provider] ?? "o agente"} (Enter envia, Shift+Enter quebra linha)`}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
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
      {viewer && (
        <div className="chat-viewer" role="dialog" aria-label="Imagem ampliada" onClick={() => setViewer(null)}>
          <img src={viewer} alt="Imagem ampliada" />
        </div>
      )}
    </div>
  );
}
