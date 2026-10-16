import { it, expect } from "vitest";
import { AntigravityChatSession } from "../src/main/antigravityChat";
import type { ChatEvent } from "../src/shared/contracts";
it("traduz init, passos e resultado do stream-json do agy em eventos do chat", () => {
  const events: ChatEvent[] = [];
  const saved: string[] = [];
  const session = new AntigravityChatSession("/repo", "agy", (e) => events.push(e), {
    onSession: (id) => saved.push(id),
  });
  session.handleLine('{"event":"init","conversation_id":"c-1","init":{"cwd":"/repo","tools":[],"permission_mode":"request-review"}}');
  session.handleLine('{"event":"step_update","step_update":{"conversation_id":"c-1","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"ma"}}');
  session.handleLine('{"event":"step_update","step_update":{"conversation_id":"c-1","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"çã"}}');
  session.handleLine('{"event":"step_update","step_update":{"conversation_id":"c-1","step_index":2,"state":"DONE","step_type":"tool","tool_info":{"name":"ler_arquivo","parameters":{"path":"a.ts"},"output":"ok"}}}');
  session.handleLine('{"event":"result","result":{"conversation_id":"c-1","status":"SUCCESS","response":"maçã\\n","num_turns":1}}');
  expect(saved).toEqual(["c-1"]);
  expect(events).toContainEqual({ type: "assistant", blocks: [{ kind: "tool", name: "ler_arquivo", summary: "a.ts" }] });
  expect(events).toContainEqual({ type: "tool_result", text: "ok", isError: false });
  expect(events).toContainEqual({ type: "assistant", blocks: [{ kind: "text", text: "maçã\n" }] });
  expect(events[events.length - 1]).toEqual({ type: "status", state: "idle" });
});
it("mostra erro quando o turno falha e ignora linhas inválidas", () => {
  const events: ChatEvent[] = [];
  const session = new AntigravityChatSession("/repo", "agy", (e) => events.push(e));
  session.handleLine("não é json");
  session.handleLine('{"event":"result","result":{"conversation_id":"c-2","status":"ERROR","error":{"message":"sem créditos"}}}');
  expect(events[events.length - 1]).toEqual({ type: "status", state: "error", message: "sem créditos" });
});
it("mostra o cartão do comando e o motivo quando a permissão é negada (evento real do agy)", async () => {
  const { readFileSync } = await import("node:fs");
  const lines = readFileSync(new URL("./fixtures/agy-denied-command.jsonl", import.meta.url), "utf8").trim().split("\n");
  const events: ChatEvent[] = [];
  const session = new AntigravityChatSession("/repo", "agy", (e) => events.push(e));
  // Um turno de verdade: o agy só emite a linha de resultado no fim.
  for (const line of lines) session.handleLine(line);
  expect(events).toContainEqual({ type: "assistant", blocks: [{ kind: "tool", name: "run_command", summary: "git branch --show-current" }] });
  const denied = events.find((e) => e.type === "tool_result");
  expect(denied).toMatchObject({ type: "tool_result", isError: true });
  expect((denied as { text: string }).text).toContain("user denied permission");
  expect(events.filter((e) => e.type === "assistant")).toHaveLength(1);
});
