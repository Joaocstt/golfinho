// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ChatPane } from "../src/renderer/ChatPane";
import type { ChatEvent, ChatHistoryItem } from "../src/shared/contracts";

// jsdom não implementa rolagem; o chat só rola até a última mensagem.
Element.prototype.scrollIntoView = () => {};

// Barra de contexto do chat com o histórico que o main devolve depois de uma troca de agente.
function mountWith(events: ChatEvent[]) {
  const items: ChatHistoryItem[] = events.map((event, i) => ({ seq: i + 1, event }) as ChatHistoryItem);
  window.golfinho = {
    request: vi.fn(async (r: { action: string }) => (r.action === "chatHistory" ? items : null)),
    subscribe: () => () => {},
  } as unknown as typeof window.golfinho;
  render(
    <ChatPane
      taskId="t"
      provider="codex"
      draft=""
      onDraftChange={() => {}}
      onError={() => {}}
    />,
  );
}

afterEach(() => cleanup());

describe("barra de contexto depois da troca de agente", () => {
  it("não mostra o uso do agente antigo logo após a troca", async () => {
    mountWith([
      { type: "context", used: 150_000, limit: 200_000 },
      { type: "agent_changed", from: "Claude Code", to: "Codex" } as ChatEvent,
    ]);
    await waitFor(() => expect(screen.getByText(/Agente trocado de Claude Code para Codex/)).toBeTruthy());
    expect(screen.queryByText(/Contexto 75%/)).toBeNull();
  });

  it("mostra o uso do novo agente quando ele responde", async () => {
    mountWith([
      { type: "context", used: 150_000, limit: 200_000 },
      { type: "agent_changed", from: "Claude Code", to: "Codex" } as ChatEvent,
      { type: "context", used: 12_000, limit: 200_000 },
    ]);
    expect(await screen.findByText("Contexto 6%")).toBeTruthy();
  });
});
