import { inflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// Leitor de .zip só para instalar plugins: arquivos e pastas, guardados ou com deflate.
// Recusa o que não deveria vir num plugin: links simbólicos, caminhos que saem da pasta,
// arquivos criptografados e pacotes grandes demais.

const MAX_TOTAL = 256 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

export interface ZipEntry {
  path: string;
  directory: boolean;
  data?: Buffer;
}

export function readZip(zip: Buffer): ZipEntry[] {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--)
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("O arquivo não é um .zip válido.");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES) throw new Error("O .zip tem arquivos demais.");
  if (offset === 0xffffffff) throw new Error("Zip64 não é aceito para plugins.");
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("O .zip está corrompido.");
    const madeBy = zip.readUInt16LE(offset + 4) >> 8;
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const mode = zip.readUInt32LE(offset + 38) >>> 16;
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength).replace(/\\/g, "/");
    offset += 46 + nameLength + extraLength + commentLength;

    if (flags & 1) throw new Error("O .zip tem arquivos com senha.");
    // Unix guarda o tipo do arquivo nos bits altos; 0o120000 é link simbólico.
    if (madeBy === 3 && (mode & 0o170000) === 0o120000) throw new Error(`O .zip tem um link simbólico (${name}).`);
    const parts = name.split("/").filter(Boolean);
    if (name.startsWith("/") || /^[a-z]:/i.test(name) || parts.includes("..")) throw new Error(`Caminho inválido no .zip: ${name}`);
    if (!parts.length) continue;
    if (name.endsWith("/")) {
      entries.push({ path: parts.join("/"), directory: true });
      continue;
    }
    total += size;
    if (total > MAX_TOTAL) throw new Error("O .zip descompactado passa de 256 MB.");
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("O .zip está corrompido.");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: size + 1 });
    else throw new Error(`Compressão não suportada no .zip (${name}).`);
    if (data.length !== size) throw new Error(`O .zip está corrompido (${name}).`);
    entries.push({ path: parts.join("/"), directory: false, data });
  }
  return entries;
}

// Extrai na pasta. Se tudo estiver dentro de uma pasta só (http-client/...), ela vira a raiz.
export async function extractZip(zip: Buffer, target: string) {
  const entries = readZip(zip);
  const tops = new Set(entries.map((e) => e.path.split("/")[0]));
  const single = tops.size === 1 && entries.some((e) => e.path.includes("/"));
  const prefix = single ? [...tops][0] + "/" : "";
  for (const entry of entries) {
    const path = entry.path.slice(prefix.length);
    if (!path) continue;
    const out = join(target, ...path.split("/"));
    if (entry.directory) await mkdir(out, { recursive: true });
    else {
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, entry.data!);
    }
  }
}
