import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSession } from "../src/main/sessions";
import { invocation } from "../src/main/agents";
let home: string;
const REPO = "/repo/alvo";
const OUTRO = "/repo/outro";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "golfinho-sessions-"));
  mkdirSync(join(home, ".codex", "sessions", "2026"), { recursive: true });
  mkdirSync(join(home, ".claude", "projects", "-repo-alvo"), { recursive: true });
  mkdirSync(join(home, ".gemini", "antigravity-cli", "cache"), { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));
const escreve = (file: string, linhas: unknown[], quando?: number) => {
  writeFileSync(file, linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (quando) utimesSync(file, new Date(quando), new Date(quando));
};
const meta = (id: string, cwd: string) => ({ type: "session_meta", payload: { id, cwd } });

it("acha o id da sessão do Codex pelo cwd, ignorando outro projeto", async () => {
  const dir = join(home, ".codex", "sessions", "2026");
  escreve(join(dir, "rollout-outro.jsonl"), [meta("nao-e-essa", OUTRO)]);
  escreve(join(dir, "rollout-alvo.jsonl"), [meta("0199cf80-3b73-7252-9458-adfe7a905da5", REPO)]);
  expect(await findSession("codex", REPO, Date.now() - 1000, home)).toBe(
    "0199cf80-3b73-7252-9458-adfe7a905da5",
  );
});

it("prefere a sessão mais recente do Codex quando há várias do mesmo projeto", async () => {
  const dir = join(home, ".codex", "sessions", "2026");
  escreve(join(dir, "antiga.jsonl"), [meta("antiga", REPO)], Date.now() - 600_000);
  escreve(join(dir, "nova.jsonl"), [meta("nova", REPO)], Date.now());
  expect(await findSession("codex", REPO, Date.now() - 900_000, home)).toBe("nova");
});

it("ignora sessões anteriores ao início da execução", async () => {
  const dir = join(home, ".codex", "sessions", "2026");
  escreve(join(dir, "velha.jsonl"), [meta("velha", REPO)], Date.now() - 3 * 3600_000);
  expect(await findSession("codex", REPO, Date.now(), home)).toBeNull();
});

it("usa o nome do arquivo do Claude como id, confirmando pelo cwd", async () => {
  const dir = join(home, ".claude", "projects", "-repo-alvo");
  escreve(join(dir, "c4d2e90c-e879-4e1b-a8b2-6c8b88430527.jsonl"), [
    { type: "summary" },
    { type: "assistant", cwd: REPO, message: { id: "m1" } },
  ]);
  expect(await findSession("claude", REPO, Date.now() - 1000, home)).toBe(
    "c4d2e90c-e879-4e1b-a8b2-6c8b88430527",
  );
});

it("recusa um arquivo do Claude cujo cwd não é o do projeto", async () => {
  const dir = join(home, ".claude", "projects", "-repo-alvo");
  escreve(join(dir, "intrusa.jsonl"), [{ type: "assistant", cwd: OUTRO, message: { id: "m1" } }]);
  expect(await findSession("claude", REPO, Date.now() - 1000, home)).toBeNull();
});

it("lê o índice de conversa por diretório do Antigravity", async () => {
  writeFileSync(
    join(home, ".gemini", "antigravity-cli", "cache", "last_conversations.json"),
    JSON.stringify({ [REPO]: "f68d40c0-1920-4245-8562-d495254f1471", [OUTRO]: "outra" }),
  );
  expect(await findSession("antigravity", REPO, Date.now(), home)).toBe(
    "f68d40c0-1920-4245-8562-d495254f1471",
  );
  expect(await findSession("antigravity", "/repo/sem-conversa", Date.now(), home)).toBeNull();
});

it("devolve null sem quebrar quando não há pasta de sessões", async () => {
  for (const provider of ["codex", "claude", "antigravity"] as const)
    expect(await findSession(provider, REPO, Date.now(), join(home, "vazio"))).toBeNull();
});

it("retomar não reenvia o prompt e preserva sandbox e aprovação", () => {
  const novo = invocation("codex", REPO, "faça a tarefa");
  expect(novo.args).toContain("faça a tarefa");
  const retoma = invocation("codex", REPO, "faça a tarefa", "sessao-1");
  expect(retoma.args.slice(0, 2)).toEqual(["resume", "sessao-1"]);
  expect(retoma.args).not.toContain("faça a tarefa");
  // As travas de segurança continuam valendo no subcomando resume.
  expect(retoma.args).toEqual(expect.arrayContaining(["--sandbox", "workspace-write"]));
  expect(retoma.args).toEqual(expect.arrayContaining(["--ask-for-approval", "on-request"]));
  expect(retoma.args).toEqual(expect.arrayContaining(["--cd", REPO]));

  expect(invocation("claude", REPO, "p", "s2").args).toEqual([
    "--permission-mode",
    "manual",
    "--resume",
    "s2",
  ]);
  expect(invocation("antigravity", REPO, "p", "s3").args).toEqual(["--conversation", "s3"]);
});

it("sem instruções a CLI abre vazia, sem argumento em branco", () => {
  expect(invocation("codex", REPO, "").args).not.toContain("");
  expect(invocation("codex", REPO, "").args).not.toContain("--");
  expect(invocation("claude", REPO, "").args).toEqual(["--permission-mode", "manual"]);
  expect(invocation("antigravity", REPO, "").args).toEqual([]);
});
