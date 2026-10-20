import { it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChatEvent } from "../src/shared/contracts";
const fake = vi.hoisted(() => ({
  children: [] as any[],
  // Responde ao que o cliente envia; o teste controla as aprovações e a conclusão do turno.
  autoRespond: true,
}));
vi.mock("node:child_process", () => ({
  spawn: () => {
    const stdout = new EventEmitter() as any;
    stdout.setEncoding = () => {};
    const stderr = new EventEmitter() as any;
    stderr.resume = () => {};
    const child = new EventEmitter() as any;
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = {
      write: (data: string) => {
        for (const line of data.split("\n").filter(Boolean)) {
          const message = JSON.parse(line);
          child.sent.push(message);
          if (fake.autoRespond && message.method === "initialize")
            reply(stdout, { id: message.id, result: { userAgent: "fake" } });
          if (fake.autoRespond && message.method === "thread/start")
            reply(stdout, { id: message.id, result: { thread: { id: "thread-1" } } });
          if (fake.autoRespond && message.method === "thread/resume")
            reply(stdout, { id: message.id, result: { thread: { id: message.params.threadId } } });
          if (fake.autoRespond && message.method === "turn/start")
            reply(stdout, { id: message.id, result: { turn: { id: "turn-1" } } });
        }
      },
    };
    child.sent = [] as any[];
    child.kill = vi.fn();
    fake.children.push(child);
    return child;
  },
}));
function reply(stdout: EventEmitter, message: unknown) {
  stdout.emit("data", JSON.stringify(message) + "\n");
}
import { CodexChatSession } from "../src/main/codexChat";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let events: ChatEvent[];
let session: CodexChatSession;
// process.execPath existe e é absoluto, então executablePath o aceita sem depender de PATH.
const EXECUTABLE = process.execPath;
beforeEach(() => {
  fake.children.length = 0;
  fake.autoRespond = true;
  events = [];
  session = new CodexChatSession("C:/repo", EXECUTABLE, (event) => events.push(event));
});
const child = () => fake.children[0];
it("faz o handshake, abre a thread e manda o texto como turno", async () => {
  session.send("olá");
  await tick();
  await tick();
  const methods = child().sent.map((m: any) => m.method);
  expect(methods.slice(0, 4)).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
  const turn = child().sent.find((m: any) => m.method === "turn/start");
  expect(turn.params).toMatchObject({ threadId: "thread-1", cwd: "C:/repo", input: [{ type: "text", text: "olá" }] });
  expect(events).toContainEqual({ type: "user", text: "olá" });
});
it("aprovação de comando: permitir responde accept e mostra o cartão", async () => {
  session.send("rode os testes");
  await tick();
  await tick();
  reply(child().stdout, {
    id: 900,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread-1", turnId: "turn-1", itemId: "i1", command: "npm test" },
  });
  await tick();
  const approval = events.find((e) => e.type === "approval") as Extract<ChatEvent, { type: "approval" }>;
  expect(approval).toMatchObject({ toolName: "Comando", summary: "npm test", canAlwaysAllow: true });
  session.decide(approval.id, "allow", false);
  const response = child().sent.find((m: any) => m.id === 900);
  expect(response).toEqual({ id: 900, result: { decision: "accept" } });
  expect(events).toContainEqual({ type: "approval_resolved", id: approval.id, behavior: "allow" });
});
it("aprovação de arquivo: sempre permitir vira acceptForSession; negar vira decline", async () => {
  session.send("edite");
  await tick();
  await tick();
  reply(child().stdout, { id: 901, method: "item/fileChange/requestApproval", params: { itemId: "i2", grantRoot: "src", reason: "ajuste" } });
  reply(child().stdout, { id: 902, method: "item/fileChange/requestApproval", params: { itemId: "i3" } });
  await tick();
  const approvals = events.filter((e) => e.type === "approval") as Extract<ChatEvent, { type: "approval" }>[];
  expect(approvals[0].summary).toBe("src — ajuste");
  session.decide(approvals[0].id, "allow", true);
  session.decide(approvals[1].id, "deny", false);
  expect(child().sent.find((m: any) => m.id === 901).result).toEqual({ decision: "acceptForSession" });
  expect(child().sent.find((m: any) => m.id === 902).result).toEqual({ decision: "decline" });
});
it("mostra mensagens, comandos e conclui o turno", async () => {
  session.send("x");
  await tick();
  await tick();
  reply(child().stdout, { method: "item/started", params: { item: { type: "commandExecution", command: "ls" } } });
  reply(child().stdout, { method: "item/completed", params: { item: { type: "commandExecution", aggregatedOutput: "a\nb", exitCode: 0 } } });
  reply(child().stdout, { method: "item/completed", params: { item: { type: "agentMessage", text: "pronto" } } });
  reply(child().stdout, { method: "turn/completed", params: { turn: { status: "completed" } } });
  await tick();
  expect(events).toContainEqual({ type: "assistant", blocks: [{ kind: "tool", name: "Comando", summary: "ls" }] });
  expect(events).toContainEqual({ type: "tool_result", text: "a\nb", isError: false });
  expect(events).toContainEqual({ type: "assistant", blocks: [{ kind: "text", text: "pronto" }] });
  expect(events.at(-1)).toEqual({ type: "status", state: "idle" });
});
it("turno com falha vira erro no chat", async () => {
  session.send("x");
  await tick();
  await tick();
  reply(child().stdout, { method: "turn/completed", params: { turn: { status: "failed", error: { message: "limite atingido" } } } });
  await tick();
  expect(events.at(-1)).toEqual({ type: "status", state: "error", message: "limite atingido" });
});
it("pedido desconhecido é recusado e avisado, sem travar o turno", async () => {
  session.send("x");
  await tick();
  await tick();
  reply(child().stdout, { id: 950, method: "item/tool/requestUserInput", params: {} });
  await tick();
  expect(child().sent.find((m: any) => m.id === 950)).toMatchObject({ id: 950, error: { code: -32601 } });
  expect(events.at(-1)).toMatchObject({ type: "status", state: "error" });
});
it("stop nega as aprovações pendentes e encerra o processo", async () => {
  session.send("x");
  await tick();
  await tick();
  reply(child().stdout, { id: 960, method: "item/commandExecution/requestApproval", params: { command: "rm x" } });
  await tick();
  session.stop();
  expect(child().sent.find((m: any) => m.id === 960)).toEqual({ id: 960, result: { decision: "decline" } });
  expect(child().kill).toHaveBeenCalled();
});
it("retoma a thread salva com thread/resume e avisa o id", async () => {
  const saved: string[] = [];
  const resumed = new CodexChatSession("C:/repo", EXECUTABLE, (event) => events.push(event), {
    resume: "thread-salva",
    onSession: (id) => saved.push(id),
  });
  resumed.send("continua");
  await tick();
  await tick();
  const methods = child().sent.map((m: any) => m.method);
  expect(methods).toContain("thread/resume");
  expect(methods).not.toContain("thread/start");
  expect(child().sent.find((m: any) => m.method === "thread/resume").params.threadId).toBe("thread-salva");
  expect(saved).toEqual(["thread-salva"]);
});
it("imagens vão à Codex como localImage antes do texto", async () => {
  session.send("veja", [{ path: "C:/app/chat-images/a.png", mediaType: "image/png", base64: "QUJD" }]);
  await tick();
  await tick();
  const turn = child().sent.find((m: any) => m.method === "turn/start");
  expect(turn.params.input).toEqual([
    { type: "localImage", path: "C:/app/chat-images/a.png" },
    { type: "text", text: "veja" },
  ]);
  expect(events).toContainEqual({ type: "user", text: "veja", images: ["C:/app/chat-images/a.png"] });
});
it("Parar manda turn/interrupt com o id do turno e mostra Interrompido", async () => {
  session.send("faça algo longo");
  await tick();
  await tick();
  session.interrupt();
  const interrupt = child().sent.find((m: any) => m.method === "turn/interrupt");
  expect(interrupt.params).toEqual({ threadId: "thread-1", turnId: "turn-1" });
  reply(child().stdout, { method: "turn/completed", params: { turn: { status: "interrupted" } } });
  await tick();
  expect(events.at(-1)).toEqual({ type: "status", state: "idle", message: "Interrompido." });
});
it("o pacote de handoff vai no turno, mas a conversa mostra só a mensagem", async () => {
  session.send("olá", [], "CONTEXTO\n\n---\n\nolá");
  await tick();
  await tick();
  const turn = child().sent.find((m: any) => m.method === "turn/start");
  expect(turn.params.input).toEqual([{ type: "text", text: "CONTEXTO\n\n---\n\nolá" }]);
  expect(events).toContainEqual({ type: "user", text: "olá" });
  expect(JSON.stringify(events)).not.toContain("CONTEXTO");
});
