import type { ChatEvent } from "./contracts";

export type ContextEvent = Extract<ChatEvent, { type: "context" }>;

// Uso de contexto que vale agora. Só conta o que veio do agente atual: depois de uma troca,
// o uso do agente antigo não representa a janela do novo.
export function currentContext(events: ChatEvent[]): ContextEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "agent_changed") return undefined;
    if (event.type === "context") return event;
  }
  return undefined;
}
