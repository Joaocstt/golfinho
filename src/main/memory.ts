import type { ChatEvent, Memory, MemoryKind } from "../shared/contracts";
import { clip } from "./handoff";

// Memória do projeto: notas guardadas no banco local que vão para o agente numa conversa nova.
// Aqui fica só a parte pura (consulta, registro da tarefa e o texto enviado), sem banco.
// O agente recebe todas as notas ativas. Até este total elas vão completas; as que passarem
// vão só com o título (e o id, para memoria_ler), assim nenhuma fica de fora sem estourar o contexto.
export const MEMORY_LIMIT = 24_000;
// Cabe a nota automática inteira de uma tarefa (até 8 mil caracteres, com as mensagens do usuário).
const MAX_NOTE_CHARS = 8000;
const MAX_TITLES = 200;
const MAX_DIGEST_FILES = 30;

export const kindLabels: Record<MemoryKind, string> = {
  decisao: "decisão",
  convencao: "convenção",
  armadilha: "armadilha",
  contexto: "contexto",
  tarefa: "tarefa",
};

// Palavras que aparecem em quase todo pedido e só atrapalham a relevância.
const STOPWORDS = new Set(
  (
    "que para com uma por não nao mais como mas foi ser tem são sao seu sua isso esta este essa " +
    "esse aqui ele ela eles elas dos das nos nas num numa pelo pela pelos pelas quando onde qual " +
    "também tambem muito já sem sobre entre depois antes ainda até ate faça faca fazer favor the " +
    "and for with from this that you are"
  ).split(" "),
);

// Texto livre → consulta FTS5. Cada termo vai entre aspas, então nada do que a pessoa escreveu
// vira operador (NOT, *, :, parênteses). Sem termos úteis, devolve null.
export function ftsQuery(text: string, max = 24): string | null {
  const seen = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []) {
    if (STOPWORDS.has(word)) continue;
    seen.add(word);
    if (seen.size >= max) break;
  }
  if (!seen.size) return null;
  return [...seen].map((word) => `"${word}"`).join(" OR ");
}

export interface DigestInput {
  /** Situação da tarefa quando o registro foi atualizado (ex.: "em andamento"). */
  status?: string;
  /** Nome do agente atual da tarefa, para rotular a conversa antes de qualquer troca. */
  agent?: string;
  title: string;
  prompt: string;
  history: { event: ChatEvent }[];
  files: string[];
  checks: { command: string; status: string }[];
}

// Uma linha da linha do tempo: quem falou e o quê. As ferramentas de um turno ficam juntas.
interface Entry {
  who: string;
  text: string;
  tools: string[];
  divider?: boolean;
}
const TIMELINE_BUDGET = 5000;
// As entradas mais recentes ficam mais completas; as antigas, só com o começo.
const RECENT_ENTRIES = 6;
const RECENT_CHARS = 600;
const OLD_CHARS = 160;
const LAST_REPLY_CHARS = 1500;

// Conversa da tarefa em entradas: cada mensagem do usuário, cada resposta do agente (texto e
// ferramentas do turno) e cada troca de agente.
export function timeline(history: { event: ChatEvent }[], agent = "agente"): Entry[] {
  const events = history.map(({ event }) => event);
  const firstChange = events.find((e): e is Extract<ChatEvent, { type: "agent_changed" }> => e.type === "agent_changed");
  let who = firstChange?.from ?? agent;
  const entries: Entry[] = [];
  let turn: Entry | null = null;
  for (const event of events) {
    if (event.type === "user") {
      turn = null;
      const text = event.text.trim();
      if (text) entries.push({ who: "você", text, tools: [] });
    } else if (event.type === "agent_changed") {
      turn = null;
      who = event.to;
      entries.push({ who: "", text: `troca de ${event.from} para ${event.to}`, tools: [], divider: true });
    } else if (event.type === "assistant") {
      if (!turn) {
        turn = { who, text: "", tools: [] };
        entries.push(turn);
      }
      for (const block of event.blocks) {
        if (block.kind === "text" && block.text.trim()) turn.text = turn.text ? `${turn.text}\n${block.text.trim()}` : block.text.trim();
        if (block.kind === "tool") turn.tools.push(block.summary ? `${block.name} ${clip(block.summary, 60)}` : block.name);
      }
    }
  }
  return entries.filter((e) => e.divider || e.text || e.tools.length);
}

