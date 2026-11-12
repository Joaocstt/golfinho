import { it, expect, vi, beforeEach } from "vitest";
import type { ChatEvent, Project, Task } from "../src/shared/contracts";
import type { OfficeState } from "../src/shared/office";
// Cada consulta do Escritório recebe as mensagens que o teste preparar para aquele prompt.
const sdk = vi.hoisted(() => ({
  calls: [] as any[],
  answer: (_prompt: string): any[] => [],
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: any) => {
    sdk.calls.push(params);
    const messages = sdk.answer(params.prompt);
    return (async function* () {
      for (const m of messages) yield m;
    })();
  },
}));
import { Office, parseJson } from "../src/main/office";
import { defaultLayout } from "../src/shared/officeLayout";

const project: Project = { id: "11111111-1111-4111-8111-111111111111", name: "Golfinho", path: "C:/repo", remotes: [] };
const result = (text: string) => ({ type: "result", subtype: "success", result: text });
const tool = (name: string, input: Record<string, unknown>) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name, input }] },
});
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

// Execução pelo chat simulada: o teste diz o que o "chat" responde quando a tarefa começa.
const run = {
  sent: [] as { taskId: string; text: string }[],
  ended: [] as { taskId: string; ok: boolean }[],
  decided: [] as unknown[],
  committed: [] as unknown[],
  changes: {} as Record<string, string>,
  chat: (_taskId: string): ChatEvent[] => [{ type: "status", state: "idle" }],
};
let office!: Office;
const runDeps = () => ({
  runTask: async (taskId: string, text: string) => {
    run.sent.push({ taskId, text });
    setTimeout(() => {
      for (const e of run.chat(taskId)) office.onChat(taskId, e);
    }, 0);
  },
  endRun: (taskId: string, ok: boolean) => void run.ended.push({ taskId, ok }),
  changes: async () => run.changes,
  decide: async (...args: unknown[]) => void run.decided.push(args),
  commit: async (...args: unknown[]) => void run.committed.push(args),
});
let states: OfficeState[];
let created: { title: string; prompt: string; hint: string }[];
let saved: Map<string, unknown>;
beforeEach(() => {
  sdk.calls.length = 0;
  states = [];
  created = [];
  saved = new Map();
  run.sent = [];
  run.ended = [];
  run.decided = [];
  run.committed = [];
  run.changes = {};
  run.chat = () => [{ type: "status", state: "idle" }];
  office = new Office({
    project: (id) => {
      if (id !== project.id) throw new Error("Projeto não encontrado.");
      return project;
    },
    memory: () => "## Memória do projeto\n- usa Electron",
    createTask: async (_p, title, prompt, hint) => {
      created.push({ title, prompt, hint });
      return { id: "22222222-2222-4222-8222-222222222222" } as Task;
    },
    emit: (s) => states.push(s),
    executable: () => undefined,
    load: (id) => saved.get(id) ?? null,
    save: (id, s) => saved.set(id, JSON.parse(JSON.stringify(s))),
    ...runDeps(),
  });
});

