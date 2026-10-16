import React, { useEffect, useRef, useState } from "react";
import type { ChatBlock, ChatEvent, ChatHistoryItem, Request } from "../shared/contracts";
export interface ChatPaneProps {
  taskId: string;
  provider: string;
  onError: (e: unknown) => void;
}
// Cada provedor tem a sua cor de destaque, para não parecer a conversa de outro.
const LABELS: Record<string, string> = { claude: "Claude", codex: "Codex" };
const RESULT_LIMIT = 600;
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
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
          <p key={index} className="chat-text">
            {block.text}
          </p>
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
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setItems([]);
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
  const events = items.map((item) => item.event);
  const lastStatus = [...events].reverse().find((e): e is Extract<ChatEvent, { type: "status" }> => e.type === "status");
  const busy = lastStatus?.state === "running";
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, busy]);
  const resolved = new Map<string, "allow" | "deny">();
  for (const event of events)
    if (event.type === "approval_resolved") resolved.set(event.id, event.behavior);
  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      await request({ action: "chatSend", taskId, text });
    } catch (e) {
      onError(e);
    }
  }
  function decide(id: string, behavior: "allow" | "deny", always = false) {
    request({ action: "chatDecide", taskId, id, behavior, always }).catch(onError);
  }
  return (
    <div className={`chat-pane chat-${provider}`}>
      <div className="chat-header">
        <span>{LABELS[provider] ?? "Chat"}</span>
        <span className="chat-header-note">conversa desta tarefa</span>
      </div>
      <div className="chat-log">
        {items.length === 0 && (
          <p className="chat-empty">Escreva uma mensagem para começar a conversa nesta tarefa.</p>
        )}
        {items.map(({ seq, event }) => {
          if (event.type === "user") return <div key={seq} className="chat-user">{event.text}</div>;
          if (event.type === "assistant")
            return (
              <div key={seq} className="chat-assistant">
                <Blocks blocks={event.blocks} />
              </div>
            );
          if (event.type === "tool_result") {
            const text = event.text.length > RESULT_LIMIT ? `${event.text.slice(0, RESULT_LIMIT)}…` : event.text;
            return (
              <pre key={seq} className={event.isError ? "chat-result error" : "chat-result"}>
                {text || "(sem saída)"}
              </pre>
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
        <textarea
          value={draft}
          placeholder={`Mensagem para ${LABELS[provider] ?? "o agente"} (Enter envia, Shift+Enter quebra linha)`}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" disabled={!draft.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
