import { cp, lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Operações do explorador da árvore (criar, mover, copiar, excluir). Tudo acontece dentro da
// pasta da tarefa: caminhos chegam relativos, com "/", e nunca saem da raiz nem entram no .git.
// Links simbólicos são tratados como o próprio link: mover, copiar e excluir não seguem o alvo.

function parts(path: string) {
  return path.split(/[\\/]/).filter((part) => part && part !== ".");
}

// Caminho relativo à raiz para um item que pode ainda não existir. A pasta que o contém tem de
// existir e, depois de resolvidos os links, continuar dentro da raiz.
async function inside(root: string, path: string, what = "Caminho") {
  const segments = parts(path);
  if (!segments.length || isAbsolute(path) || segments.includes("..") || segments.includes(".git"))
    throw new Error(`${what} inválido: ${path || "(vazio)"}.`);
  const canonical = await realpath(root);
  const parent = await realpath(resolve(canonical, ...segments.slice(0, -1))).catch(() => {
    throw new Error(`A pasta de ${segments.join("/")} não existe.`);
  });
  const rel = relative(canonical, parent);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.split(sep).includes(".git"))
    throw new Error(`${what} fora da pasta da tarefa.`);
  return { canonical, target: resolve(parent, segments[segments.length - 1]), rel: segments.join("/") };
}

// Pasta de destino de uma colagem ou de um arrastar ("" é a raiz).
async function folder(root: string, path: string) {
  if (!parts(path).length) return { canonical: await realpath(root), target: await realpath(root), rel: "" };
  const found = await inside(root, path, "Pasta");
  const info = await lstat(found.target).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`${found.rel} não é uma pasta.`);
  return found;
}

async function exists(path: string) {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

function validName(name: string) {
  if (!name || name === "." || name === ".." || /[\\/]/.test(name) || name === ".git")
    throw new Error(`Nome inválido: ${name || "(vazio)"}.`);
  return name;
}

// "a.ts" vira "a copy.ts", depois "a copy 2.ts"… como no explorador do VS Code.
export async function copyName(name: string, taken: (candidate: string) => boolean | Promise<boolean>) {
  if (!(await taken(name))) return name;
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 10_000; n++) {
    const candidate = `${stem} copy${n === 1 ? "" : ` ${n}`}${ext}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`Não há nome livre para a cópia de ${name}.`);
}

function join(dir: string, name: string) {
  return dir ? `${dir}/${name}` : name;
}

// Uma pasta não pode ir para dentro dela mesma.
function within(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export async function createEntry(root: string, path: string, kind: "file" | "directory") {
  const { target, rel } = await inside(root, path);
  validName(basename(target));
  if (await exists(target)) throw new Error(`Já existe ${rel}.`);
  if (kind === "directory") await mkdir(target);
  else await writeFile(target, "", { flag: "wx" });
  return rel;
}

// Renomear e mover são a mesma operação: o destino não pode existir.
export async function moveEntry(root: string, from: string, to: string) {
  const source = await inside(root, from);
  const destination = await inside(root, to);
  validName(basename(destination.target));
  if (!(await exists(source.target))) throw new Error(`${source.rel} não existe mais.`);
  if (source.target === destination.target) return destination.rel;
  if (within(source.target, destination.target))
    throw new Error(`Não é possível mover ${source.rel} para dentro dela mesma.`);
  // Só a caixa mudou (a.ts → A.ts): em disco sem distinção de maiúsculas, o destino "existe".
  const sameEntry = source.target.toLowerCase() === destination.target.toLowerCase();
  if (!sameEntry && (await exists(destination.target))) throw new Error(`Já existe ${destination.rel}.`);
  await rename(source.target, destination.target);
  return destination.rel;
}

// Copia para a pasta indicada; se o nome estiver ocupado, ganha " copy". Serve também para duplicar.
export async function copyEntry(root: string, from: string, dir: string) {
  const source = await inside(root, from);
  if (!(await exists(source.target))) throw new Error(`${source.rel} não existe mais.`);
  return copyInto(root, source.target, dir);
}

// Arquivos e pastas de fora (área de transferência do sistema, arrastar do gerenciador de
// arquivos). A origem pode estar em qualquer lugar; o destino é sempre a pasta da tarefa.
export async function importEntries(root: string, sources: string[], dir: string) {
  const copied: string[] = [];
  for (const source of sources) {
    if (!isAbsolute(source)) throw new Error(`Caminho de origem inválido: ${source}.`);
    if (!(await exists(source))) throw new Error(`${source} não existe.`);
    copied.push(await copyInto(root, source, dir));
  }
  return copied;
}

async function copyInto(root: string, source: string, dir: string) {
  const destination = await folder(root, dir);
  if ((await lstat(source)).isDirectory() && within(await realpath(source), destination.target))
    throw new Error(`Não é possível copiar ${basename(source)} para dentro dela mesma.`);
  const name = await copyName(validName(basename(source)), (candidate) =>
    exists(resolve(destination.target, candidate)),
  );
  // verbatimSymlinks: um link copiado continua link, com o mesmo alvo; nada de fora é puxado.
  await cp(source, resolve(destination.target, name), {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
  return join(destination.rel, name);
}

// Excluir vai para a lixeira. Sem lixeira (pasta do WSL, sistema sem lixeira), devolve false e
// só apaga de vez quando a pessoa confirmar de novo (permanent).
export async function deleteEntry(
  root: string,
  path: string,
  permanent: boolean,
  trash?: (absolute: string) => Promise<void>,
) {
  const { target, rel } = await inside(root, path);
  if (!(await exists(target))) throw new Error(`${rel} não existe mais.`);
  if (!permanent) {
    if (!trash) return false;
    try {
      await trash(target);
      return true;
    } catch {
      return false;
    }
  }
  await rm(target, { recursive: true, force: false });
  return true;
}

// Caminho absoluto de um item da árvore (copiar caminho, revelar no gerenciador de arquivos).
export async function absolutePath(root: string, path: string) {
  if (!parts(path).length) return realpath(root);
  return (await inside(root, path)).target;
}

// Lista de arquivos copiados no gerenciador de arquivos, em cada formato que o sistema usa:
// text/uri-list e x-special/gnome-copied-files (Linux), public.file-url e NSFilenamesPboardType
// (macOS), FileNameW (Windows, UTF-16).
export const FILE_FORMATS = ["text/uri-list", "gnome-copied-files", "public.file-url", "NSFilenamesPboardType", "FileNameW"];
export function clipboardFiles(format: string, data: string): string[] {
  const kind = format.toLowerCase();
  if (kind.includes("nsfilenames"))
    return [...data.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => decodeXml(m[1]));
  if (kind.includes("filenamew") || kind.includes("filename"))
    return data
      .split("\0")
      .map((line) => line.trim())
      .filter((line) => isAbsolute(line) || /^[A-Za-z]:\\/.test(line) || line.startsWith("\\\\"));
  return data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("file://"))
    .map((line) => {
      try {
        return fileURLToPath(line);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
