// Reconhece caminhos de arquivo citados no chat (`DOCKER.md`, `src/app.ts`, /home/.../x.sh),
// para virarem links que abrem o arquivo. Pastas (`app/`) e URLs ficam de fora.
const NAMED = /^(Dockerfile|Makefile|Procfile|Gemfile|Rakefile|Containerfile|Jenkinsfile|Vagrantfile)$/;
const PATH = /^(?:\.{0,2}\/)?(?:[\w.@+-]+\/)*[\w.@+-]+$/;

export function asFilePath(text: string): string | null {
  const value = text.trim().replace(/[:.,;]+$/, "");
  if (!value || value.length > 300 || /\s/.test(value) || /^[a-z]+:\/\//i.test(value)) return null;
  if (!PATH.test(value)) return null;
  const name = value.split("/").pop() ?? "";
  if (NAMED.test(name)) return value;
  // Nome de host solto (mpac.local, exemplo.com.br) não é arquivo.
  if (!value.includes("/") && /\.(local|com|br|org|net|dev|app|internal|localhost)$/i.test(value)) return null;
  // Nome com extensão de letras; números puros (1.2.3) e o próprio "." não contam.
  return /^[\w@+-][\w.@+-]*\.[A-Za-z][\w-]{0,9}$/.test(name) || /^\.[A-Za-z][\w.-]+$/.test(name) ? value : null;
}

// Primeiro caminho absoluto numa linha de resultado ("File created successfully at: /x/DOCKER.md").
export function absolutePathIn(line: string): { before: string; path: string; after: string } | null {
  const match = /(^|\s)(\/[^\s'"`]+)/.exec(line);
  if (!match) return null;
  const path = asFilePath(match[2]);
  if (!path) return null;
  const start = match.index + match[1].length;
  return { before: line.slice(0, start), path, after: line.slice(start + path.length) };
}
