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
      interrupt: vi.fn(async () => undefined),
      setPermissionMode: vi.fn(async () => undefined),
      applyFlagSettings: vi.fn(async () => undefined),
      setModel: vi.fn(async () => undefined),
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
const CLAUDE = { provider: "claude" as const, cwd: "C:/repo", executable: "claude" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let events: { taskId: string; event: ChatEvent }[];
let manager: ChatManager;
beforeEach(() => {
  sdk.calls.length = 0;
  sdk.streams.length = 0;
  events = [];
  manager = new ChatManager((taskId, _seq, event) => events.push({ taskId, event }), {
    append: () => 0,
    list: () => [],
    sessionId: () => null,
    saveSessionId: () => undefined,
  });
});
const types = () => events.map((e) => e.event.type);
const approvalOf = () => events.map((e) => e.event).find((e) => e.type === "approval") as Extract<ChatEvent, { type: "approval" }>;
it("envia a mensagem para o SDK na pasta da tarefa e mostra o turno", async () => {
  manager.send("t1", CLAUDE, "olá");
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
  manager.send("t1", CLAUDE, "rode os testes");
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
  manager.send("t1", CLAUDE, "apague");
  const pending = sdk.calls[0].options.canUseTool("Write", { file_path: "a.txt" }, {
    signal: new AbortController().signal,
  });
  await tick();
  manager.decide("t1", approvalOf().id, "deny", false);
  await expect(pending).resolves.toEqual({ behavior: "deny", message: "Negado pela pessoa no chat." });
});
it("sempre permitir só envia as sugestões quando existem", async () => {
  manager.send("t1", CLAUDE, "x");
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
  manager.send("t1", CLAUDE, "x");
  const pending = sdk.calls[0].options.canUseTool("Bash", { command: "rm -rf x" }, {
    signal: new AbortController().signal,
  });
  await tick();
  manager.stop("t1");
  await expect(pending).resolves.toEqual({ behavior: "deny", message: "Negado pela pessoa no chat." });
  expect(sdk.streams[0].close).toHaveBeenCalled();
});
it("decisão para aprovação desconhecida não faz nada", () => {
  manager.send("t1", CLAUDE, "x");
  expect(() => manager.decide("t1", "00000000-0000-4000-8000-000000000000", "allow", false)).not.toThrow();
});
it("retoma a sessão salva e guarda o id que o SDK informa", async () => {
  const saved: string[] = [];
  const store = {
    append: () => 0,
    list: () => [],
    sessionId: () => "sessao-antiga",
    saveSessionId: (_t: string, id: string) => saved.push(id),
  };
  const resumed = new ChatManager(() => undefined, store);
  resumed.send("t9", CLAUDE, "continua");
  expect(sdk.calls.at(-1).options.resume).toBe("sessao-antiga");
  sdk.streams.at(-1).push({ type: "system", subtype: "init", session_id: "sessao-nova" });
  await tick();
  expect(saved).toEqual(["sessao-nova"]);
});
it("histórico sem sessão viva fecha aprovações abertas como negadas e para o estado de execução", () => {
  const items = [
    { seq: 1, event: { type: "status", state: "running" } },
    { seq: 2, event: { type: "approval", id: "a1", toolName: "Bash", summary: "rm x", canAlwaysAllow: false } },
  ] as const;
  const appended: ChatEvent[] = [];
  const stored = [...items] as { seq: number; event: ChatEvent }[];
  const store = {
    append: (_t: string, event: ChatEvent) => {
      appended.push(event);
      stored.push({ seq: stored.length + 1, event });
      return stored.length;
    },
    list: () => stored,
    sessionId: () => null,
    saveSessionId: () => undefined,
  };
  const reopened = new ChatManager(() => undefined, store);
  const history = reopened.history("t8");
  expect(appended).toContainEqual({ type: "approval_resolved", id: "a1", behavior: "deny" });
  expect(appended).toContainEqual({ type: "status", state: "idle" });
  expect(history.length).toBe(4);
});
it("imagens vão ao Claude como blocos base64 antes do texto e aparecem no evento do usuário", async () => {
  manager.send("t1", CLAUDE, "veja", [{ path: "C:/app/chat-images/a.png", mediaType: "image/png", base64: "QUJD" }]);
  const first = await sdk.calls[0].prompt[Symbol.asyncIterator]().next();
  expect(first.value.message.content).toEqual([
    { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
    { type: "text", text: "veja" },
  ]);
  expect(events.map((e) => e.event)).toContainEqual({ type: "user", text: "veja", images: ["C:/app/chat-images/a.png"] });
});
it("Parar interrompe o turno, nega aprovações abertas e mostra Interrompido", async () => {
  manager.send("t1", CLAUDE, "faça algo longo");
  const pending = sdk.calls[0].options.canUseTool("Bash", { command: "npm test" }, { signal: new AbortController().signal });
  await tick();
  manager.interrupt("t1");
  expect(sdk.streams[0].interrupt).toHaveBeenCalled();
  await expect(pending).resolves.toEqual({ behavior: "deny", message: "Negado pela pessoa no chat." });
  sdk.streams[0].push({ type: "result", subtype: "error_during_execution" });
  await tick();
  expect(events.at(-1)?.event).toEqual({ type: "status", state: "idle", message: "Interrompido." });
});
it("o pacote de handoff vai para o SDK, mas a conversa mostra só a mensagem", async () => {
  manager.send("t-handoff", CLAUDE, "continue", [], "CONTEXTO DA TROCA");
  const first = await sdk.calls[0].prompt[Symbol.asyncIterator]().next();
  expect(first.value.message.content).toBe("CONTEXTO DA TROCA\n\n---\n\ncontinue");
  expect(events).toContainEqual({ taskId: "t-handoff", event: { type: "user", text: "continue" } });
  expect(JSON.stringify(events)).not.toContain("CONTEXTO DA TROCA");
});
it("sem pacote, a mensagem segue como antes", async () => {
  manager.send("t-plain", CLAUDE, "olá", [], null);
  const first = await sdk.calls[0].prompt[Symbol.asyncIterator]().next();
  expect(first.value.message.content).toBe("olá");
});
it("usa o prompt e as configurações do Claude Code e pede o texto ao vivo", () => {
  manager.send("t1", CLAUDE, "olá");
  expect(sdk.calls[0].options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
  expect(sdk.calls[0].options.settingSources).toEqual(["user", "project", "local"]);
  expect(sdk.calls[0].options.includePartialMessages).toBe(true);
});
it("texto e raciocínio ao vivo vão para a tela sem entrar no histórico", async () => {
  const append = vi.fn(() => 1);
  const seen: { seq: number; event: ChatEvent }[] = [];
  const live = new ChatManager((_t, seq, event) => seen.push({ seq, event }), {
    append,
    list: () => [],
    sessionId: () => null,
    saveSessionId: () => undefined,
  });
  live.send("t1", CLAUDE, "olá");
  const appended = append.mock.calls.length;
  const delta = (d: unknown) => ({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: d } });
  sdk.streams[0].push(delta({ type: "thinking_delta", thinking: "hmm" }));
  sdk.streams[0].push(delta({ type: "text_delta", text: "Oi" }));
  sdk.streams[0].push({ type: "stream_event", parent_tool_use_id: "sub", event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } } });
  await tick();
  expect(seen.filter((s) => s.event.type === "delta")).toEqual([
    { seq: -1, event: { type: "delta", kind: "thinking", text: "hmm" } },
    { seq: -1, event: { type: "delta", kind: "text", text: "Oi" } },
  ]);
  expect(append.mock.calls.length).toBe(appended);
});
it("guarda raciocínio e a entrada da ferramenta, e liga o resultado pelo id", async () => {
  manager.send("t1", CLAUDE, "edite");
  const big = "x".repeat(5000);
  sdk.streams[0].push({
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "vou editar" },
        { type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "/r/a.ts", old_string: "a", new_string: big } },
      ],
    },
  });
  sdk.streams[0].push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }] } });
  await tick();
  const assistant = events.map((e) => e.event).find((e) => e.type === "assistant") as Extract<ChatEvent, { type: "assistant" }>;
  expect(assistant.blocks[0]).toEqual({ kind: "thinking", text: "vou editar" });
  const tool = assistant.blocks[1] as Extract<typeof assistant.blocks[number], { kind: "tool" }>;
  expect(tool).toMatchObject({ kind: "tool", name: "Edit", summary: "/r/a.ts", id: "tu1" });
  expect((tool.input!.new_string as string).length).toBe(4001);
  expect(events.map((e) => e.event)).toContainEqual({ type: "tool_result", text: "ok", isError: false, toolUseId: "tu1" });
});
it("modo de permissão: abre no modo da tarefa e troca na sessão aberta", () => {
  manager.send("t1", { ...CLAUDE, permissionMode: "acceptEdits" }, "olá");
  expect(sdk.calls[0].options.permissionMode).toBe("acceptEdits");
  manager.setPermissionMode("t1", "plan");
  expect(sdk.streams[0].setPermissionMode).toHaveBeenCalledWith("plan");
  manager.send("t1", CLAUDE, "de novo");
  expect(sdk.calls).toHaveLength(1);
});
it("mostra os modelos da CLI com a versão", async () => {
  const { toModelOptions, modelName } = await import("../src/main/chat");
  expect(modelName("claude-opus-5-5")).toBe("Opus 5.5");
  expect(modelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
  expect(modelName("gpt-5")).toBeNull();
  expect(
    toModelOptions([
      { value: "default", displayName: "Default (recommended)", resolvedModel: "claude-opus-5-5", description: "Use the default model" },
      { value: "sonnet", displayName: "Sonnet", resolvedModel: "claude-sonnet-5-5" },
      { value: "claude-fable-5-1[1m]", displayName: "Fable", resolvedModel: "claude-fable-5-1" },
    ]),
  ).toEqual([
    { value: "", label: "Padrão (Opus 5.5)", description: "Use the default model" },
    { value: "sonnet", label: "Sonnet 5.5" },
    { value: "claude-fable-5-1[1m]", label: "Fable 5.1 (1M)" },
  ]);
});
it("esforço: abre com o da tarefa e troca na sessão aberta", () => {
  manager.send("t1", { ...CLAUDE, effort: "high" }, "olá");
  expect(sdk.calls[0].options.effort).toBe("high");
  manager.setEffort("t1", null);
  expect(sdk.streams[0].applyFlagSettings).toHaveBeenCalledWith({ effortLevel: null });
});
it("modelo: troca na sessão aberta do Claude sem fechar a conversa", () => {
  manager.send("t1", CLAUDE, "olá");
  manager.setModel("t1", "sonnet");
  expect(sdk.streams[0].setModel).toHaveBeenCalledWith("sonnet");
  expect(sdk.streams[0].close).not.toHaveBeenCalled();
  manager.send("t1", CLAUDE, "de novo");
  expect(sdk.calls).toHaveLength(1);
});

it("lista de comandos tira os de terminal e os internos", async () => {
  const { toCommandOptions } = await import("../src/main/chat");
  const list = toCommandOptions([
    { name: "usage", description: "Custo", argumentHint: "" },
    { name: "doctor", description: "x" },
    { name: "__remote-workflow", description: "x" },
    { name: "code-review", description: "Revisa", argumentHint: "[nível]" },
    { name: "usage", description: "duplicado" },
  ]);
  expect(list).toEqual([
    { name: "code-review", description: "Revisa", hint: "[nível]" },
    { name: "usage", description: "Custo" },
  ]);
});
it("pergunta do Claude (AskUserQuestion): vira cartão de opções e as respostas voltam na entrada", async () => {
  manager.send("t1", CLAUDE, "planeje");
  const input = {
    questions: [
      { question: "Qual banco?", header: "Banco", multiSelect: false, options: [{ label: "Postgres", description: "Relacional" }, { label: "SQLite", description: "" }] },
    ],
  };
  const pending = sdk.calls[0].options.canUseTool("AskUserQuestion", input, { signal: new AbortController().signal, suggestions: [{ type: "x" }] });
  await tick();
  const approval = approvalOf();
  expect(approval).toMatchObject({
    summary: "Qual banco?",
    canAlwaysAllow: false,
    questions: [{ question: "Qual banco?", header: "Banco", multiSelect: false, options: [{ label: "Postgres", description: "Relacional" }, { label: "SQLite" }] }],
  });
  manager.answer("t1", approval.id, { "Qual banco?": "SQLite" });
  await expect(pending).resolves.toEqual({ behavior: "allow", updatedInput: { ...input, answers: { "Qual banco?": "SQLite" } } });
  expect(events.map((e) => e.event)).toContainEqual({ type: "approval_resolved", id: approval.id, behavior: "allow", answers: { "Qual banco?": "SQLite" } });
});
it("pergunta pulada (ou permitida sem resposta) volta como negada", async () => {
  manager.send("t1", CLAUDE, "planeje");
  const input = { questions: [{ question: "A ou B?", header: "", multiSelect: false, options: [{ label: "A" }, { label: "B" }] }] };
  const pending = sdk.calls[0].options.canUseTool("AskUserQuestion", input, { signal: new AbortController().signal });
  await tick();
  manager.decide("t1", approvalOf().id, "allow", false);
  await expect(pending).resolves.toEqual({ behavior: "deny", message: "A pessoa preferiu não responder." });
});
it("pergunta vai pelo hook PreToolUse, que vale até com Ignorar permissões", async () => {
  manager.send("t1", { ...CLAUDE, permissionMode: "bypassPermissions" }, "planeje");
  const [matcher] = sdk.calls[0].options.hooks.PreToolUse;
  expect(matcher.matcher).toBe("AskUserQuestion");
  const input = { questions: [{ question: "A ou B?", header: "", multiSelect: false, options: [{ label: "A" }, { label: "B" }] }] };
  const out = matcher.hooks[0]({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: input }, "tu1", { signal: new AbortController().signal });
  await tick();
  manager.answer("t1", approvalOf().id, { "A ou B?": "B" });
  await expect(out).resolves.toEqual({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input, answers: { "A ou B?": "B" } } },
  });
  // Já respondida, o canUseTool não pergunta de novo.
  await expect(sdk.calls[0].options.canUseTool("AskUserQuestion", { ...input, answers: { "A ou B?": "B" } }, { signal: new AbortController().signal })).resolves.toMatchObject({ behavior: "allow" });
});
