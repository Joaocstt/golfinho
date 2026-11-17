import type { ChatEffort, ChatPermissionMode } from "./contracts";
// Modos de permissão do chat do Claude, na ordem do menu, com os nomes do app do Claude.
export const PERMISSION_MODES: { value: ChatPermissionMode; label: string; hint: string }[] = [
  { value: "default", label: "Pedir permissões", hint: "Pergunta antes de cada ferramenta que não esteja liberada." },
  { value: "acceptEdits", label: "Aceitar edições", hint: "Edita arquivos sem perguntar; comandos ainda pedem aprovação." },
  { value: "plan", label: "Modo plano", hint: "Só lê e planeja; não altera nada." },
  { value: "auto", label: "Automático", hint: "O Claude decide o que pode rodar sem perguntar." },
  { value: "bypassPermissions", label: "Ignorar permissões", hint: "Roda qualquer ferramenta sem perguntar." },
];
export const PERMISSION_LABELS = Object.fromEntries(PERMISSION_MODES.map((m) => [m.value, m.label])) as Record<
  ChatPermissionMode,
  string
>;
// Esforço do Claude, do menor para o maior.
export const EFFORT_LABELS: Record<ChatEffort, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
};
