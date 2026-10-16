import React, { useEffect, useRef, useState } from "react";
import type { ChatBlock, ChatEvent } from "../shared/contracts";
interface Item {
  key: number;
  event: ChatEvent;
}
export interface ChatPaneProps {
  taskId: string;
  onError: (e: unknown) => void;
}
// O histórico fica na memória do renderer: sobrevive a trocar de aba, mas não a reiniciar o app.
const histories = new Map<string, Item[]>();
let nextKey = 0;
const RESULT_LIMIT = 600;
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
export function ChatPane({ taskId, onError }: ChatPaneProps) {
  const [items, setItems] = useState<Item[]>(() => histories.get(taskId) ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setItems(histories.get(taskId) ?? []);
    return window.golfinho.subscribe((signal) => {
      if (signal.kind !== "chat" || signal.taskId !== taskId) return;
      const { event } = signal;
      if (event.type === "status") setBusy(event.state === "running");
      setItems((current) => {
        const next = [...current, { key: nextKey++, event }];
        histories.set(taskId, next);
        return next;
      });
    });
  }, [taskId]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items, busy]);
  const resolved = new Map<string, "allow" | "deny">();
  for (const item of items)
    if (item.event.type === "approval_resolved") resolved.set(item.event.id, item.event.behavior);
  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      await window.golfinho.request({ action: "chatSend", taskId, text });
    } catch (e) {
      onError(e);
    }
  }
  function decide(id: string, behavior: "allow" | "deny", always = false) {
    window.golfinho.request({ action: "chatDecide", taskId, id, behavior, always }).catch(onError);
  }
  return (
    <div className="chat-pane">
      <div className="chat-log">
        {items.length === 0 && (
          <p className="chat-empty">Escreva uma mensagem para começar a conversa com o Claude nesta tarefa.</p>
        )}
        {items.map(({ key, event }) => {
          if (event.type === "user") return <div key={key} className="chat-user">{event.text}</div>;
          if (event.type === "assistant")
            return (
              <div key={key} className="chat-assistant">
                <Blocks blocks={event.blocks} />
              </div>
            );
          if (event.type === "tool_result") {
            const text = event.text.length > RESULT_LIMIT ? `${event.text.slice(0, RESULT_LIMIT)}…` : event.text;
            return (
              <pre key={key} className={event.isError ? "chat-result error" : "chat-result"}>
                {text || "(sem saída)"}
              </pre>
            );
          }
          if (event.type === "approval") {
            const outcome = resolved.get(event.id);
            return (
              <div key={key} className="chat-approval">
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
              <p key={key} className="chat-error">
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
          placeholder="Mensagem para o Claude (Enter envia, Shift+Enter quebra linha)"
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
