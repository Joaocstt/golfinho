import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readQuota, isoFromLabel } from "../src/main/quota";
import type { Settings } from "../src/shared/contracts";
let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "golfinho-quota-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function fake(nome: string, corpo: string) {
  const caminho = join(dir, nome);
  writeFileSync(caminho, "#!/bin/bash\n" + corpo);
  chmodSync(caminho, 0o700);
  return caminho;
}
const settings = (provider: string, caminho: string): Settings =>
  ({
    concurrency: 2,
    executables: { codex: "codex", claude: "claude", antigravity: "agy", [provider]: caminho },
  }) as Settings;

it("lê as duas janelas do Codex classificando pela duração declarada", async () => {
  // Resposta gravada do app-server real, que responde ao id 2 após o initialize.
  const caminho = fake(
    "codex",
    `while read -r linha; do
       case "$linha" in
         *'"id":1'*) echo '{"id":1,"result":{"codexHome":"/tmp"}}' ;;
         *rateLimits*) echo '{"id":2,"result":{"rateLimits":{"planType":"plus","primary":{"usedPercent":3,"windowDurationMins":300,"resetsAt":1792020481},"secondary":{"usedPercent":17,"windowDurationMins":10080,"resetsAt":1792501064}}}}' ;;
       esac
     done`,
  );
  const quota = await readQuota("codex", settings("codex", caminho));
  expect(quota).toMatchObject({ provider: "codex", available: true, plan: "plus", error: "" });
  expect(quota.groups[0].windows).toEqual([
    { window: "5h", usedPercent: 3, resetsAt: new Date(1792020481000).toISOString() },
    { window: "weekly", usedPercent: 17, resetsAt: new Date(1792501064000).toISOString() },
  ]);
});

it("ignora janelas do Codex cuja duração não é de 5 h nem semanal", async () => {
  const caminho = fake(
    "codex",
    `while read -r linha; do
       case "$linha" in
         *'"id":1'*) echo '{"id":1,"result":{}}' ;;
         *rateLimits*) echo '{"id":2,"result":{"rateLimits":{"primary":{"usedPercent":9,"windowDurationMins":60}}}}' ;;
       esac
     done`,
  );
  const quota = await readQuota("codex", settings("codex", caminho));
  expect(quota.available).toBe(false);
  expect(quota.error).toMatch(/5 h ou semanal/);
});

it("extrai sessão e semana do texto do Claude", async () => {
  const resultado =
    "You are currently using your subscription to power your Claude Code usage\\n\\nCurrent session: 76% used · resets Oct 14, 6:19pm (America/Rio_Branco)\\nCurrent week (all models): 13% used · resets Oct 19, 11:59am (America/Rio_Branco)\\n";
  const caminho = fake("claude", `echo '{"num_turns":0,"result":"${resultado}"}'`);
  const quota = await readQuota("claude", settings("claude", caminho));
  expect(quota.available).toBe(true);
  expect(quota.groups.map((g) => g.windows.map((w) => [w.window, w.usedPercent]))).toEqual([
    [
      ["5h", 76],
      ["weekly", 13],
    ],
  ]);
  // O rótulo vira instante: 18:19 em America/Rio_Branco (UTC-5) são 23:19 UTC.
  // A asserção ignora o ano, que o texto do Claude não traz.
  expect(quota.groups[0].windows[0].resetsAt).toMatch(/^\d{4}-10-14T23:19:00\.000Z$/);
  expect(quota.groups[0].windows[1].resetsAt).toMatch(/^\d{4}-10-19T16:59:00\.000Z$/);
});

it("não inventa número quando o texto do Claude muda de formato", async () => {
  const caminho = fake("claude", `echo '{"num_turns":0,"result":"formato totalmente diferente"}'`);
  const quota = await readQuota("claude", settings("claude", caminho));
  expect(quota.available).toBe(false);
  expect(quota.groups).toEqual([]);
  expect(quota.error).toMatch(/percentuais/i);
});

it("detecta quando /usage virou pergunta ao modelo e não insiste", async () => {
  const caminho = fake("claude", `echo '{"num_turns":1,"result":"Claro! Posso ajudar com isso."}'`);
  const quota = await readQuota("claude", settings("claude", caminho));
  expect(quota.available).toBe(false);
  expect(quota.error).toMatch(/pergunta/i);
});

it("lê os dois grupos do Antigravity convertendo fração restante em usado", async () => {
  const json = JSON.stringify({
    status: "SUCCESS",
    command: {
      name: "usage",
      data: {
        groups: [
          {
            name: "Gemini Models",
            buckets: [
              { window: "weekly", remaining_fraction: 0.9503253102302551, reset_time: "2026-10-15T15:57:02Z" },
              { window: "5h", remaining_fraction: 1, reset_time: "2026-10-15T00:44:34Z" },
            ],
          },
          {
            name: "Claude and GPT models",
            buckets: [{ window: "weekly", remaining_fraction: 0.5, reset_time: "2026-10-21T19:44:34Z" }],
          },
        ],
      },
    },
  });
  const caminho = fake("agy", `cat <<'EOF'\n${json}\nEOF`);
  const quota = await readQuota("antigravity", settings("antigravity", caminho));
  expect(quota.groups.map((g) => g.name)).toEqual(["Gemini Models", "Claude and GPT models"]);
  // 0,9503 restante vira 5% usado, arredondado.
  expect(quota.groups[0].windows).toEqual([
    { window: "weekly", usedPercent: 5, resetsAt: "2026-10-15T15:57:02Z" },
    { window: "5h", usedPercent: 0, resetsAt: "2026-10-15T00:44:34Z" },
  ]);
  expect(quota.groups[1].windows[0].usedPercent).toBe(50);
});

it("reporta executável ausente sem derrubar a leitura", async () => {
  const quota = await readQuota("codex", settings("codex", join(dir, "nao-existe")));
  expect(quota.available).toBe(false);
  expect(quota.error).toMatch(/não encontrado/i);
});

it("converte o rótulo em inglês do Claude para instante, respeitando o fuso", () => {
  const agora = Date.parse("2026-10-14T20:00:00Z");
  // America/Rio_Branco é UTC-5: 18:20 lá são 23:20 UTC.
  expect(isoFromLabel("Oct 14, 6:20pm (America/Rio_Branco)", agora)).toBe(
    "2026-10-14T23:20:00.000Z",
  );
  // Meio-dia sem minutos.
  expect(isoFromLabel("Oct 19, 12pm (America/Rio_Branco)", agora)).toBe("2026-10-19T17:00:00.000Z");
  // Sem ano no texto, janeiro visto de outubro é do ano seguinte, não do passado.
  expect(isoFromLabel("Jan 5, 9am (UTC)", agora)).toBe("2027-01-05T09:00:00.000Z");
  // Formato desconhecido ou fuso inválido preserva o texto original.
  expect(isoFromLabel("semana que vem", agora)).toBe("semana que vem");
  expect(isoFromLabel("Oct 14, 6:20pm (Nao/Existe)", agora)).toBe("Oct 14, 6:20pm (Nao/Existe)");
});
