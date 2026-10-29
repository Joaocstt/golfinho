import { dirname } from "node:path";

// Atualização do Golfinho no macOS sem assinatura da Apple. O electron-updater (Squirrel.Mac)
// recusa app sem Developer ID, então o próprio Golfinho baixa o .zip da release, confere o
// sha512 e, quando o usuário pede, troca o Golfinho.app por um script que roda depois que o
// app fecha. Nada disso passa pelo navegador, então o app novo não ganha a marca de quarentena.

export const RELEASES = "https://github.com/Joaocstt/golfinho/releases";

export interface MacRelease {
  version: string;
  files: { url: string; sha512: string; size: number }[];
}

// latest-mac.yml gerado pelo electron-builder: só o que importa, sem dependência de YAML.
export function parseLatestMac(yml: string): MacRelease {
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(yml)?.[1];
  if (!version) throw new Error("latest-mac.yml sem versão.");
  const files: MacRelease["files"] = [];
  for (const entry of yml.split(/^\s*- url:\s*/m).slice(1)) {
    const url = entry.split(/\r?\n/)[0].trim();
    const sha512 = /^\s*sha512:\s*(\S+)/m.exec(entry)?.[1];
    const size = Number(/^\s*size:\s*(\d+)/m.exec(entry)?.[1] ?? 0);
    if (url && sha512) files.push({ url, sha512, size });
  }
  return { version, files };
}

// O .zip da arquitetura do Mac: Golfinho-1.2.3-arm64-mac.zip ou Golfinho-1.2.3-mac.zip (Intel).
export function pickZip(release: MacRelease, arch: string) {
  const zips = release.files.filter((f) => f.url.endsWith("-mac.zip"));
  return arch === "arm64"
    ? zips.find((f) => f.url.endsWith("-arm64-mac.zip"))
    : zips.find((f) => !/-arm64-mac\.zip$/.test(f.url));
}

export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.split("-")[0].split(".").map((n) => Number(n) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

// /Applications/Golfinho.app/Contents/MacOS/Golfinho → /Applications/Golfinho.app.
export function appBundle(execPath: string): string | null {
  const bundle = dirname(dirname(dirname(execPath)));
  return bundle.endsWith(".app") ? bundle : null;
}

// Roda solto depois que o Golfinho fecha: espera o processo sair, troca o app guardando o
// antigo até a cópia dar certo, tira a quarentena por garantia e abre a versão nova.
// Argumentos: $1 pid do Golfinho, $2 Golfinho.app novo (extraído), $3 Golfinho.app instalado.
export const INSTALL_SCRIPT = `
for _ in $(seq 120); do kill -0 "$1" 2>/dev/null || break; sleep 0.5; done
old="$3.old-$$"
mv "$3" "$old" || exit 1
if ditto "$2" "$3"; then
  rm -rf "$old"
else
  rm -rf "$3"
  mv "$old" "$3"
fi
xattr -dr com.apple.quarantine "$3" 2>/dev/null
rm -rf "$(dirname "$2")"
open "$3"
`;
