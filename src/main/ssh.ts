import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { SshConnection, SshListing, SshRoots } from "../shared/contracts";
const execute = promisify(execFile);
const MAX_ENTRIES = 2000;
// Arquivos maiores que isto não são abertos pela árvore remota.
export const MAX_REMOTE_FILE = 512 * 1024;
type Runner = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env: Record<string, string> },
) => Promise<{ stdout: string }>;
// Script de SSH_ASKPASS: lê a senha da variável do processo. O arquivo não tem segredo.
let askpassPath = "";
export function configureAskpass(path: string) {
  askpassPath = path;
}
export const ASKPASS_SCRIPT = '#!/bin/sh\nprintf \'%s\\n\' "$GOLFINHO_SSH_PASS"\n';
// Ambiente que entrega a senha ao ssh só neste processo. Nada vai para argumentos ou disco.
export function sshEnv(password: string | null): Record<string, string> {
  if (!password) return {};
  return {
    SSH_ASKPASS: askpassPath,
    SSH_ASKPASS_REQUIRE: "force",
    GOLFINHO_SSH_PASS: password,
  };
}
// Argumentos do ssh para um perfil. A autenticação é do próprio ssh (chave, agente ou o
// prompt no terminal). Nada disso passa pelos argumentos com senha.
export function sshArgs(connection: SshConnection, batch = false): string[] {
  const args = ["-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30"];
  // Em consultas automáticas o ssh não pode pedir nada: sem chave ou senha, falha com aviso.
  if (batch) args.push("-o", "BatchMode=yes");
  args.push("-p", String(connection.port));
  if (connection.identityFile) args.push("-i", connection.identityFile);
  args.push(`${connection.user}@${connection.host}`);
  return args;
}
// Escapa um texto para o shell do servidor: aspas simples, sem interpretação.
export function remoteQuote(text: string) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}
// Executa um comando no servidor e devolve a saída. Os erros viram mensagens em português.
export async function remoteRun(
  connection: SshConnection,
  command: string,
  password: string | null,
  run: Runner = execute,
): Promise<string> {
  try {
    // Com senha guardada o ssh pode usar o askpass; sem ela, não pede nada.
    const { stdout } = await run("ssh", [...sshArgs(connection, !password), "--", command], {
      timeout: 20_000,
      maxBuffer: MAX_REMOTE_FILE + 64 * 1024,
      env: { ...(process.env as Record<string, string>), ...sshEnv(password) },
    });
    return stdout;
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? (error as Error).message).trim();
    const last = stderr.split("\n").pop() ?? stderr;
    throw new Error(
      /Permission denied|publickey|Could not resolve|Connection refused|timed out/i.test(stderr)
        ? `Não foi possível conectar: ${last}. ${password ? "A senha guardada pode estar errada." : "Se o servidor pede senha, guarde-a no perfil ou configure uma chave."}`
        : `Não foi possível concluir no servidor: ${last.slice(0, 300)}`,
    );
  }
}
// Lista uma pasta remota. Pastas primeiro, em ordem alfabética. Sem caminho, usa o home.
export async function remoteList(
  connection: SshConnection,
  path: string,
  password: string | null = null,
  run: Runner = execute,
): Promise<SshListing> {
  const command = path ? `cd -- ${remoteQuote(path)} && pwd && ls -1Ap` : "cd && pwd && ls -1Ap";
  const stdout = await remoteRun(connection, command, password, run);
  const [remotePath = "", ...names] = stdout.split("\n");
  const entries = names
    .filter((name) => name.length > 0)
    .map((name) =>
      name.endsWith("/")
        ? { name: name.slice(0, -1), kind: "directory" as const }
        : { name, kind: "file" as const },
    )
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1,
    );
  return {
    path: remotePath.trim(),
    entries: entries.slice(0, MAX_ENTRIES),
    truncated: entries.length > MAX_ENTRIES,
  };
}
// Lê um arquivo remoto só para visualizar: recusa binário e arquivo grande.
export async function remoteRead(
  connection: SshConnection,
  path: string,
  password: string | null = null,
  run: Runner = execute,
): Promise<string> {
  const quoted = remoteQuote(path);
  const command = `test -f ${quoted} && [ "$(stat -c %s -- ${quoted})" -le ${MAX_REMOTE_FILE} ] && cat -- ${quoted}`;
  const content = await remoteRun(connection, command, password, run).catch((error: Error) => {
    throw new Error(
      `Não foi possível abrir o arquivo. Ele pode ser grande (limite de ${MAX_REMOTE_FILE / 1024} KiB) ou não ser um arquivo comum. ${error.message}`,
    );
  });
  if (content.includes("\0")) throw new Error("Arquivo binário: a visualização não é possível.");
  return content;
}

