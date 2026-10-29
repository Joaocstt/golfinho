import { readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { executablePath } from "./agents";
import type { Driver } from "./coordinator";
import { launchTarget } from "./shellCommand";
import { homedir } from "node:os";
import { wslEnv, wslLaunch, wslPath } from "./wsl";
// Encerra a CLI e os processos do mesmo grupo. Fora do Linux não há /proc para rastrear
// membros, então o grupo inteiro é sinalizado. No Windows, taskkill /T derruba a árvore.
// Resolve quando a tentativa de encerrar a árvore termina; no Windows isso é um processo filho.
export function killGroup(pid: number, signal: NodeJS.Signals): Promise<void> {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
        .on("error", () => resolve())
        .on("close", () => resolve());
    });
  }
  try {
    process.kill(-pid, signal);
  } catch {
    /* o grupo já encerrou */
  }
  return Promise.resolve();
}
function identity(pid: number) {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = s
      .slice(s.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
    return {
      start: fields[19],
      group: Number(fields[2]),
      session: Number(fields[3]),
      state: fields[0],
    };
  } catch {
    return null;
  }
}
// Variáveis de sessão do Claude Code herdadas de quem abriu o Golfinho. Com elas, a CLI filha
// acha que é sessão filha e não grava a transcrição, então não há o que retomar.
const PARENT_SESSION = /^CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|MESSAGING_)/;
// Ambiente da CLI do agente: sem resíduo da sessão de quem abriu o app, e com a transcrição
// do Claude sempre gravada, para a retomada funcionar.
export function childEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !PARENT_SESSION.test(key)) out[key] = value;
  }
  return { ...out, CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: "1", ...extra };
}
export const ptyDriver: Driver = {
  async start(command, args, cwd, data, exit, env) {
    // Pasta do WSL: o processo roda dentro da distro, com o programa instalado lá.
    const wsl = process.platform === "win32" ? wslPath(cwd) : null;
    let target: { file: string; args: string[] };
    if (wsl) target = wslLaunch(wsl, command, args);
    else {
      const path = executablePath(command);
      if (!path)
        throw new Error(
          `Executável não encontrado: ${command}. Configure seu caminho em Configurações.`,
        );
      target = launchTarget(path, args);
    }
    const pty = await import("node-pty");
    const extra = { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" };
    const childEnvironment = childEnv(process.env, extra);
    const child = pty.spawn(target.file, target.args, {
      // O wsl.exe recebe a pasta Linux em --cd; a pasta de rede não serve de cwd no Windows.
      cwd: wsl ? homedir() : cwd,
      cols: 100,
      rows: 28,
      name: "xterm-256color",
      env: wsl ? wslEnv(childEnvironment, Object.keys(extra)) : childEnvironment,
    });
    const owned = identity(child.pid);
    let ended = false;
    let stopping = false;
    let escalated = false;
    let code = 0;
    const members = new Map<number, string>();
    // Sem rastreamento por /proc, cada sinal vai ao grupo uma única vez.
    const sent = new Set<NodeJS.Signals>();
    // No Windows, o taskkill precisa terminar antes de o encerramento ser reportado.
    let treeKilled = owned !== null;
    if (owned) members.set(child.pid, owned.start);
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let monitor: ReturnType<typeof setInterval> | undefined;
    // A forkpty session remains the owned session while members exist. Never signal a
    // replacement leader with the same PID; every signal also checks the birth token.
    const observeMembers = () => {
      const leader = identity(child.pid);
      if (!owned || (leader && leader.start !== owned.start)) return;
      for (const name of readdirSync("/proc")) {
        if (!/^\d+$/.test(name)) continue;
        const pid = Number(name);
        const info = identity(pid);
        if (info && info.session === child.pid && Number(info.start) >= Number(owned.start))
          members.set(pid, info.start);
      }
    };
    const signalMembers = (signal: NodeJS.Signals) => {
      if (!owned) {
        if (!sent.has(signal)) {
          sent.add(signal);
          void killGroup(child.pid, signal).then(() => {
            treeKilled = true;
            check();
          });
        }
        return;
      }
      for (const [pid, start] of members) {
        const current = identity(pid);
        if (!current || current.start !== start || current.state === "Z") continue;
        try {
          process.kill(pid, signal);
        } catch {
          /* already gone */
        }
      }
    };
    const check = () => {
      if (stopping) observeMembers();
      if (!ended || !treeKilled) return;
      for (const [pid, start] of members) {
        const i = identity(pid);
        if (!i || i.start !== start || i.state === "Z") members.delete(pid);
      }
      if (members.size) return;
      if (killTimer) clearTimeout(killTimer);
      if (monitor) clearInterval(monitor);
      resolveClosed();
      exit(code);
    };
    const stop = () => {
      if (!stopping) {
        stopping = true;
        observeMembers();
        signalMembers("SIGTERM");
        killTimer = setTimeout(() => {
          escalated = true;
          observeMembers();
          signalMembers("SIGKILL");
          check();
        }, 1500);
        monitor = setInterval(() => {
          observeMembers();
          signalMembers(escalated ? "SIGKILL" : "SIGTERM");
          check();
        }, 50);
      }
      check();
    };
    child.onData(data);
    child.onExit(({ exitCode }) => {
      code = exitCode;
      ended = true;
      observeMembers();
      stop();
      check();
    });
    return {
      closed,
      write(text) {
        if (!ended) child.write(text);
      },
      resize(cols, rows) {
        if (!ended) child.resize(cols, rows);
      },
      stop,
    };
  },
};
