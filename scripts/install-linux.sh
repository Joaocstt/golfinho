#!/bin/bash
# Instala (ou atualiza) o Golfinho no Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Joaocstt/golfinho/main/scripts/install-linux.sh | bash
#
# Por padrão instala o AppImage na pasta do usuário, com atalho no menu de aplicativos e o
# comando `golfinho` no terminal. É o formato que se atualiza pelo botão do próprio Golfinho.
# Com `--deb` (Debian/Ubuntu), instala o pacote .deb pelo apt; aí as atualizações vêm por
# este mesmo script:
#
#   curl -fsSL https://raw.githubusercontent.com/Joaocstt/golfinho/main/scripts/install-linux.sh | bash -s -- --deb
set -euo pipefail

REPO="Joaocstt/golfinho"
mode="appimage"
for arg in "$@"; do
  case "$arg" in
    --deb) mode="deb" ;;
    *) echo "Opção desconhecida: $arg" >&2; exit 1 ;;
  esac
done

if [ "$(uname -s)" != "Linux" ]; then
  echo "Este instalador é só para Linux." >&2
  exit 1
fi
if [ "$(uname -m)" != "x86_64" ]; then
  echo "Por enquanto o Golfinho só tem versão Linux para x86_64 (amd64)." >&2
  exit 1
fi

# sudo só quando precisa; como root, roda direto.
sudo_() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Procurando a versão mais recente..."
curl -fsSL "https://github.com/$REPO/releases/latest/download/latest-linux.yml" -o "$tmp/latest-linux.yml"
version="$(sed -n 's/^version: *//p' "$tmp/latest-linux.yml" | tr -d "'\"\r")"
if [ "$mode" = "deb" ]; then file="golfinho_${version}_amd64.deb"; else file="Golfinho-$version.AppImage"; fi
expected="$(awk -v f="$file" '$0 ~ "url: "f"$" {getline; sub(/^ *sha512: */, ""); print; exit}' "$tmp/latest-linux.yml")"
if [ -z "$version" ] || [ -z "$expected" ]; then
  echo "Não foi possível ler a release mais recente." >&2
  exit 1
fi

echo "Baixando o Golfinho $version..."
curl -fL --progress-bar "https://github.com/$REPO/releases/download/v$version/$file" -o "$tmp/$file"
# O yml traz o sha512 em base64; compara em hexadecimal só com o coreutils.
actual="$(sha512sum "$tmp/$file" | cut -d' ' -f1)"
if [ "$actual" != "$(printf %s "$expected" | base64 -d | od -An -v -tx1 | tr -d ' \n')" ]; then
  echo "O arquivo baixado não confere com a release (sha512 diferente)." >&2
  exit 1
fi

if [ "$mode" = "deb" ]; then
  if ! command -v apt-get >/dev/null; then
    echo "--deb precisa do apt (Debian, Ubuntu e derivados)." >&2
    exit 1
  fi
  chmod 644 "$tmp/$file"
  # O apt lê o arquivo como o usuário _apt; a pasta temporária precisa deixar.
  chmod 755 "$tmp"
  sudo_ apt-get install -y "$tmp/$file"
  echo "Golfinho $version instalado. Abra pelo menu de aplicativos ou com o comando golfinho."
  exit 0
fi

# O AppImage precisa da libfuse2 (no Ubuntu 24.04 o pacote se chama libfuse2t64).
# (sem `grep -q` num pipe: com pipefail, o SIGPIPE do ldconfig contaria como falha)
if ! grep -c 'libfuse\.so\.2' <<<"$(ldconfig -p 2>/dev/null)" >/dev/null; then
  if command -v apt-get >/dev/null; then
    echo "Instalando a libfuse2, necessária para o AppImage (pede sua senha)..."
    sudo_ apt-get install -y libfuse2t64 2>/dev/null || sudo_ apt-get install -y libfuse2
  else
    echo "Aviso: instale a libfuse2 pelo gerenciador de pacotes da sua distribuição." >&2
  fi
fi

data="${XDG_DATA_HOME:-$HOME/.local/share}"
dir="$data/golfinho-app"
bin="$HOME/.local/bin"
mkdir -p "$dir" "$bin" "$data/applications" "$data/icons/hicolor/512x512/apps"

# Nome sem versão: o atualizador do Golfinho troca este mesmo arquivo, e o atalho continua valendo.
# Troca por rename: um Golfinho aberto continua usando o arquivo antigo até reiniciar.
app="$dir/Golfinho.AppImage"
install -m 755 "$tmp/$file" "$app.new"
mv -f "$app.new" "$app"

# Ubuntu 23.10+ bloqueia o sandbox do Chromium fora de pacotes com perfil do AppArmor.
flags=""
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = "1" ]; then
  flags=" --no-sandbox"
fi

cat > "$bin/golfinho" <<EOF
#!/bin/sh
exec "$app"$flags "\$@"
EOF
chmod 755 "$bin/golfinho"

curl -fsSL "https://raw.githubusercontent.com/$REPO/main/build/icons/512x512.png" \
  -o "$data/icons/hicolor/512x512/apps/golfinho.png" || true

cat > "$data/applications/golfinho.desktop" <<EOF
[Desktop Entry]
Name=Golfinho
Comment=Ambiente desktop para tarefas com agentes e branches Git
Exec="$app"$flags %U
Icon=golfinho
Terminal=false
Type=Application
Categories=Development;
StartupWMClass=golfinho
EOF
update-desktop-database "$data/applications" >/dev/null 2>&1 || true

echo "Golfinho $version instalado (se ele estava aberto, reinicie para usar a versão nova)."
echo "Abra pelo menu de aplicativos ou com o comando golfinho."
case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "Para usar o comando golfinho, adicione $bin ao PATH." ;;
esac
