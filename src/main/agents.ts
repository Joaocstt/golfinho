import { accessSync, constants } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";
import type { Provider, Settings, AgentInfo } from "../shared/contracts";
import { MEMORY_SERVER, MEMORY_TOKEN_ENV, type McpLaunch } from "./memory";
// Opções -c do Codex que ligam o servidor da memória (CLI e app-server aceitam as mesmas).
export function codexMcpArgs(mcp: { url: string } | null | undefined): string[] {
  if (!mcp) return [];
  return [
    "-c",
    `mcp_servers.${MEMORY_SERVER}.url=${JSON.stringify(mcp.url)}`,
    "-c",
    `mcp_servers.${MEMORY_SERVER}.bearer_token_env_var=${JSON.stringify(MEMORY_TOKEN_ENV)}`,
  ];
}
// Retomar reabre a conversa existente e por isso não reenvia o prompt: mandá-lo de
// novo faria o agente refazer a tarefa desde o início.
export function invocation(
  provider: Provider,
  path: string,
  prompt: string,
  resume?: string | null,
  mcp?: McpLaunch | null,
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
      const extra = codexMcpArgs(mcp);
      return { args: resume ? ["resume", resume, ...extra, ...flags] : [...extra, ...flags, ...first] };
    }
    case "claude": {
      // --mcp-config aceita vários valores: vem antes de outra opção ou do "--", que o encerram.
      const config = mcp ? ["--mcp-config", mcp.claudeConfig] : [];
      return {
        args: resume
          ? ["--permission-mode", "manual", ...config, "--resume", resume]
          : ["--permission-mode", "manual", ...config, ...(prompt ? ["--", prompt] : [])],
      };
    }
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
// No Windows, o npm instala o mesmo comando três vezes (sem extensão, .cmd e .ps1). Só o arquivo
// sem extensão é um script de shell, que o ConPTY não executa (erro 193), então é preciso
// procurar pelas extensões de PATHEXT.
const WINDOWS_EXECUTABLE_EXTENSIONS: string[] = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
  .split(";")
  .map((ext) => ext.toLowerCase())
  .filter((ext) => ext === ".exe" || ext === ".cmd" || ext === ".bat" || ext === ".com");
export function executablePath(command: string): string | null {
  const candidates = isAbsolute(command)
    ? [command]
    : command.includes("/") || command.includes("\\")
      ? []
      : (process.env.PATH ?? "").split(delimiter).map((p) => join(p, command));
  for (const p of candidates) {
    if (process.platform !== "win32") {
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch {
        /* next path */
      }
      continue;
    }
    const withExtension = WINDOWS_EXECUTABLE_EXTENSIONS.includes(extname(p).toLowerCase());
    const files = withExtension ? [p] : WINDOWS_EXECUTABLE_EXTENSIONS.map((ext) => p + ext);
    for (const file of files) {
      try {
        accessSync(file, constants.F_OK);
        return file;
      } catch {
        /* next extension */
      }
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
