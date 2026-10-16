import { describe, expect, it } from "vitest";
import { PermissionRequests } from "../src/renderer/permissionRequests";

describe("pedidos de permissão", () => {
  it("avisa uma vez para o pedido do Chat e remove somente a aprovação respondida", () => {
    const requests = new PermissionRequests();
    const approval = { kind: "chat", taskId: "a", seq: 1, event: { type: "approval", id: "p", toolName: "Bash", summary: "npm test", canAlwaysAllow: false } } as const;
    expect(requests.receive(approval)).toBe(true);
    expect(requests.receive(approval)).toBe(false);
    requests.receive({ ...approval, seq: 2, event: { ...approval.event, id: "q" } });
    requests.receive({ ...approval, taskId: "b" });
    requests.receive({ kind: "chat", taskId: "a", seq: 3, event: { type: "approval_resolved", id: "p", behavior: "allow" } });
    expect(requests.receive(approval)).toBe(false);
    expect(requests.items.map((item) => [item.taskId, item.approvalId])).toEqual([["a", "q"], ["b", "p"]]);
    requests.receive({ kind: "chat", taskId: "a", seq: 4, event: { type: "status", state: "idle" } });
    expect(requests.items.map((item) => item.taskId)).toEqual(["b"]);
  });

  it.each([
    "Would you like to run the following command?\r\n› 1. Yes, proceed (y)\r\n  2. No, and tell Codex what to do differently",
    "Do you want to proceed?\r\n❯ 1. Yes\r\n  2. Yes, and don't ask again\r\n  3. No",
    "Do you want to make this edit to app.ts?\r\n❯ 1. Yes\r\n  2. No",
    "Você deseja permitir esta ação?\r\n> 1. Sim\r\n  2. Não",
  ])("detecta uma pergunta explícita com escolhas: %s", (prompt) => {
    const requests = new PermissionRequests();
    requests.receive({ kind: "terminal", taskId: "a", offset: 0, data: prompt });
    expect(requests.items).toEqual([expect.objectContaining({ taskId: "a", source: "Terminal" })]);
  });

  it("junta fragmentos ANSI e ignora quadros duplicados e respostas automáticas do terminal", () => {
    const requests = new PermissionRequests();
    const parts = ["\x1b[3", "3mWould you like to run the following ", "command?\x1b[0m\r\n› 1. Yes, proceed (y)"];
    let offset = 0;
    for (const data of parts) {
      requests.receive({ kind: "terminal", taskId: "a", offset, data });
      offset += data.length;
    }
    expect(requests.items).toHaveLength(1);
    expect(requests.receive({ kind: "terminal", taskId: "a", offset: 0, data: parts[0] })).toBe(false);
    expect(requests.answeredTerminal("a", "\x1b[1;1R")).toBe(false);
    expect(requests.answeredTerminal("a", "texto")).toBe(false);
    expect(requests.answeredTerminal("a", "\r")).toBe(true);
    expect(requests.items).toEqual([]);
    expect(requests.receive({ kind: "terminal", taskId: "a", offset: offset - parts[2].length, data: parts[2] })).toBe(false);
    requests.receive({ kind: "terminal", taskId: "a", offset, data: parts.join("") });
    expect(requests.items).toHaveLength(1);
  });

  it.each([
    "Permission denied: cannot open file",
    "To run this command you might need permission.\n1. Yes",
    "Would you like to run the following command?",
    "1. Yes, proceed (y)\n2. No",
    "The README explains: Do you want to proceed? This is only documentation.",
  ])("não notifica saída comum ou pergunta sem escolhas: %s", (data) => {
    const requests = new PermissionRequests();
    expect(requests.receive({ kind: "terminal", taskId: "a", offset: 0, data })).toBe(false);
    expect(requests.items).toEqual([]);
  });

  it("limpa pedidos de tarefas excluídas e terminal encerrado sem afetar Chat ativo", () => {
    const requests = new PermissionRequests();
    requests.receive({ kind: "terminal", taskId: "a", offset: 0, data: "Do you want to proceed?\n1. Yes\n2. No" });
    requests.receive({ kind: "chat", taskId: "a", seq: 1, event: { type: "approval", id: "p", toolName: "Bash", summary: "", canAlwaysAllow: false } });
    requests.syncTasks([{ id: "a", status: "review" }]);
    expect(requests.items.map((item) => item.source)).toEqual(["Chat"]);
    requests.syncTasks([]);
    expect(requests.items).toEqual([]);
  });
  it("não recria um aviso com saída atrasada ou checks depois de encerrar a CLI", () => {
    const requests = new PermissionRequests();
    requests.syncTasks([{ id: "a", status: "running" }]);
    const data = "Do you want to proceed?\n1. Yes\n2. No";
    requests.receive({ kind: "terminal", taskId: "a", offset: 0, data });
    requests.syncTasks([{ id: "a", status: "review" }]);
    requests.receive({ kind: "terminal", taskId: "a", offset: data.length, data });
    expect(requests.items).toEqual([]);
  });
});
