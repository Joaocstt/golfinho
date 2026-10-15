import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { Provider, Settings, AgentInfo } from "../shared/contracts";
// Retomar reabre a conversa existente e por isso não reenvia o prompt: mandá-lo de
// novo faria o agente refazer a tarefa desde o início.
export function invocation(
  provider: Provider,
  path: string,
  prompt: string,
  resume?: string | null,
) {
  switch (provider) {
    case "codex": {
      // As mesmas flags de sandbox e aprovação valem para o subcomando resume.
      const flags = [
        "--no-alt-screen",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--cd",
        path,
      ];
      // Sem instruções a CLI abre vazia, em vez de receber uma mensagem em branco.
      const first = prompt ? ["--", prompt] : [];
      return { args: resume ? ["resume", resume, ...flags] : [...flags, ...first] };
    }
    case "claude":
      return {
        args: resume
          ? ["--permission-mode", "manual", "--resume", resume]
          : ["--permission-mode", "manual", ...(prompt ? ["--", prompt] : [])],
      };
    case "antigravity":
      return {
        args: resume
          ? ["--conversation", resume]
          : prompt
            ? ["--prompt-interactive", prompt]
            : [],
      };
  }
}
export function executablePath(command: string): string | null {
  const candidates = isAbsolute(command)
    ? [command]
    : command.includes("/")
      ? []
      : (process.env.PATH ?? "").split(delimiter).map((p) => join(p, command));
  for (const p of candidates) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* next path */
    }
  }
  return null;
}
export function agentInfo(s: Settings): AgentInfo[] {
  return (["codex", "claude", "antigravity"] as Provider[]).map((provider) => ({
    provider,
    label: { codex: "Codex", claude: "Claude Code", antigravity: "Antigravity" }[provider],
    executable: s.executables[provider],
    available: executablePath(s.executables[provider]) !== null,
  }));
}
