import type { ChatEvent } from "../shared/contracts";

// Pacote de handoff: o resumo que o agente novo recebe quando a tarefa troca de agente.
// Tudo vem do que o app já tem (prompt, conversa, diff, checks). Nada é gerado por LLM.
export const HANDOFF_LIMIT = 6000;
const MAX_MESSAGES = 5;
const MAX_MESSAGE_CHARS = 500;
const MAX_REPLY_CHARS = 1500;
const MAX_FILES = 40;
const MAX_CHECKS = 5;

export interface HandoffInput {
  prompt: string;
  fromLabel: string;
  // Itens do histórico do chat, na ordem em que aconteceram.
  history: { event: ChatEvent }[];
  files: string[];
  checks: { command: string; status: string }[];
}

// Devolve null quando não há nada a passar: o agente novo começa só com o prompt da tarefa.
export function buildHandoff(input: HandoffInput): string | null {
  const messages = input.history
    .map(({ event }) => event)
    .filter((event): event is Extract<ChatEvent, { type: "user" }> => event.type === "user")
    .map((event) => event.text.trim())
    .filter(Boolean)
    .slice(-MAX_MESSAGES);
  const reply = lastReply(input.history.map(({ event }) => event));
  const files = [...new Set(input.files)];
  const checks = input.checks.slice(0, MAX_CHECKS);

  if (!messages.length && !reply && !files.length && !checks.length) return null;

  const sections = [
    `Você está assumindo uma tarefa que ${input.fromLabel} começou. A branch e os arquivos já contêm o trabalho feito até aqui: continue a partir deste estado.`,
    `Pedido original:\n${input.prompt.trim() || "(sem instruções)"}`,
  ];
  if (messages.length)
    sections.push(
      `Mensagens suas na conversa anterior:\n${messages.map((m) => `- ${clip(m, MAX_MESSAGE_CHARS)}`).join("\n")}`,
    );
  if (reply) sections.push(`Última resposta de ${input.fromLabel}:\n${clip(reply, MAX_REPLY_CHARS)}`);
  if (files.length) {
    const shown = files.slice(0, MAX_FILES).map((path) => `- ${path}`);
    if (files.length > MAX_FILES) shown.push(`- … e mais ${files.length - MAX_FILES} arquivo(s)`);
    sections.push(`Arquivos alterados na branch (${files.length}):\n${shown.join("\n")}`);
  }
  if (checks.length)
    sections.push(
      `Verificações recentes:\n${checks.map((c) => `- ${c.command}: ${c.status}`).join("\n")}`,
    );
  return clip(sections.join("\n\n"), HANDOFF_LIMIT);
}

// Última resposta de texto do agente. Chamadas de ferramenta não entram no resumo.
export function lastReply(events: ChatEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== "assistant") continue;
    const text = event.blocks
      .flatMap((block) => (block.kind === "text" ? [block.text.trim()] : []))
      .filter(Boolean)
      .join("\n\n");
    if (text) return text;
  }
  return "";
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// Junta o pacote ao texto que a CLI recebe. Sem pacote, o texto fica como está.
export function withHandoff(handoff: string | null | undefined, text: string): string {
  if (!handoff) return text;
  return text.trim() ? `${handoff}\n\n---\n\n${text}` : handoff;
}
