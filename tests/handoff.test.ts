import { describe, it, expect } from "vitest";
import { buildHandoff, withHandoff, HANDOFF_LIMIT } from "../src/main/handoff";
import type { ChatEvent } from "../src/shared/contracts";

const user = (text: string): { event: ChatEvent } => ({ event: { type: "user", text } });
const reply = (...texts: string[]): { event: ChatEvent } => ({
  event: {
    type: "assistant",
    blocks: texts.map((text) => ({ kind: "text" as const, text })),
  },
});
const base = { prompt: "Corrija o login", fromLabel: "Claude Code", history: [], files: [], checks: [] };

describe("buildHandoff", () => {
  it("devolve null quando não há conversa, arquivos nem checks", () => {
    expect(buildHandoff(base)).toBeNull();
  });

  it("inclui o pedido original e o agente de origem", () => {
    const text = buildHandoff({ ...base, files: ["src/login.ts"] })!;
    expect(text).toContain("Você está assumindo uma tarefa que Claude Code começou");
    expect(text).toContain("Pedido original:\nCorrija o login");
    expect(text).toContain("- src/login.ts");
  });

  it("usa só as últimas 5 mensagens do usuário, na ordem em que foram enviadas", () => {
    const history = Array.from({ length: 8 }, (_, i) => user(`mensagem ${i + 1}`));
    const text = buildHandoff({ ...base, history })!;
    expect(text).not.toContain("mensagem 1\n");
    expect(text).not.toContain("mensagem 3\n");
    expect(text).toContain("- mensagem 4");
    expect(text.indexOf("- mensagem 4")).toBeLessThan(text.indexOf("- mensagem 8"));
  });

  it("ignora mensagens vazias do usuário", () => {
    const text = buildHandoff({ ...base, history: [user("   "), user("útil")] })!;
    expect(text).toContain("- útil");
    expect(text).not.toContain("Mensagens suas na conversa anterior:\n- \n");
  });

  it("corta mensagens longas do usuário", () => {
    const text = buildHandoff({ ...base, history: [user("x".repeat(2000))] })!;
    expect(text).toContain("…");
    expect(text).not.toContain("x".repeat(600));
  });

  it("usa a última resposta de texto do agente e ignora chamadas de ferramenta", () => {
    const history = [
      reply("primeira resposta"),
      { event: { type: "assistant", blocks: [{ kind: "tool", name: "Bash", summary: "npm test" }] } as ChatEvent },
      reply("resposta final"),
    ];
    const text = buildHandoff({ ...base, history })!;
    expect(text).toContain("Última resposta de Claude Code:\nresposta final");
    expect(text).not.toContain("primeira resposta");
    expect(text).not.toContain("npm test");
  });

  it("junta os blocos de texto de uma mesma resposta", () => {
    const text = buildHandoff({ ...base, history: [reply("parte A", "parte B")] })!;
    expect(text).toContain("parte A\n\nparte B");
  });

  it("lista até 40 arquivos e diz quantos ficaram de fora", () => {
    const files = Array.from({ length: 45 }, (_, i) => `src/arquivo${i}.ts`);
    const text = buildHandoff({ ...base, files })!;
    expect(text).toContain("Arquivos alterados na branch (45):");
    expect(text).toContain("- src/arquivo39.ts");
    expect(text).not.toContain("- src/arquivo40.ts");
    expect(text).toContain("e mais 5 arquivo(s)");
  });

  it("não repete arquivo que aparece duas vezes", () => {
    const text = buildHandoff({ ...base, files: ["a.ts", "a.ts"] })!;
    expect(text).toContain("Arquivos alterados na branch (1):");
  });

  it("mostra os últimos checks com o status", () => {
    const checks = Array.from({ length: 7 }, (_, i) => ({ command: `npm run check${i}`, status: "passed" }));
    const text = buildHandoff({ ...base, checks })!;
    expect(text).toContain("Verificações recentes:\n- npm run check0: passed");
    expect(text).toContain("- npm run check4: passed");
    expect(text).not.toContain("npm run check5");
  });

  it("nunca passa do limite total", () => {
    const text = buildHandoff({
      ...base,
      history: [reply("y".repeat(5000)), user("z".repeat(400))],
      files: Array.from({ length: 40 }, (_, i) => `pasta/subpasta/arquivo-com-nome-longo-${i}.tsx`),
    })!;
    expect(text.length).toBeLessThanOrEqual(HANDOFF_LIMIT);
  });

  it("aceita um pedido vazio sem quebrar", () => {
    const text = buildHandoff({ ...base, prompt: "", files: ["a.ts"] })!;
    expect(text).toContain("(sem instruções)");
  });
});

describe("withHandoff", () => {
  it("sem pacote, devolve o texto como está", () => {
    expect(withHandoff(null, "olá")).toBe("olá");
    expect(withHandoff(undefined, "olá")).toBe("olá");
  });

  it("põe o pacote antes do texto, separado por uma linha", () => {
    expect(withHandoff("CONTEXTO", "olá")).toBe("CONTEXTO\n\n---\n\nolá");
  });

  it("sem texto, entrega só o pacote", () => {
    expect(withHandoff("CONTEXTO", "")).toBe("CONTEXTO");
    expect(withHandoff("CONTEXTO", "   ")).toBe("CONTEXTO");
  });
});
