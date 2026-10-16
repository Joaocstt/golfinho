import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { executablePath } from "./agents";
import { launchTarget } from "./shellCommand";
import type { Provider, ProviderQuota, QuotaGroup, QuotaWindow, Settings } from "../shared/contracts";
const TIMEOUT = 30_000;
// Cada fornecedor responde pela própria CLI. O Golfinho não lê credencial nem fala
// com a API de ninguém; e nenhuma destas chamadas consome tokens do plano.
function run(
  command: string,
  args: string[],
  handle: (send: (line: string) => void, line: string, done: (value: unknown) => void) => void,
  open?: string,
): Promise<unknown> {
  const path = executablePath(command);
  if (!path) throw new Error(`Executável não encontrado: ${command}.`);
  return new Promise((resolve, reject) => {
    const target = launchTarget(path, args);
    const child = spawn(target.file, target.args, { stdio: ["pipe", "pipe", "pipe"] });
    let settled = false;
    let stderr = "";
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error(`${command} não respondeu em ${TIMEOUT / 1000}s.`)),
      TIMEOUT,
    );
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", (error) => finish(error));
    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      if (settled) return;
      try {
        handle((text) => child.stdin.write(text + "\n"), line, (value) => finish(null, value));
      } catch (error) {
        finish(error as Error);
      }
    });
    // "close" só chega depois da última linha; desistir no "exit" do processo
    // descartaria uma resposta já escrita mas ainda não entregue.
    reader.on("close", () =>
      finish(new Error(stderr.trim().slice(0, 300) || `${command} encerrou sem resposta.`)),
    );
    // Protocolos como o app-server só falam depois de serem chamados.
    if (open) child.stdin.write(open + "\n");
  });
}
// JSON.parse cru vaza "Unexpected token" para a interface; o usuário precisa saber
// que o executável configurado não é a CLI esperada.
function parse(line: string, command: string) {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`A resposta de ${command} não é JSON. Confira o caminho em Configurações.`);
  }
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Converte um horário de parede num fuso IANA para o instante real: formata o
// palpite naquele fuso e corrige pela diferença encontrada.
function instant(year: number, month: number, day: number, hour: number, minute: number, zone: string) {
  const guess = Date.UTC(year, month, day, hour, minute);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(guess))
      .map((part) => [part.type, part.value]),
  );
  const seen = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
  );
  return guess - (seen - guess);
}
// O Claude escreve "Oct 14, 6:20pm (America/Rio_Branco)" — sem ano. Vira ISO para a
// interface poder mostrar em pt-BR; sem conseguir, o rótulo cru é preservado.
export function isoFromLabel(label: string, now = Date.now()): string {
  const found = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?/i.exec(
    label.trim(),
  );
  if (!found) return label;
  const month = MONTHS.indexOf(found[1].toLowerCase());
  if (month < 0) return label;
  const hour12 = Number(found[3]) % 12;
  const hour = /pm/i.test(found[5]) ? hour12 + 12 : hour12;
  const zone = found[6] || "UTC";
  try {
    const year = new Date(now).getUTCFullYear();
    let at = instant(year, month, Number(found[2]), hour, Number(found[4] ?? 0), zone);
    // Sem ano no texto, uma data muito atrás é virada de ano, não passado distante.
    if (at < now - 180 * 86400_000) at = instant(year + 1, month, Number(found[2]), hour, Number(found[4] ?? 0), zone);
    return isFinite(at) ? new Date(at).toISOString() : label;
  } catch {
    return label;
  }
}
const windowOf = (minutes: number): QuotaWindow["window"] | null =>
  minutes >= 240 && minutes <= 420 ? "5h" : minutes >= 8640 && minutes <= 11520 ? "weekly" : null;
