import { readFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { executablePath } from "./agents";
import type { Driver } from "./coordinator";
// Encerra a CLI e os processos do mesmo grupo. Fora do Linux não há /proc para rastrear
// membros, então o grupo inteiro é sinalizado. No Windows, taskkill /T derruba a árvore.
export function killGroup(pid: number, signal: NodeJS.Signals) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
      .on("error", () => undefined);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    /* o grupo já encerrou */
  }
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
export const ptyDriver: Driver = {
  async start(command, args, cwd, data, exit, env) {
    const path = executablePath(command);
    if (!path)
      throw new Error(
        `Executável não encontrado: ${command}. Configure seu caminho em Configurações.`,
      );
    const pty = await import("node-pty");
    const child = pty.spawn(path, args, {
      cwd,
      cols: 100,
      rows: 28,
      name: "xterm-256color",
      env: { ...process.env, ...env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<
        string,
        string
      >,
    });
    const owned = identity(child.pid);
    let ended = false;
    let stopping = false;
    let escalated = false;
    let code = 0;
    const members = new Map<number, string>();
    // Sem rastreamento por /proc, cada sinal vai ao grupo uma única vez.
    const sent = new Set<NodeJS.Signals>();
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
          killGroup(child.pid, signal);
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
      if (!ended) return;
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