function renderEntry(entry: Entry, chars: number): string {
  if (entry.divider) return `── ${entry.text} ──`;
  const text = clip(entry.text.replace(/\s+/g, " ").trim(), chars);
  const tools = entry.tools.length
    ? ` (ferramentas: ${clip([...new Set(entry.tools)].join(", "), Math.max(80, Math.floor(chars / 3)))})`
    : "";
  return `[${entry.who}] ${text || "(sem texto)"}${tools}`;
}

// Registro da tarefa: situação, pedido, linha do tempo da conversa, arquivos e checks. Montado
// do que o app já tem, sem LLM. O histórico inteiro continua pesquisável pelo memoria_buscar.
export function taskDigest(input: DigestInput): string {
  const sections = [`Pedido:\n${clip(input.prompt.trim() || input.title, 1200)}`];
  if (input.status) sections.unshift(`Situação: ${input.status}`);
  const entries = timeline(input.history, input.agent);
  if (entries.length) {
    const lastReply = entries.map((e, i) => (!e.divider && e.who !== "você" ? i : -1)).filter((i) => i >= 0).pop();
    const lines: string[] = [];
    let used = 0;
    let index = entries.length - 1;
    for (; index >= 0; index--) {
      const recent = entries.length - index <= RECENT_ENTRIES;
      const chars = index === lastReply ? LAST_REPLY_CHARS : recent ? RECENT_CHARS : OLD_CHARS;
      const line = renderEntry(entries[index], chars);
      if (lines.length && used + line.length > TIMELINE_BUDGET) break;
      lines.unshift(line);
      used += line.length + 1;
    }
    if (index >= 0)
      lines.unshift(`(… ${index + 1} entrada(s) anterior(es); o histórico completo está em memoria_buscar)`);
    sections.push(`Linha do tempo (${entries.length} entrada(s)):\n${lines.join("\n")}`);
  }
  const files = [...new Set(input.files)];
  if (files.length) {
    const shown = files.slice(0, MAX_DIGEST_FILES).map((path) => `- ${path}`);
    if (files.length > MAX_DIGEST_FILES) shown.push(`- … e mais ${files.length - MAX_DIGEST_FILES} arquivo(s)`);
    sections.push(`Arquivos alterados (${files.length}):\n${shown.join("\n")}`);
  }
  if (input.checks.length)
    sections.push(`Checks:\n${input.checks.map((c) => `- ${c.command}: ${c.status}`).join("\n")}`);
  return clip(sections.join("\n\n"), 8000);
}

// Texto de um evento do chat para o índice de busca do histórico. Mensagens, respostas, ferramentas
// e resultados entram; status, aprovações e contexto não dizem nada pesquisável.
export function searchableText(event: ChatEvent): { who: string; text: string } | null {
  switch (event.type) {
    case "user":
      return event.text.trim() ? { who: "usuário", text: event.text } : null;
    case "assistant": {
      const text = event.blocks
        .map((block) => (block.kind === "text" ? block.text : `[ferramenta ${block.name}] ${block.summary}`))
        .join("\n")
        .trim();
      return text ? { who: "agente", text } : null;
    }
    case "tool_result":
      return event.text.trim() ? { who: "resultado", text: clip(event.text, 4000) } : null;
    case "agent_changed":
      return { who: "troca", text: `Agente trocado de ${event.from} para ${event.to}` };
    default:
      return null;
  }
}

// Texto que o agente recebe. `tools` diz se ele tem as ferramentas MCP da memória nesta execução.
const SAVE_HINT =
  "Sempre que tomar uma decisão, descobrir uma convenção do projeto ou cair numa armadilha que valha para tarefas futuras, registre com memoria_salvar, de forma curta e específica.";
