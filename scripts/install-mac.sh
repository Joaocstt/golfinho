#!/bin/bash
# Instala (ou atualiza) o Golfinho no macOS sem passar pela quarentena do Gatekeeper.
#
#   curl -fsSL https://raw.githubusercontent.com/Joaocstt/golfinho/main/scripts/install-mac.sh | bash
#
# O app não é assinado pela Apple. Arquivo baixado pelo navegador ganha a marca de
# quarentena e o macOS bloqueia a abertura; baixado pelo curl, não. Depois disso o
# próprio Golfinho se atualiza do mesmo jeito.
set -euo pipefail

REPO="Joaocstt/golfinho"
APP_NAME="Golfinho.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Este instalador é só para macOS." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) suffix="-arm64-mac.zip" ;;
  *) suffix="-mac.zip" ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Procurando a versão mais recente..."
curl -fsSL "https://github.com/$REPO/releases/latest/download/latest-mac.yml" -o "$tmp/latest-mac.yml"
version="$(sed -n 's/^version: *//p' "$tmp/latest-mac.yml" | tr -d "'\"\r")"
zip="Golfinho-$version$suffix"
expected="$(awk -v f="$zip" '$0 ~ "url: "f"$" {getline; sub(/^ *sha512: */, ""); print; exit}' "$tmp/latest-mac.yml")"
if [ -z "$version" ] || [ -z "$expected" ]; then
  echo "Não foi possível ler a release mais recente." >&2
  exit 1
fi

echo "Baixando o Golfinho $version..."
curl -fL --progress-bar "https://github.com/$REPO/releases/download/v$version/$zip" -o "$tmp/golfinho.zip"

actual="$(shasum -a 512 "$tmp/golfinho.zip" | cut -d' ' -f1 | xxd -r -p | base64)"
if [ "$actual" != "$expected" ]; then
  echo "O arquivo baixado não confere com a release (sha512 diferente)." >&2
  exit 1
fi

ditto -x -k "$tmp/golfinho.zip" "$tmp/app"

# /Applications quando dá para escrever nela; senão ~/Applications, sem pedir senha.
dest="/Applications"
if [ ! -w "$dest" ]; then
  dest="$HOME/Applications"
  mkdir -p "$dest"
fi

# Fecha o Golfinho aberto antes de trocar o app.
osascript -e 'quit app "Golfinho"' >/dev/null 2>&1 || true
for _ in $(seq 60); do pgrep -xq Golfinho || break; sleep 0.5; done

rm -rf "${dest:?}/$APP_NAME"
ditto "$tmp/app/$APP_NAME" "$dest/$APP_NAME"
xattr -dr com.apple.quarantine "$dest/$APP_NAME" 2>/dev/null || true

echo "Golfinho $version instalado em $dest/$APP_NAME."
open "$dest/$APP_NAME"
