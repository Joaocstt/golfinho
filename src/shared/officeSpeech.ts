// Como o agente "fala" no Escritório: a ação da ferramenta em português de gente, sem caminho
// completo, e a frase de narração que o próprio agente escreve enquanto trabalha.

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** "C:\\a\\b\\src\\main\\auth.ts" → "auth.ts (main)". */
export function shortPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const file = parts.at(-1) ?? path;
  const folder = parts.at(-2);
  return folder ? `${file} (${folder})` : file;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A ferramenta como frase: "Lendo auth.ts (main)", "Buscando "login" no código". */
export function describeTool(name: string, input: Record<string, unknown>): string {
  if (name === "Read") {
    const file = str(input.file_path) || str(input.path);
    return file ? `Lendo ${shortPath(file)}` : "Lendo um arquivo";
  }
  if (name === "Glob") {
    const pattern = str(input.pattern);
    const where = str(input.path);
    return `Procurando arquivos${pattern ? ` ${clip(pattern, 40)}` : ""}${where ? ` em ${shortPath(where)}` : ""}`;
  }
  if (name === "Grep") {
    const pattern = str(input.pattern);
    const where = str(input.path) || str(input.glob);
    return `Buscando "${clip(pattern, 40)}" no código${where ? ` (${clip(shortPath(where), 30)})` : ""}`;
  }
  if (name === "WebSearch") {
    const query = str(input.query);
    return query ? `Pesquisando na web: ${clip(query, 60)}` : "Pesquisando na web";
  }
  if (name === "WebFetch") {
    const url = str(input.url);
    try {
      return `Lendo a página ${new URL(url).hostname.replace(/^www\./, "")}`;
    } catch {
      return "Lendo uma página da web";
    }
  }
  if (name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") {
    const file = str(input.file_path) || str(input.notebook_path) || str(input.path);
    return file ? `Editando ${shortPath(file)}` : "Editando um arquivo";
  }
  if (name === "Write") {
    const file = str(input.file_path) || str(input.path);
    return file ? `Escrevendo ${shortPath(file)}` : "Escrevendo um arquivo";
  }
  // "Comando" e "Alterar arquivos" são os nomes que o chat da Codex usa.
  if (name === "Bash" || name === "Comando") {
    // A Codex embrulha o comando no shell: powershell -Command '...', bash -lc '...'.
    const raw = str(input.command);
    const command = (/(?:-Command|-lc|-c)\s+(['"])([\s\S]*)\1\s*$/.exec(raw)?.[2] ?? raw).trim();
    return command ? `Rodando: ${clip(command, 50)}` : "Rodando um comando";
  }
  if (name === "Alterar arquivos") {
    const files = str(input.path).split(/,\s*/).filter(Boolean);
    if (!files.length || files[0] === "arquivos") return "Editando arquivos";
    return files.length === 1 ? `Editando ${shortPath(files[0])}` : `Editando ${shortPath(files[0])} e mais ${files.length - 1}`;
  }
  if (name === "TodoWrite") return "Organizando os próximos passos";
  if (name === "Task") return "Chamando um ajudante";
  return `Usando ${name}`;
}

/** O resumo que o chat guarda (caminho, comando ou JSON) de volta como entrada da ferramenta. */
export function chatToolInput(summary: string): Record<string, unknown> {
  try {
    const value = JSON.parse(summary);
    if (value && typeof value === "object") return value as Record<string, unknown>;
  } catch {}
  return { file_path: summary, path: summary, command: summary, pattern: summary, query: summary, url: summary };
}

/** Primeira frase da narração do agente, curta o bastante para um balão; "" se não serve. */
export function speechFrom(text: string): string {
  const clean = text.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.startsWith("{") || clean.startsWith("[")) return "";
  const sentence = /^(.{8,160}?[.!?…])(\s|$)/.exec(clean)?.[1] ?? clean;
  return clip(sentence, 140);
}