it("lê JSON solto, em bloco de código ou com texto em volta", () => {
  expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  expect(parseJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  expect(parseJson('Claro! {"a":3} pronto')).toEqual({ a: 3 });
  expect(parseJson("sem json")).toBeNull();
});

it("encaminha para o colega certo sem criar trabalho", async () => {
  sdk.answer = () => [result('{"acao":"encaminhar","para":"carla","fala":"Isso é com a Carla!"}')];
  const decision = await office.ask(project.id, "bruno", "Cria um logo novo");
  expect(decision).toEqual({ action: "encaminhar", to: "carla", reply: "Isso é com a Carla!" });
  const s = office.state(project.id);
  expect(s.jobs).toHaveLength(0);
  expect(s.chats.bruno?.map((m) => m.who)).toEqual(["chefe", "agente"]);
  // A decisão é rápida e sem ferramentas.
  expect(sdk.calls[0].options.model).toBe("haiku");
  expect(sdk.calls[0].options.tools).toEqual([]);
});

it("encaminhar para si mesmo ou para ninguém vira pedido de detalhes", async () => {
  sdk.answer = () => [result('{"acao":"encaminhar","para":"bruno","fala":"Hmm"}')];
  expect((await office.ask(project.id, "bruno", "?")).action).toBe("esclarecer");
});

it("resposta fora do formato não quebra: o agente pede para tentar de novo", async () => {
  sdk.answer = () => [result("não sei")];
  const decision = await office.ask(project.id, "ana", "oi");
  expect(decision.action).toBe("esclarecer");
  expect(office.state(project.id).thinking).toEqual([]);
});

it("pedido aceito: faz no projeto só lendo, passa pela revisão e chega entregue", async () => {
  sdk.answer = (prompt) => {
    if (prompt.includes("Decida o que fazer"))
      return [result('{"acao":"aceitar","fala":"Bora!","titulo":"Analisar concorrentes"}')];
    if (prompt.includes("Revise com olhar crítico"))
      return [result('{"notas":["Faltava uma fonte"],"versao_final":"# Relatório revisado"}')];
    return [tool("WebSearch", { query: "concorrentes" }), result("# Relatório")];
  };
  const decision = await office.ask(project.id, "ana", "Analise os apps concorrentes");
  expect(decision.action).toBe("aceitar");
  expect(decision.jobId).toBeTruthy();
  await settle();
  const job = office.state(project.id).jobs[0];
  expect(job).toMatchObject({ status: "entregue", title: "Analisar concorrentes", result: "# Relatório revisado", notes: ["Faltava uma fonte"] });
  const work = sdk.calls[1];
  expect(work.options.cwd).toBe("C:/repo");
  expect(work.options.tools).toEqual(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);
  expect(work.options.disallowedTools).toEqual(expect.arrayContaining(["Write", "Edit", "Bash"]));
  expect(work.prompt).toContain("Memória do projeto");
  // Qualquer ferramenta fora da lista é negada sem perguntar.
  expect((await work.options.canUseTool("Write", {}, {})).behavior).toBe("deny");
  // A ação ficou no histórico em português, e a tela recebe o estado final logo depois.
  expect(job.log?.some((e) => e.text === "Pesquisando na web: concorrentes")).toBe(true);
  await new Promise((r) => setTimeout(r, 450));
  expect(states.at(-1)?.jobs[0]?.status).toBe("entregue");
});

it("pedido de código: o agente planeja, executa a tarefa pelo chat, e a revisora confere o que mudou", async () => {
  sdk.answer = (prompt) => {
    if (prompt.includes("Decida o que fazer")) return [result('{"acao":"aceitar","fala":"Deixa comigo","titulo":"Corrigir login"}')];
    if (prompt.includes("para conferir")) return [result('{"notas":["Token conferido"],"versao_final":"Login corrigido e testado."}')];
    return [result('{"titulo":"Corrigir login","branch":"corrigir-login","instrucoes":"Ajustar o auth","resumo":"O bug está no auth."}')];
  };
  run.changes = { "src/auth.ts": "modified" };
  run.chat = () => [
    { type: "assistant", blocks: [{ kind: "text", text: "Vou ajustar a validação do token." }, { kind: "tool", name: "Edit", summary: "C:/repo/src/auth.ts" }] },
    { type: "assistant", blocks: [{ kind: "text", text: "Pronto: o token expirado agora é recusado." }] },
    { type: "status", state: "idle" },
  ];
  await office.ask(project.id, "bruno", "Corrige o bug do login");
  await settle();
  expect(created).toEqual([{ title: "Corrigir login", prompt: "Ajustar o auth", hint: "corrigir-login" }]);
  expect(run.sent[0].text).toContain("Execute o plano acima agora");
  expect(run.sent[0].text).toContain("Não faça commit nem push");
  expect(run.ended).toEqual([{ taskId: "22222222-2222-4222-8222-222222222222", ok: true }]);
  const job = office.state(project.id).jobs[0];
  expect(job).toMatchObject({ status: "entregue", taskId: "22222222-2222-4222-8222-222222222222", result: "Login corrigido e testado." });
  expect(job.changed).toEqual([{ path: "src/auth.ts", kind: "modified" }]);
  const texts = job.log?.map((e) => e.text) ?? [];
  expect(texts).toContain("Vou ajustar a validação do token.");
  expect(texts).toContain("Editando auth.ts (src)");
  // A revisora recebe a lista do que mudou.
  expect(sdk.calls.at(-1).prompt).toContain("src/auth.ts (modified)");
});

it("pedido de permissão aparece no Escritório e a resposta do chefe vai para o chat", async () => {
  sdk.answer = (prompt) =>
    prompt.includes("Decida o que fazer")
      ? [result('{"acao":"aceitar","fala":"Ok","titulo":"Rodar testes"}')]
      : [result('{"titulo":"Rodar testes","branch":"testes","instrucoes":"Rodar","resumo":"r"}')];
  run.chat = () => [{ type: "approval", id: "ap1", toolName: "Bash", summary: "npm test", canAlwaysAllow: true }];
  office.saveLayout(project.id, { ...defaultLayout(), reviewer: null });
  await office.ask(project.id, "bruno", "Roda os testes");
  await settle();
  const job = office.state(project.id).jobs[0];
  expect(job.status).toBe("fazendo");
  expect(job.approval).toEqual({ id: "ap1", tool: "Bash", text: "Rodando: npm test", canAlways: true });
  expect(job.speech).toBe("Chefe, posso? Rodando: npm test");
  await office.decidePermission(project.id, job.id, "allow", false);
  expect(run.decided).toEqual([["22222222-2222-4222-8222-222222222222", "ap1", "allow", false]]);
  office.onChat("22222222-2222-4222-8222-222222222222", { type: "approval_resolved", id: "ap1", behavior: "allow" });
  office.onChat("22222222-2222-4222-8222-222222222222", { type: "status", state: "idle" });
  await settle();
  expect(office.state(project.id).jobs[0]).toMatchObject({ status: "entregue" });
  expect(office.state(project.id).jobs[0].approval).toBeUndefined();
});

it("execução que dá erro devolve a tarefa como falha e marca o trabalho", async () => {
  sdk.answer = (prompt) =>
    prompt.includes("Decida o que fazer")
      ? [result('{"acao":"aceitar","fala":"Ok","titulo":"X"}')]
      : [result('{"titulo":"X","branch":"x","instrucoes":"X","resumo":"x"}')];
  run.chat = () => [{ type: "status", state: "error", message: "A execução terminou com erro." }];
  await office.ask(project.id, "bruno", "Faz X");
  await settle();
  expect(run.ended[0]).toMatchObject({ ok: false });
  expect(office.state(project.id).jobs[0]).toMatchObject({ status: "erro" });
});

it("commit pelo Escritório leva os arquivos alterados e o título do pedido", async () => {
  sdk.answer = (prompt) =>
    prompt.includes("Decida o que fazer")
      ? [result('{"acao":"aceitar","fala":"Ok","titulo":"Corrigir login"}')]
      : [result('{"titulo":"Corrigir login","branch":"login","instrucoes":"Faça","resumo":"r"}')];
  run.changes = { "src/auth.ts": "modified", "tests/auth.test.ts": "untracked" };
  office.saveLayout(project.id, { ...defaultLayout(), reviewer: null });
  await office.ask(project.id, "bruno", "Corrige o login");
  await settle();
  const job = office.state(project.id).jobs[0];
  await office.commitJob(project.id, job.id);
  expect(run.committed[0]).toEqual([
    "22222222-2222-4222-8222-222222222222",
    ["src/auth.ts", "tests/auth.test.ts"],
    expect.stringContaining("Corrigir login"),
  ]);
  expect(office.state(project.id).jobs[0].committed).toBeTruthy();
});

it("falha do agente marca o trabalho com erro", async () => {
  sdk.answer = (prompt) =>
    prompt.includes("Decida o que fazer")
      ? [result('{"acao":"aceitar","fala":"Ok","titulo":"Texto"}')]
      : [{ type: "result", subtype: "error_max_turns" }];
  await office.ask(project.id, "davi", "Escreve o README");
  await settle();
  expect(office.state(project.id).jobs[0]).toMatchObject({ status: "erro" });
});

it("marcar como lido vale para o que já chegou na mesa", async () => {
  sdk.answer = (prompt) =>
    prompt.includes("Decida o que fazer")
      ? [result('{"acao":"aceitar","fala":"Ok","titulo":"Revisar"}')]
      : [result("Tudo certo")];
  await office.ask(project.id, "eva", "Revisa o README");
  await settle();
  // Pedido feito à revisora não passa por outra revisão.
  expect(sdk.calls).toHaveLength(2);
  expect(office.markRead(project.id).jobs[0].read).toBe(true);
});

it("projeto desconhecido é recusado", () => {
  expect(() => office.state("33333333-3333-4333-8333-333333333333")).toThrow("Projeto não encontrado.");
});

it("sala com problema não é salva; sala válida troca a equipe", () => {
  const broken = { ...defaultLayout(), furniture: defaultLayout().furniture.filter((f) => f.kind !== "chefe") };
  expect(() => office.saveLayout(project.id, broken)).toThrow(/Mesa do chefe/);
  const small = { ...defaultLayout(), agents: defaultLayout().agents.filter((a) => a.id === "bruno"), reviewer: null };
  expect(office.saveLayout(project.id, small).layout.agents.map((a) => a.id)).toEqual(["bruno"]);
});

it("sem revisor, a entrega vai direto para a mesa do chefe", async () => {
  office.saveLayout(project.id, { ...defaultLayout(), reviewer: null });
  sdk.answer = (prompt) =>
    prompt.includes("Decida o que fazer") ? [result('{"acao":"aceitar","fala":"Ok","titulo":"Texto"}')] : [result("Pronto")];
  await office.ask(project.id, "davi", "Escreve o README");
  await settle();
  expect(office.state(project.id).jobs[0]).toMatchObject({ status: "entregue", result: "Pronto" });
  expect(sdk.calls).toHaveLength(2);
});

it("o escritório volta salvo, e o que estava andando aparece como interrompido", async () => {
  sdk.answer = (prompt) =>
    prompt.includes("Decida o que fazer") ? [result('{"acao":"aceitar","fala":"Ok","titulo":"Pesquisa"}')] : [];
  office.saveLayout(project.id, {
    ...defaultLayout(),
    agents: defaultLayout().agents.map((a) => (a.id === "ana" ? { ...a, name: "Aninha" } : a)),
  });
  await office.ask(project.id, "ana", "Pesquisa algo");
  office.stop();
  const again = new Office({
    project: () => project,
    memory: () => null,
    createTask: async () => ({}) as Task,
    emit: () => undefined,
    executable: () => undefined,
    load: (id) => saved.get(id) ?? null,
    save: () => undefined,
    ...runDeps(),
  });
  const s = again.state(project.id);
  expect(s.layout.agents.find((a) => a.id === "ana")?.name).toBe("Aninha");
  expect(s.chats.ana?.length).toBeGreaterThan(0);
  expect(s.jobs[0]).toMatchObject({ status: "erro", agentName: "Aninha" });
  expect(s.jobs[0].error).toMatch(/Interrompido/);
});

it("cada trabalho guarda o passo a passo para o telão", async () => {
  sdk.answer = (prompt) => {
    if (prompt.includes("Decida o que fazer")) return [result('{"acao":"aceitar","fala":"Ok","titulo":"Corrigir login"}')];
    if (prompt.includes("para conferir")) return [result('{"notas":["ok"],"versao_final":"Feito"}')];
    return [tool("Read", { file_path: "src/auth.ts" }), result('{"titulo":"Corrigir login","branch":"login","instrucoes":"Faça","resumo":"Feito"}')];
  };
  await office.ask(project.id, "bruno", "Corrige o login");
  await settle();
  const job = office.state(project.id).jobs[0];
  const kinds = job.log?.map((e) => e.kind) ?? [];
  expect(kinds[0]).toBe("pedido");
  expect(kinds).toEqual(expect.arrayContaining(["inicio", "ferramenta", "tarefa", "revisao", "fim"]));
  expect(kinds.at(-1)).toBe("fim");
  expect(job.log?.find((e) => e.kind === "ferramenta")).toMatchObject({ who: "Bruno", text: "Lendo auth.ts (src)", detail: "Read src/auth.ts" });
  expect(job.startedAt).toBeTruthy();
  expect(job.finishedAt).toBeTruthy();
});

it("o que o agente escreve entre as ferramentas vira a fala do balão", async () => {
  sdk.answer = (prompt) =>
    prompt.includes("Decida o que fazer")
      ? [result('{"acao":"aceitar","fala":"Ok","titulo":"Texto"}')]
      : [
          {
            type: "assistant",
            message: {
              content: [
                { type: "text", text: "Vou ver como o README explica a instalação. Depois escrevo." },
                { type: "tool_use", name: "Read", input: { file_path: "C:/repo/README.md" } },
              ],
            },
          },
          result("Pronto"),
        ];
  office.saveLayout(project.id, { ...defaultLayout(), reviewer: null });
  await office.ask(project.id, "davi", "Melhora o README");
  await settle();
  const log = office.state(project.id).jobs[0].log ?? [];
  expect(log.find((e) => e.kind === "fala")?.text).toBe("Vou ver como o README explica a instalação.");
  expect(sdk.calls[1].prompt).toContain("escreva UMA frase curta em primeira pessoa");
});

it("numa rajada de ações, a tela recebe poucos estados, e sempre o último", async () => {
  sdk.answer = (prompt) =>
    prompt.includes("Decida o que fazer")
      ? [result('{"acao":"aceitar","fala":"Ok","titulo":"Varredura"}')]
      : [...Array.from({ length: 40 }, (_, i) => tool("Read", { file_path: `src/f${i}.ts` })), result("Pronto")];
  office.saveLayout(project.id, { ...defaultLayout(), reviewer: null });
  states.length = 0;
  await office.ask(project.id, "davi", "Lê tudo");
  await settle();
  await new Promise((r) => setTimeout(r, 450));
  expect(states.length).toBeLessThan(10);
  expect(states.at(-1)?.jobs[0]).toMatchObject({ status: "entregue", result: "Pronto" });
  expect(office.state(project.id).jobs[0].log?.filter((e) => e.kind === "ferramenta")).toHaveLength(40);
});