// Sistemas virtuais não são discos: escondê-los deixa só o que você realmente acessa.
const VIRTUAL = /^\/(proc|sys|dev|run|snap|var\/snap|var\/lib\/docker|var\/lib\/containers)(\/|$)/;
// Descobre o home e os discos/pontos de montagem do servidor, numa única conexão.
export async function remoteRoots(
  connection: SshConnection,
  password: string | null = null,
  run: Runner = execute,
): Promise<SshRoots> {
  const command =
    "cd && pwd && (findmnt -rn -o TARGET 2>/dev/null || df -P 2>/dev/null | tail -n +2 | awk '{print $6}')";
  const stdout = await remoteRun(connection, command, password, run);
  const [home = "", ...rest] = stdout.split("\n").map((line) => line.trim());
  const mounts = [...new Set(["/", ...rest.filter((m) => m.startsWith("/") && !VIRTUAL.test(m))])].sort(
    (a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)),
  );
  return { home, mounts };
}

// Escrita precisa do conteúdo pelo stdin: nada de texto do arquivo em argumentos.
export function runWithInput(
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env: Record<string, string>; input: string },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeout);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxBuffer) child.kill("SIGKILL");
      else stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(Object.assign(error, { stderr }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout });
      else reject(Object.assign(new Error(`ssh saiu com código ${code}`), { stderr }));
    });
    child.stdin.end(options.input, "utf8");
  });
}
// Data de modificação do arquivo remoto: é o que detecta alteração feita por outra pessoa.
export async function remoteStat(
  connection: SshConnection,
  path: string,
  password: string | null = null,
  run: Runner = execute,
): Promise<number> {
  const stdout = await remoteRun(connection, `stat -c %Y -- ${remoteQuote(path)}`, password, run);
  const mtime = Number(stdout.trim());
  if (!Number.isFinite(mtime)) throw new Error("Não foi possível ler a data do arquivo no servidor.");
  return mtime;
}
// Salva o arquivo no servidor. Antes, confere que ele não mudou desde a leitura, copia o
// original para um backup na mesma pasta e só então grava no arquivo existente (dono e
// permissões continuam os mesmos).
export async function remoteWrite(
  connection: SshConnection,
  path: string,
  content: string,
  expectedMtime: number,
  password: string | null = null,
  run: Runner | InputRunner = runWithInput,
): Promise<{ mtime: number; backup: string }> {
  const quoted = remoteQuote(path);
  const backup = `${path}.golfinho-bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const command = [
    `[ "$(stat -c %Y -- ${quoted})" = "${expectedMtime}" ] || { echo "golfinho: o arquivo mudou no servidor desde que foi aberto. Recarregue antes de salvar." >&2; exit 3; }`,
    `cp -p -- ${quoted} ${remoteQuote(backup)}`,
    `cat > ${quoted}`,
    `stat -c %Y -- ${quoted}`,
  ].join(" && ");
  const input = content;
  let stdout: string;
  try {
    ({ stdout } = await (run as InputRunner)("ssh", [...sshArgs(connection, !password), "--", command], {
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      env: { ...(process.env as Record<string, string>), ...sshEnv(password) },
      input,
    }));
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? (error as Error).message).trim();
    const marker = stderr.indexOf("golfinho: ");
    if (marker >= 0) throw new Error(stderr.slice(marker + "golfinho: ".length).split("\n")[0]);
    throw new Error(`Não foi possível salvar no servidor: ${stderr.split("\n").pop() ?? stderr}`.slice(0, 300));
  }
  return { mtime: Number(stdout.trim().split("\n").pop()), backup };
}
type InputRunner = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env: Record<string, string>; input: string },
) => Promise<{ stdout: string }>;
