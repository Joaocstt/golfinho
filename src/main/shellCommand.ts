import { existsSync } from "node:fs";
import { join } from "node:path";
let cachedGitBash: string | null | undefined;
// bash do Git for Windows. O bash.exe de System32 e o de WindowsApps são o WSL, então não
// são usados. Sem o Git, o fallback é o cmd.
export function gitBash(): string | null {
  if (cachedGitBash !== undefined) return cachedGitBash;
  const roots = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Git"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Git"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Git"),
  ].filter((root): root is string => Boolean(root));
  cachedGitBash = roots.map((root) => join(root, "bin", "bash.exe")).find((p) => existsSync(p)) ?? null;
  return cachedGitBash;
}
function windowsCmd() {
  return process.env.ComSpec || "cmd.exe";
}
// Shell usado nos comandos de setup e de checks, por sistema.
export function commandShell(command: string): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const bash = gitBash();
    if (bash) return { file: bash, args: ["-lc", command] };
    return { file: windowsCmd(), args: ["/d", "/s", "/c", command] };
  }
  return { file: "/bin/bash", args: ["-lc", command] };
}
// Shell interativo da aba Shell.
export function interactiveShell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const bash = gitBash();
    return bash ? { file: bash, args: ["-l"] } : { file: windowsCmd(), args: [] };
  }
  return { file: process.env.SHELL || "/bin/bash", args: ["-l"] };
}
// Comando que executa um caminho já resolvido. No Windows, scripts .cmd/.bat só rodam pelo cmd:
// o spawn direto retorna EINVAL, e o ConPTY não os executa.
export function launchTarget(path: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(path))
    return { file: windowsCmd(), args: ["/d", "/s", "/c", path, ...args] };
  return { file: path, args };
}
