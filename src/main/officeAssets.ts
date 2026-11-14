import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, isAbsolute } from "node:path";

// Modelos 3D do Escritório (personagens, roupas, acessórios e animações, em .glb). Vão por um
// protocolo do app, golfinho-asset://office/<caminho>: o app instalado abre a interface do disco,
// e de lá o fetch do Chromium não lê arquivos (file:). No instalador ficam em resources/office-assets.
export const ASSET_SCHEME = "golfinho-asset";

const TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};

/** Arquivo dentro da pasta de modelos para a URL pedida; null se sair dela ou não for do Escritório. */
export function assetFile(root: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${ASSET_SCHEME}:` || parsed.hostname !== "office") return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  // Barra invertida separa pastas no Windows: aqui o caminho só usa "/", em todo sistema.
  if (!path || path.includes("\0") || path.includes("\\")) return null;
  const file = normalize(join(root, path));
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return file;
}

export async function assetResponse(root: string, url: string): Promise<Response> {
  const file = assetFile(root, url);
  if (!file) {
    console.warn(`Escritório: modelo fora da pasta ou endereço inválido: ${url}`);
    return new Response("não encontrado", { status: 404 });
  }
  try {
    const data = await readFile(file);
    return new Response(data, {
      headers: {
        "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        // A interface em desenvolvimento roda em http://localhost: o fetch dela precisa do CORS.
        "access-control-allow-origin": "*",
        "cache-control": "max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.warn(`Escritório: modelo não encontrado (${file}): ${(error as Error).message}`);
    return new Response("não encontrado", { status: 404 });
  }
}
