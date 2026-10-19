import type { Request } from "../shared/contracts";
// Colar: texto primeiro. Sem texto, uma imagem da área de transferência vira o caminho do
// arquivo salvo, que a CLI do agente aceita como anexo.
export async function clipboardToPaste(request: <T>(r: Request) => Promise<T>): Promise<string> {
  const text = await request<string>({ action: "readClipboard" });
  if (text) return text;
  const path = await request<string | null>({ action: "pasteImage" });
  return path ? `${path} ` : "";
}

// Arrastar arquivos para o terminal: o caminho de cada um entra na linha de comando, como
// se fosse digitado. Imagens arrastadas do gerenciador de arquivos têm caminho no disco.
export function filesToPaste(files: FileList | File[]): string {
  const paths = [...files].map((file) => window.golfinho.getPathForFile(file)).filter(Boolean);
  if (!paths.length)
    throw new Error("Não foi possível ler os arquivos arrastados. Arraste o arquivo do gerenciador de arquivos.");
  return `${paths.map(quotePath).join(" ")} `;
}

// Caminhos com espaços ou aspas precisam de aspas para a CLI ler como um único argumento.
function quotePath(path: string): string {
  if (!/[\s'"]/.test(path)) return path;
  if (/^[A-Za-z]:\\/.test(path)) return `"${path}"`;
  return `'${path.replace(/'/g, "'\\''")}'`;
}