export function memoryPackage(memories: Memory[], tools: boolean, limit = MEMORY_LIMIT): string | null {
  // Memória vazia: com as ferramentas, o agente ainda recebe o pedido para registrar o que aprender.
  if (!memories.length) return tools ? `Este projeto tem uma memória no Golfinho, ainda vazia. ${SAVE_HINT}` : null;
  const head = [
    `Memória deste projeto (${memories.length} nota(s)), registrada no Golfinho. Use como contexto e confira no código antes de confiar.`,
  ];
  if (tools)
    head.push(
      `Use memoria_buscar para procurar nas notas e no histórico completo das conversas desta e de outras tarefas (inclusive com outros agentes), e memoria_conversa para abrir um trecho. ${SAVE_HINT}`,
    );
  const full: string[] = [];
  const rest: Memory[] = [];
  let used = head.join(" ").length;
  for (const m of memories) {
    const line = `- [${kindLabels[m.kind]}] ${m.title}: ${clip(m.content.replace(/\s+/g, " ").trim(), MAX_NOTE_CHARS)}`;
    if (!rest.length && used + line.length + 1 <= limit) {
      full.push(line);
      used += line.length + 1;
    } else rest.push(m);
  }
  let text = `${head.join(" ")}\n\n${full.join("\n")}`;
  if (rest.length) {
    const titles = rest
      .slice(0, MAX_TITLES)
      .map((m) => `- [${kindLabels[m.kind]}] ${m.title}${tools ? ` (id ${m.id})` : ""}`);
    if (rest.length > MAX_TITLES) titles.push(`- … e mais ${rest.length - MAX_TITLES} nota(s)`);
    const how = tools ? "abra com memoria_ler pelo id quando precisar" : "peça ao usuário se precisar delas";
    text += `\n\nOutras notas da memória, só pelo título (${how}):\n${titles.join("\n")}`;
  }
  return text;
}

// Junta a memória ao texto que a CLI recebe, como o withHandoff.
export function withMemory(memory: string | null | undefined, text: string): string {
  if (!memory) return text;
  return text.trim() ? `${memory}\n\n---\n\n${text}` : memory;
}

// Título de uma nota criada a partir de uma resposta do chat: a primeira linha com texto.
export function titleFrom(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  // Só a primeira frase: respostas longas costumam começar com um parágrafo inteiro.
  const sentence = (line ?? "").replace(/[*_`]/g, "").split(/(?<=[.!?:])\s/)[0]?.replace(/[.:]$/, "");
  return clip(sentence || "Resposta do agente", 90);
}

// Onde o agente encontra o servidor MCP da memória nesta execução do app.
export interface McpEndpoint {
  url: string;
  token: string;
}
// Servidor MCP da memória para esta execução. O Claude lê de um arquivo (o token fica nele, com
// permissão só do usuário); o Codex recebe a URL e lê o token da variável de ambiente.
export interface McpLaunch {
  url: string;
  claudeConfig: string;
}
// O que o terminal e o chat precisam do servidor: a conexão de uma tarefa e o token.
export interface MemoryLink {
  /** wsl: o agente roda dentro do WSL e precisa de um endereço do Windows que a distro alcance. */
  launch(taskId: string, wsl?: boolean): McpLaunch | null;
  endpoint(taskId: string, wsl?: boolean): McpEndpoint | null;
  readonly token: string;
}
// O Codex lê o token desta variável (bearer_token_env_var), então ele não vai na linha de comando.
export const MEMORY_TOKEN_ENV = "GOLFINHO_MEMORIA_TOKEN";
export const MEMORY_SERVER = "golfinho_memoria";

interface MemorySource {
  orderedMemories(projectId: string, text: string): Memory[];
}
// Pacote de uma conversa nova: as notas escolhidas e o texto. Sem notas, text é null.
export function prepareMemory(
  store: MemorySource,
  projectId: string,
  text: string,
  tools: boolean,
): { text: string | null; ids: string[] } {
  const memories = store.orderedMemories(projectId, text);
  return { text: memoryPackage(memories, tools), ids: memories.map((m) => m.id) };
}
