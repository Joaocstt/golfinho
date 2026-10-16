import { it, expect, vi, beforeEach } from "vitest";
import type { ChatEvent } from "../src/shared/contracts";
const sdk = vi.hoisted(() => ({
  calls: [] as any[],
  streams: [] as any[],
}));
// Stream controlado pelo teste: o que empurramos aparece como mensagem do SDK.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: any) => {
    sdk.calls.push(params);
    const queue: any[] = [];
    let waiting: ((r: IteratorResult<any>) => void) | null = null;
    let finished = false;
    const stream = {
      push(value: any) {
        if (waiting) {
          const resolve = waiting;
          waiting = null;
          resolve({ value, done: false });
        } else queue.push(value);
      },
      close: vi.fn(() => {
        finished = true;
        if (waiting) {
          const resolve = waiting;
          waiting = null;
          resolve({ value: undefined, done: true });
        }
      }),
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
            if (finished) return Promise.resolve({ value: undefined, done: true });
            return new Promise<IteratorResult<any>>((resolve) => (waiting = resolve));
          },
        };
      },
    };
    sdk.streams.push(stream);
    return stream;
  },
}));
import { ChatManager } from "../src/main/chat";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let events: { taskId: string; event: ChatEvent }[];
let manager: ChatManager;
beforeEach(() => {
  sdk.calls.length = 0;
  sdk.streams.length = 0;
  events = [];
  manager = new ChatManager((taskId, event) => events.push({ taskId, event }));
});
const types = () => events.map((e) => e.event.type);
const approvalOf = () => events.map((e) => e.event).find((e) => e.type === "approval") as Extract<ChatEvent, { type: "approval" }>;
it("envia a mensagem para o SDK na pasta da tarefa e mostra o turno", async () => {
  manager.send("t1", "C:/repo", "olá");
  expect(sdk.calls[0].options.cwd).toBe("C:/repo");
  expect(sdk.calls[0].options.permissionMode).toBe("default");
  const first = await sdk.calls[0].prompt[Symbol.asyncIterator]().next();
  expect(first.value.message.content).toBe("olá");
  expect(types()).toContain("user");
  sdk.streams[0].push({ type: "assistant", message: { content: [{ type: "text", text: "Oi" }] } });
  sdk.streams[0].push({ type: "result", subtype: "success" });
  await tick();
  expect(events.map((e) => e.event)).toContainEqual({ type: "assistant", blocks: [{ kind: "text", text: "Oi" }] });
  expect(events.map((e) => e.event)).toContainEqual({ type: "status", state: "idle", message: undefined });
});
it("aprovação: permitir devolve a entrada original e registra a decisão", async () => {
  manager.send("t1", "C:/repo", "rode os testes");
  const pending = sdk.calls[0].options.canUseTool("Bash", { command: "npm test" }, {
    signal: new AbortController().signal,
  });
  await tick();
  const approval = approvalOf();
  expect(approval).toMatchObject({ toolName: "Bash", summary: "npm test", canAlwaysAllow: false });
  manager.decide("t1", approval.id, "allow", false);
  await expect(pending).resolves.toEqual({ behavior: "allow", updatedInput: { command: "npm test" } });
  expect(types()).toContain("approval_resolved");
});
it("aprovação: negar devolve mensagem de negação para o Claude", async () => {
  manager.send("t1", "C:/repo", "apague");
  const pending = sdk.calls[0].options.canUseTool("Write", { file_path: "a.txt" }, {
    signal: new AbortController().signal,
  });
  await tick();
  manager.decide("t1", approvalOf().id, "deny", false);
  await expect(pending).resolves.toEqual({ behavior: "deny", message: "Negado pela pessoa no chat." });
});
it("sempre permitir só envia as sugestões quando existem", async () => {
  manager.send("t1", "C:/repo", "x");
  const suggestion = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" };
  const pending = sdk.calls[0].options.canUseTool(
    "Bash",
    { command: "npm test" },
    { signal: new AbortController().signal, suggestions: [suggestion] },
  );
  await tick();
  expect(approvalOf().canAlwaysAllow).toBe(true);
  manager.decide("t1", approvalOf().id, "allow", true);
  await expect(pending).resolves.toEqual({
    behavior: "allow",
    updatedInput: { command: "npm test" },
    updatedPermissions: [suggestion],
  });
});
it("interromper a tarefa nega as aprovações pendentes e fecha a conversa", async () => {
  manager.send("t1", "C:/repo", "x");
  const pending = sdk.calls[0].options.canUseTool("Bash", { command: "rm -rf x" }, {
    signal: new AbortController().signal,
  });
  await tick();
  manager.stop("t1");
  await expect(pending).resolves.toEqual({ behavior: "deny", message: "Negado pela pessoa no chat." });
  expect(sdk.streams[0].close).toHaveBeenCalled();
});
it("decisão para aprovação desconhecida não faz nada", () => {
  manager.send("t1", "C:/repo", "x");
  expect(() => manager.decide("t1", "00000000-0000-4000-8000-000000000000", "allow", false)).not.toThrow();
});
