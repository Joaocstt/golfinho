import { expect, it } from "vitest";
import { CodexEvents, codexExecArgs, innerCommand } from "../src/main/codexExec";

it("monta o codex exec só leitura, com a web só para quem pesquisa", () => {
  const args = codexExecArgs("C:/repo", { web: false });
  expect(args.slice(0, 4)).toEqual(["exec", "--json", "--sandbox", "read-only"]);
  expect(args).toContain('web_search="disabled"');
  expect(args.slice(-3)).toEqual(["-C", "C:/repo", "-"]);
  expect(codexExecArgs("C:/repo", { web: true, model: "gpt-5" })).toEqual(
    expect.arrayContaining(['web_search="live"', "-m", "gpt-5"]),
  );
});

it("tira o embrulho do shell do comando", () => {
  expect(innerCommand(`"C:\WINDOWS\powershell.exe" -Command 'Get-Content -Raw package.json'`)).toBe("Get-Content -Raw package.json");
  expect(innerCommand(`/bin/bash -lc "rg login src"`)).toBe("rg login src");
  expect(innerCommand("ls")).toBe("ls");
});

it("traduz os eventos: ferramentas, narração e a resposta final", () => {
  const tools: string[] = [];
  const texts: string[] = [];
  const e = new CodexEvents({ onTool: (name, _i, raw) => tools.push(`${name} ${raw}`), onText: (t) => texts.push(t) });
  const lines = [
    { type: "thread.started", thread_id: "t" },
    { type: "item.completed", item: { id: "a", type: "agent_message", text: "Vou olhar o login." } },
    { type: "item.started", item: { id: "c", type: "command_execution", command: "bash -lc 'rg login'" } },
    { type: "item.completed", item: { id: "c", type: "command_execution", command: "bash -lc 'rg login'" } },
    { type: "item.completed", item: { id: "w", type: "web_search", query: "jwt expirado" } },
    { type: "item.completed", item: { id: "b", type: "agent_message", text: "Pronto: o token não é renovado." } },
    { type: "turn.completed", usage: {} },
  ];
  for (const l of lines) e.line(JSON.stringify(l));
  e.line("lixo que não é JSON");
  expect(tools).toEqual(["Bash rg login", "WebSearch jwt expirado"]);
  expect(texts).toEqual(["Vou olhar o login."]);
  expect(e.done).toBe(true);
  expect(e.last).toBe("Pronto: o token não é renovado.");
});

it("guarda o motivo da falha", () => {
  const e = new CodexEvents({});
  e.line(JSON.stringify({ type: "turn.failed", error: { message: "Not logged in" } }));
  expect(e.error).toBe("Not logged in");
  expect(e.done).toBe(false);
});