const clamp = (percent: number) => Math.max(0, Math.min(100, Math.round(percent)));
// Codex: protocolo app-server, cujo schema a própria CLI gera. A janela é
// classificada pela duração declarada, não pela posição no objeto.
async function codex(command: string): Promise<Omit<ProviderQuota, "provider">> {
  const result = (await run(command, ["app-server"], (send, line, done) => {
    const message = parse(line, command);
    if (message.id === 1)
      send(
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} }),
      );
    if (message.id === 2) {
      if (message.error) throw new Error(String(message.error?.message ?? "erro no app-server"));
      done(message.result);
    }
  },
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "golfinho", title: "Golfinho", version: "0.1.0" } },
  }))) as Record<string, any>;
  const limits = result?.rateLimits ?? {};
  const windows: QuotaWindow[] = [];
  for (const slot of [limits.primary, limits.secondary]) {
    if (!slot || typeof slot.usedPercent !== "number") continue;
    const kind = windowOf(Number(slot.windowDurationMins));
    if (!kind) continue;
    windows.push({
      window: kind,
      usedPercent: clamp(slot.usedPercent),
      resetsAt: typeof slot.resetsAt === "number" ? new Date(slot.resetsAt * 1000).toISOString() : "",
    });
  }
  return {
    available: windows.length > 0,
    plan: typeof limits.planType === "string" ? limits.planType : "",
    groups: windows.length ? [{ name: "", windows }] : [],
    error: windows.length ? "" : "A CLI não informou janelas de 5 h ou semanal.",
  };
}
// Claude só expõe isso como texto no /usage. Percentuais saem por leitura tolerante;
// se o formato mudar, vira erro em vez de número inventado.
async function claude(command: string): Promise<Omit<ProviderQuota, "provider">> {
  const payload = (await run(
    command,
    ["-p", "/usage", "--output-format", "json"],
    (_send, line, done) => done(parse(line, command)),
  )) as Record<string, any>;
  const text = String(payload?.result ?? "");
  // num_turns > 0 significa que /usage virou conversa com o modelo: não insistir.
  if (Number(payload?.num_turns ?? 0) > 0)
    return {
      available: false,
      plan: "",
      groups: [],
      error: "A CLI tratou /usage como pergunta em vez de comando.",
    };
  const read = (pattern: RegExp): QuotaWindow | null => {
    const found = pattern.exec(text);
    if (!found) return null;
    return {
      window: "5h",
      usedPercent: clamp(Number(found[1])),
      resetsAt: isoFromLabel((found[2] ?? "").trim()),
    };
  };
  const session = read(/current session:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\n]+))?/i);
  const week = read(/current week[^:\n]*:\s*(\d+)%\s*used(?:\s*·\s*resets\s*([^\n]+))?/i);
  const windows: QuotaWindow[] = [];
  if (session) windows.push(session);
  if (week) windows.push({ ...week, window: "weekly" });
  return {
    available: windows.length > 0,
    plan: /subscription/i.test(text) ? "assinatura" : "",
    groups: windows.length ? [{ name: "", windows }] : [],
    error: windows.length ? "" : "Não foi possível ler os percentuais na resposta da CLI.",
  };
}
// Antigravity devolve grupos de modelos, cada um com as duas janelas.
async function antigravity(command: string): Promise<Omit<ProviderQuota, "provider">> {
  const payload = (await run(
    command,
    ["-p", "/usage", "--output-format", "json", "--print-timeout", "20s"],
    (_send, line, done) => done(parse(line, command)),
  )) as Record<string, any>;
  if (payload?.command?.name !== "usage")
    return {
      available: false,
      plan: "",
      groups: [],
      error: "A CLI tratou /usage como pergunta em vez de comando.",
    };
  const groups: QuotaGroup[] = [];
  for (const group of payload.command.data?.groups ?? []) {
    const windows: QuotaWindow[] = [];
    for (const bucket of group?.buckets ?? []) {
      const kind = bucket?.window === "5h" ? "5h" : bucket?.window === "weekly" ? "weekly" : null;
      if (!kind || typeof bucket.remaining_fraction !== "number") continue;
      windows.push({
        window: kind,
        usedPercent: clamp((1 - bucket.remaining_fraction) * 100),
        resetsAt: typeof bucket.reset_time === "string" ? bucket.reset_time : "",
      });
    }
    if (windows.length) groups.push({ name: String(group?.name ?? ""), windows });
  }
  return {
    available: groups.length > 0,
    plan: "",
    groups,
    error: groups.length ? "" : "A CLI não informou janelas de 5 h ou semanal.",
  };
}
const readers: Record<Provider, (command: string) => Promise<Omit<ProviderQuota, "provider">>> = {
  codex,
  claude,
  antigravity,
};
export async function readQuota(provider: Provider, settings: Settings): Promise<ProviderQuota> {
  try {
    return { provider, ...(await readers[provider](settings.executables[provider])) };
  } catch (error) {
    return {
      provider,
      available: false,
      plan: "",
      groups: [],
      error: (error as Error).message.slice(0, 300),
    };
  }
}
