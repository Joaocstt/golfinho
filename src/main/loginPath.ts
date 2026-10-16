import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
// Apps abertos pelo Finder ou pelo Dock não herdam o PATH do Terminal: CLIs instaladas por
// Homebrew, npm global ou ~/.local/bin não aparecem. Usamos o PATH do shell de login.
const MARK = "__GOLFINHO_PATH__";
export function readLoginPath(shell = process.env.SHELL || "/bin/zsh"): string | null {
  try {
    const out = execFileSync(shell, ["-ilc", `printf '${MARK}%s${MARK}' "$PATH"`], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = out.split(MARK)[1];
    return match?.trim() || null;
  } catch {
    return null;
  }
}
// Junta o PATH do login, o atual e os diretórios comuns de instalação, sem repetições.
export function mergePath(current: string | undefined, login: string | null, home = homedir()): string {
  const parts = [
    ...(login ?? "").split(":"),
    ...(current ?? "").split(":"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    `${home}/.local/bin`,
  ];
  return [...new Set(parts.filter(Boolean))].join(":");
}
