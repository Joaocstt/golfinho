import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
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
// Atalho .cmd que o npm instala: ele só chama o programa de verdade, um .exe (Claude Code) ou
// um .js rodado pelo node (Codex). Rodar esse programa direto evita o cmd.exe, que corta os
// argumentos na primeira quebra de linha: um prompt de várias linhas chegava só pela metade.
export function npmShimTarget(path: string): { file: string; args: string[] } | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const line = text.split(/\r?\n/).find((l) => l.includes("%*") && /%dp0%/i.test(l));
  const found = line && [...line.matchAll(/"%dp0%\\?([^"]+)"/gi)].at(-1)?.[1];
  if (!found) return null;
  const target = join(dirname(path), found);
  if (!existsSync(target)) return null;
  if (/\.exe$/i.test(target)) return { file: target, args: [] };
  if (!/\.(c|m)?js$/i.test(target)) return null;
  const local = join(dirname(path), "node.exe");
  const node = existsSync(local)
    ? local
    : (process.env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((dir) => join(dir, "node.exe"))
        .find((candidate) => existsSync(candidate));
  return node ? { file: node, args: [target] } : null;
}
// Comando que executa um caminho já resolvido. No Windows, scripts .cmd/.bat só rodam pelo cmd:
// o spawn direto retorna EINVAL, e o ConPTY não os executa. Atalho do npm vira o programa real;
// fora isso, as quebras de linha viram espaço para o cmd não cortar o argumento.
export function launchTarget(path: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(path)) {
    const shim = npmShimTarget(path);
    if (shim) return { file: shim.file, args: [...shim.args, ...args] };
    return { file: windowsCmd(), args: ["/d", "/s", "/c", path, ...args.map((a) => a.replace(/\r?\n/g, " "))] };
  }
  return { file: path, args };
}
