import type { Request } from "../shared/contracts";
// Colar: texto primeiro. Sem texto, uma imagem da área de transferência vira o caminho do
// arquivo salvo, que a CLI do agente aceita como anexo.
export async function clipboardToPaste(request: <T>(r: Request) => Promise<T>): Promise<string> {
  const text = await request<string>({ action: "readClipboard" });
  if (text) return text;
  const path = await request<string | null>({ action: "pasteImage" });
  return path ? `${path} ` : "";
}
