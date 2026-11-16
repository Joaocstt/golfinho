import { transform } from "sucrase";
import { existsSync, statSync } from "node:fs";

// O ORCA aceita o código do plugin em TypeScript (worker, painel e editor) e importa arquivos
// sem extensão ("./core/http-file"). O Golfinho faz o mesmo: tira os tipos na hora de carregar,
// sem empacotar nada, e acha o arquivo pela extensão.

export const SOURCE = /\.(ts|tsx|mts|jsx)$/;
const TRY = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", "/index.ts", "/index.js"];

export function toJs(code: string, path: string): string {
  const jsx = /\.(tsx|jsx)$/.test(path);
  return transform(code, {
    transforms: jsx ? ["typescript", "jsx"] : ["typescript"],
    jsxRuntime: "automatic",
    jsxImportSource: "orca",
    production: true,
    disableESTransforms: true,
    filePath: path,
  }).code;
}

// Caminho real de um import relativo: o próprio arquivo, ou com uma das extensões aceitas.
export function resolveFile(path: string): string | null {
  const file = (p: string) => existsSync(p) && statSync(p).isFile();
  if (file(path)) return path;
  for (const ext of TRY) if (file(path + ext)) return path + ext;
  return null;
}
