import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";

// Projetos dentro do WSL, abertos pelo Golfinho do Windows. Os arquivos são lidos pelo
// caminho de rede (\\wsl.localhost\Ubuntu\home\...), mas todo comando roda dentro da
// distro pelo wsl.exe: Git, agentes, terminais, setup e checks usam o Linux, junto com
// os arquivos. Assim não há "dubious ownership", nem Node do Windows sobre node_modules
// do Linux, nem .cmd caindo em C:\Windows por não aceitar pasta de rede.

// Criado na hora: testes que substituem o child_process não precisam fornecer o execFile.
const exec = (file: string, args: string[], options: { timeout: number; windowsHide?: boolean }) =>
  promisify(execFile)(file, args, options);
export const WSL_EXE = "wsl.exe";

export interface WslPath {
  distro: string;
  /** Caminho dentro da distro, sempre absoluto ("/home/joao/projeto"). */
  linux: string;
}

// \\wsl$\Ubuntu\home\x, \\wsl.localhost\Ubuntu\home\x (também com "/" no lugar de "\").
const UNC = /^[\\/]{2}wsl(?:\$|\.localhost)[\\/]([^\\/]+)([\\/].*)?$/i;

export function wslPath(path: string): WslPath | null {
  const match = UNC.exec(path);
  if (!match) return null;
  const rest = (match[2] ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return { distro: match[1], linux: rest || "/" };
}

export function toUnc(distro: string, linux: string): string {
  return `\\\\wsl.localhost\\${distro}${linux.replace(/\//g, "\\")}`;
}

// Argumento que é um caminho do Windows vira o caminho equivalente dentro da distro:
// pasta do WSL volta a ser /home/...; disco do Windows aparece em /mnt/<letra>/.
export function linuxArg(arg: string): string {
  const inside = wslPath(arg);
  if (inside) return inside.linux;
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(arg);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`;
  return arg;
}

// O wsl.exe só repassa à distro as variáveis listadas em WSLENV.
export function wslEnv(env: Record<string, string>, keys: string[]): Record<string, string> {
  const listed = (env.WSLENV ?? "").split(":").filter(Boolean);
  const all = [...new Set([...listed, ...keys])];
  return all.length ? { ...env, WSLENV: all.join(":") } : env;
}

const base = (where: WslPath) => ["-d", where.distro, "--cd", where.linux, "--"];

// Git roda direto (fica em /usr/bin): sem shell de login, que só deixaria mais lento.
export function wslGit(where: WslPath, args: string[]) {
  return { file: WSL_EXE, args: [...base(where), "git", ...args.map(linuxArg)] };
}

// Nome do programa dentro do Linux: o caminho configurado no Windows
// (C:\...\npm\claude.cmd) não existe lá, mas o comando de mesmo nome sim.
export function linuxCommand(command: string): string {
  const name = command.split(/[\\/]/).pop() ?? command;
  return /^[A-Za-z]:|\\/.test(command) || /\.(cmd|bat|exe|ps1)$/i.test(name)
    ? name.replace(/\.(cmd|bat|exe|ps1)$/i, "")
    : command;
}

const SHELLS = /^(bash|cmd|sh)(\.exe)?$/i;

// O que o pty do Windows deveria abrir, traduzido para dentro da distro:
// - comando de setup/check (bash -lc "npm test" ou cmd /d /s /c "npm test");
// - shell interativo (bash -l ou cmd sem argumentos);
// - CLI do agente, por um bash de login, para achar o nvm e o PATH do usuário.
export function wslLaunch(where: WslPath, command: string, args: string[]) {
  const name = command.split(/[\\/]/).pop() ?? command;
  if (SHELLS.test(name)) {
    const script =
      args[0] === "-lc" ? args[1] : args[0]?.toLowerCase() === "/d" ? args[args.length - 1] : undefined;
    if (script !== undefined) return { file: WSL_EXE, args: [...base(where), "bash", "-lc", script] };
    return { file: WSL_EXE, args: [...base(where), "bash", "-l"] };
  }
  return {
    file: WSL_EXE,
    args: [...base(where), "bash", "-lc", 'exec "$0" "$@"', linuxCommand(command), ...args.map(linuxArg)],
  };
}

// Pasta pessoal do usuário na distro: as pastas das tarefas ficam nela, no disco do Linux.
const homes = new Map<string, Promise<string>>();
export function wslHome(distro: string): Promise<string> {
  let home = homes.get(distro);
  if (!home) {
    home = exec(WSL_EXE, ["-d", distro, "--", "sh", "-c", 'printf %s "$HOME"'], { timeout: 30_000 }).then(
      ({ stdout }) => {
        const value = stdout.replace(/\0/g, "").trim();
        if (!value.startsWith("/")) throw new Error(`Não foi possível ler a pasta pessoal na distro ${distro}.`);
        return value;
      },
    );
    home.catch(() => homes.delete(distro));
    homes.set(distro, home);
  }
  return home;
}

// Pasta do WSL vista pelo Golfinho do Windows. Fora do Windows, nada é WSL.
export function wslTarget(path: string): WslPath | null {
  return process.platform === "win32" ? wslPath(path) : null;
}

// Endereço do Windows que a distro alcança. No modo de rede padrão (NAT) do WSL 2, é o IP
// do adaptador "vEthernet (WSL...)"; no modo espelhado não há esse adaptador e o próprio
// 127.0.0.1 da distro chega ao Windows.
export function wslHostAddress(
  interfaces: NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>,
): string | null {
  for (const [name, list] of Object.entries(interfaces))
    if (/wsl/i.test(name))
      for (const info of list ?? []) if (info.family === "IPv4" && !info.internal) return info.address;
  return null;
}

// CLIs instaladas dentro da distro, pelo nome que teriam lá.
export async function wslCommands(distro: string, names: string[]): Promise<Set<string>> {
  const list = names.map((n) => `'${n.replace(/'/g, "'\\''")}'`).join(" ");
  const { stdout } = await exec(
    WSL_EXE,
    ["-d", distro, "--", "bash", "-lc", `for c in ${list}; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done; true`],
    { timeout: 30_000, windowsHide: true },
  );
  return new Set(stdout.replace(/\0/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
}

// Processo comum (sem terminal) dentro da distro: o chat de cada agente usa isto.
// `env` é o ambiente que o processo teria no Windows; só as variáveis de `keys` atravessam.
export function wslChild(where: WslPath, command: string, args: string[], env: NodeJS.ProcessEnv, keys: string[]) {
  const target = wslLaunch(where, command, args);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  return {
    file: target.file,
    args: target.args,
    // A pasta de rede não serve de cwd no Windows; a pasta Linux vai em --cd.
    options: { cwd: homedir(), env: wslEnv(clean, keys), windowsHide: true },
  };
}
