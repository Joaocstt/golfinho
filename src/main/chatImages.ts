import { copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, isAbsolute, join, relative, sep } from "node:path";
const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
export const IMAGE_EXTENSIONS = Object.keys(TYPES).map((ext) => ext.slice(1));
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export interface ChatImage {
  path: string;
  mediaType: string;
  base64: string;
}
// Imagens do chat. O renderer só manda caminhos; aqui eles são conferidos: precisam estar numa
// das pastas do app, ter extensão de imagem e caber no limite. Nada fora disso é lido ou enviado.
export class ChatImages {
  constructor(
    private readonly dir: string,
    private readonly roots: string[],
  ) {}
  // Copia um arquivo escolhido pela pessoa para a pasta do chat, para o histórico continuar
  // mostrando a imagem mesmo se o original for apagado ou movido.
  async import(source: string): Promise<string> {
    const type = TYPES[extname(source).toLowerCase()];
    if (!type) throw new Error("Formato não suportado. Use PNG, JPG, GIF ou WebP.");
    const info = await stat(source);
    if (!info.isFile()) throw new Error("O item escolhido não é um arquivo.");
    if (info.size > MAX_IMAGE_BYTES) throw new Error("Imagem excede 5 MiB.");
    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, `${randomUUID()}${extname(source).toLowerCase()}`);
    await copyFile(source, target);
    return target;
  }
  async verify(path: string): Promise<ChatImage> {
    if (!isAbsolute(path)) throw new Error("Caminho de imagem inválido.");
    const mediaType = TYPES[extname(path).toLowerCase()];
    if (!mediaType) throw new Error("Formato não suportado. Use PNG, JPG, GIF ou WebP.");
    const real = await realpath(path).catch(() => {
      throw new Error("A imagem não existe mais.");
    });
    const inside = await Promise.all(
      this.roots.map(async (root) => {
        const base = await realpath(root).catch(() => null);
        if (!base) return false;
        const rel = relative(base, real);
        return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
      }),
    );
    if (!inside.some(Boolean)) throw new Error("A imagem precisa ser anexada pelo chat.");
    const info = await stat(real);
    if (!info.isFile()) throw new Error("A imagem não é um arquivo.");
    if (info.size > MAX_IMAGE_BYTES) throw new Error("Imagem excede 5 MiB.");
    return { path: real, mediaType, base64: (await readFile(real)).toString("base64") };
  }
  async dataUrl(path: string): Promise<string> {
    const image = await this.verify(path);
    return `data:${image.mediaType};base64,${image.base64}`;
  }
}
