// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { ChatPane } from "../src/renderer/ChatPane";
import type { ChatEvent, ChatHistoryItem, Signal } from "../src/shared/contracts";

Element.prototype.scrollIntoView = () => {};

let signal: ((s: Signal) => void) | null = null;
function mountWith(events: ChatEvent[], props: Partial<React.ComponentProps<typeof ChatPane>> = {}) {
  const items: ChatHistoryItem[] = events.map((event, i) => ({ seq: i + 1, event }));
  window.golfinho = {
    request: vi.fn(async (r: { action: string }) => (r.action === "chatHistory" ? items : null)),
    subscribe: (fn: (s: Signal) => void) => {
      signal = fn;
      return () => {};
    },
  } as unknown as typeof window.golfinho;
  return render(<ChatPane taskId="t" provider="claude" draft="" onDraftChange={() => {}} onError={() => {}} {...props} />);
}

afterEach(() => cleanup());

it("mostra o diff do Edit e o resultado dentro do cartão da ferramenta", async () => {
  const { container } = mountWith([
    {
      type: "assistant",
      blocks: [{ kind: "tool", name: "Edit", summary: "/r/a.ts", id: "tu1", input: { file_path: "/r/a.ts", old_string: "velho", new_string: "novo" } }],
    },
    { type: "tool_result", text: "arquivo atualizado", isError: false, toolUseId: "tu1" },
  ]);
  await waitFor(() => expect(screen.getByText("- velho")).toBeTruthy());
  expect(screen.getByText("+ novo")).toBeTruthy();
  const card = container.querySelector(".chat-tool-card")!;
  expect(card.textContent).toContain("arquivo atualizado");
  expect(container.querySelector(".chat-result-block")).toBeNull();
});

it("mostra o TodoWrite como lista e o raciocínio recolhido", async () => {
  mountWith([
    {
      type: "assistant",
      blocks: [
        { kind: "thinking", text: "primeiro olhar os testes" },
        { kind: "tool", name: "TodoWrite", summary: "{}", id: "tu2", input: { todos: [{ content: "Rodar testes", status: "completed" }, { content: "Corrigir", status: "in_progress" }] } },
      ],
    },
  ]);
  await waitFor(() => expect(screen.getByText("Raciocínio")).toBeTruthy());
  expect(screen.getByText(/Rodar testes/).closest("li")?.className).toContain("completed");
  expect(screen.getByText(/Corrigir/).closest("li")?.className).toContain("in_progress");
});

it("escreve a resposta ao vivo e troca pela mensagem completa", async () => {
  const { container } = mountWith([]);
  await waitFor(() => expect(signal).not.toBeNull());
  act(() => signal!({ kind: "chat", taskId: "t", seq: -1, event: { type: "delta", kind: "text", text: "Olá, " } }));
  act(() => signal!({ kind: "chat", taskId: "t", seq: -1, event: { type: "delta", kind: "text", text: "mundo" } }));
  expect(container.querySelector(".chat-live")?.textContent).toContain("Olá, mundo");
  act(() => signal!({ kind: "chat", taskId: "t", seq: 1, event: { type: "assistant", blocks: [{ kind: "text", text: "Olá, mundo!" }] } }));
  expect(container.querySelector(".chat-live")).toBeNull();
  expect(screen.getByText("Olá, mundo!")).toBeTruthy();
});

it("troca o modo de permissão pelo menu do chat", async () => {
  mountWith([{ type: "status", state: "running" }], { permissionMode: "acceptEdits" });
  const trigger = await screen.findByLabelText("Permissões do chat");
  expect(trigger.textContent).toBe("Aceitar edições");
  fireEvent.click(trigger);
  expect(screen.getByRole("menuitemradio", { name: /Aceitar edições/ }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("menuitemradio", { name: /Ignorar permissões/ }));
  expect(window.golfinho.request).toHaveBeenCalledWith({ action: "setChatPermissionMode", taskId: "t", mode: "bypassPermissions" });
  expect(screen.queryByRole("menu")).toBeNull();
});

it("o seletor de permissões só aparece no Claude", async () => {
  cleanup();
  window.golfinho = { request: vi.fn(async () => []), subscribe: () => () => {} } as unknown as typeof window.golfinho;
  render(<ChatPane taskId="t" provider="codex" draft="" onDraftChange={() => {}} onError={() => {}} />);
  await screen.findByLabelText("Modelo do chat");
  expect(screen.queryByLabelText("Permissões do chat")).toBeNull();
});

it("menu de modelos como no Claude: versões, número, esforço e mais modelos", async () => {
  cleanup();
  const request = vi.fn(async (r: { action: string }) =>
    r.action === "chatModels"
      ? [
          { value: "", label: "Padrão (Opus 5.5)", efforts: ["low", "medium", "high"] },
          { value: "opus", label: "Opus 5.5", efforts: ["low", "medium", "high"] },
          { value: "sonnet", label: "Sonnet 5.5", efforts: ["low", "medium", "high"] },
        ]
      : [],
  );
  window.golfinho = { request, subscribe: () => () => {} } as unknown as typeof window.golfinho;
  render(<ChatPane taskId="t" provider="claude" model="opus" effort="medium" draft="" onDraftChange={() => {}} onError={() => {}} />);
  const trigger = await screen.findByLabelText("Modelo do chat");
  await waitFor(() => expect(trigger.textContent).toBe("Opus 5.5Médio"));
  fireEvent.click(trigger);
  expect(screen.getByRole("menuitemradio", { name: "Opus 5.5" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("menuitemradio", { name: /Sonnet 5.5/ }).textContent).toContain("2");
  fireEvent.click(screen.getByRole("menuitem", { name: /Esforço/ }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Alto" }));
  expect(request).toHaveBeenCalledWith({ action: "setChatEffort", taskId: "t", effort: "high" });
  fireEvent.click(trigger);
  fireEvent.keyDown(document, { key: "2" });
  expect(request).toHaveBeenCalledWith({ action: "setChatModel", taskId: "t", model: "sonnet" });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: /Mais modelos/ }));
  expect(screen.getByRole("menuitemradio", { name: "Padrão (Opus 5.5)" })).toBeTruthy();
});
