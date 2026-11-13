import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// O SDK do Claude acha o binário dele pelo pacote da plataforma. No app instalado esse caminho
// cai dentro do app.asar, um arquivo compactado de onde o Windows não executa programas; o
// electron-builder deixa o binário de verdade em app.asar.unpacked. Sem dizer isso ao SDK, o
// chat e o Escritório não abrem ("native binary ... exists but failed to launch").
export function unpackedPath(path: string): string {
  return path.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");
}

/** Pacotes do binário nativo, na ordem em que vale tentar nesta máquina. */
export function binaryPackages(platform = process.platform, arch = process.arch): string[] {
  const base = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
  return platform === "linux" ? [base, `${base}-musl`] : [base];
}

let cached: string | null | undefined;

/** Caminho do binário do SDK fora do app.asar, quando o app está empacotado; senão undefined. */
export function sdkExecutable(
  resolve: (id: string) => string = createRequire(import.meta.url).resolve,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (cached !== undefined) return cached ?? undefined;
  cached = null;
  const name = process.platform === "win32" ? "claude.exe" : "claude";
  for (const pkg of binaryPackages()) {
    let dir: string;
    try {
      dir = dirname(resolve(`${pkg}/package.json`));
    } catch {
      continue;
    }
    const original = join(dir, name);
    // Fora do app.asar (rodando pelo código-fonte), o SDK já acha sozinho.
    if (unpackedPath(original) === original) return undefined;
    const unpacked = unpackedPath(original);
    if (exists(unpacked)) {
      cached = unpacked;
      return unpacked;
    }
  }
  return undefined;
}

/** Opção para o query() do SDK: só aparece quando há um caminho a corrigir. */
export function sdkExecutableOption(): { pathToClaudeCodeExecutable?: string } {
  const path = sdkExecutable();
  return path ? { pathToClaudeCodeExecutable: path } : {};
}
