// Escritório: uma equipe de agentes do Claude que trabalha no projeto escolhido. O chefe (a pessoa)
// vai até a mesa de alguém, faz um pedido, e o agente aceita, manda para o colega certo ou pede
// detalhes. O trabalho aceito passa pela revisão e chega na mesa do chefe. A sala e a equipe são
// dados (OfficeLayout) que a pessoa edita no próprio Golfinho, um escritório por projeto.

export type OfficeAgentId = string;
export type OfficeModel = "padrao" | "haiku" | "sonnet" | "opus";
/** CLI que o agente usa para pensar e trabalhar. */
export type OfficeProvider = "claude" | "codex";
export const OFFICE_PROVIDERS: Record<OfficeProvider, string> = { claude: "Claude", codex: "Codex" };
export const agentProvider = (a: Pick<OfficeAgent, "provider">): OfficeProvider => a.provider ?? "claude";

export interface OfficeAgent {
  /** Letras minúsculas, números e hífen. Estável: o histórico aponta para ele. */
  id: OfficeAgentId;
  name: string;
  /** Artigo usado nas falas ("a Ana", "o Bruno"). */
  article: "a" | "o";
  role: string;
  /** Área curta, usada nas falas. */
  area: string;
  /** Área detalhada, usada no prompt para decidir o que é de quem. */
  scope: string;
  personality: string;
  /** "task": a entrega vira uma tarefa do Golfinho em vez de um texto. */
  mode: "deliver" | "task";
  /** Pode pesquisar na web, além de ler o projeto. */
  web: boolean;
  /** "padrao" usa o modelo padrão da CLI. Os outros valem só para o Claude. */
  model: OfficeModel;
  /** Claude (padrão) ou Codex. */
  provider?: OfficeProvider;
  /** Personagem 3D (corpo, cabelo, roupa, acessórios, pet), no formato do Golfinho Call. Sem ele, um a partir da cor. */
  look?: Record<string, unknown>;
  /** Setup da mesa (monitores, LEDs, teclado, cadeira, PC, enfeites), no formato do Golfinho Call. */
  deskStyle?: Record<string, unknown>;
  color: string;
  hair: string;
  /** Canto superior esquerdo da mesa (3 x 2 células). */
  desk: { col: number; row: number };
}

export type TileKind = "piso" | "tapete" | "azulejo" | "parede" | "janela";
export type FurnitureKind = "planta" | "quadro" | "chefe" | "sofa" | "estante" | "bebedouro" | "telao" | "reuniao";

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  col: number;
  row: number;
}

export interface OfficeLayout {
  cols: number;
  rows: number;
  /** Uma letra por célula, linha a linha (ver TILE_CODE). */
  tiles: string;
  furniture: Furniture[];
  agents: OfficeAgent[];
  /** Quem revisa as entregas dos outros; null entrega direto. */
  reviewer: OfficeAgentId | null;
  /** Personagem 3D do chefe (a pessoa). */
  bossLook?: Record<string, unknown>;
}

export interface OfficeMessage {
  who: "chefe" | "agente" | "sistema";
  text: string;
}

export type OfficeJobStatus = "fila" | "fazendo" | "revisao" | "entregue" | "erro";

export interface OfficeJob {
  id: string;
  /** "chat": pedido feito no chat de uma tarefa do Golfinho; o Escritório só acompanha (não vai à mesa do chefe). */
  origin?: "chat";
  /** Saída do último comando que o agente rodou na tarefa (o fim dela), para a tela ampliada. */
  output?: string;
  outputError?: boolean;
  agentId: OfficeAgentId;
  /** Nome na época do pedido: o agente pode ser renomeado ou sair da equipe depois. */
  agentName: string;
  title: string;
  /** O pedido como o chefe escreveu. */
  request: string;
  status: OfficeJobStatus;
  /** O que o agente está fazendo agora, em português ("Lendo index.ts (main)"). */
  activity: string;
  /** A última frase que o agente disse sobre o que está fazendo, para o balão. */
  speech?: string;
  /** Entrega em Markdown; a versão revisada substitui a original. */
  result: string;
  notes: string[];
  reviewedBy?: string;
  /** Tarefa do Golfinho criada e executada pelo agente de código. */
  taskId?: string;
  /** Arquivos que a execução da tarefa mudou na branch. */
  changed?: { path: string; kind: string }[];
  /** Pedido de permissão esperando o chefe (ex.: editar um arquivo, rodar um comando). */
  approval?: { id: string; tool: string; text: string; canAlways: boolean };
  /** Commit feito pelo Escritório depois da entrega. */
  committed?: string;
  /** "plano": o agente de código planejou e espera o chefe decidir; "codigo": já implementou. */
  stage?: "plano" | "codigo";
  /** O chefe mandou implementar (na mesa dele). Sem isso, nada de código é feito. */
  approved?: boolean;
  /** Branch existente que o chefe escolheu para a implementação; sem isso, cria uma branch nova. */
  targetBranch?: string;
  /** Voltas de correção pedidas pela revisora (no máximo OFFICE_MAX_ROUNDS). */
  rounds?: number;
  /** O que a revisora pediu para corrigir, esperando o agente de código. */
  fixRequest?: string;
  /** O chefe cancelou. */
  cancelled?: boolean;
  /** Relatório que originou este trabalho de código. */
  basedOn?: string;
  /** Trabalho de código pedido a partir deste relatório. */
  followUp?: string;
  error?: string;
  read: boolean;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Tudo o que aconteceu no trabalho, em ordem: ferramentas usadas, revisão, tarefa criada. */
  log?: OfficeLogEntry[];
}

export interface OfficeLogEntry {
  at: string;
  who: string;
  kind: "pedido" | "inicio" | "fala" | "ferramenta" | "revisao" | "tarefa" | "fim" | "erro";
  text: string;
  /** A ação crua (ferramenta e caminho), para quem quiser o detalhe. */
  detail?: string;
}

export interface OfficeState {
  projectId: string;
  layout: OfficeLayout;
  chats: Record<OfficeAgentId, OfficeMessage[]>;
  /** Agentes decidindo uma resposta agora. */
  thinking: OfficeAgentId[];
  jobs: OfficeJob[];
  /** A última reunião (a que está acontecendo, ou a que acabou). */
  meeting?: OfficeMeeting | null;
}

// Reunião: o chefe leva um pedido grande para alguns agentes. Eles discutem (as falas aparecem
// em balões na mesa de reunião) e saem com o trabalho dividido: um pedido para cada um, que
// segue o caminho normal (plano de código ainda passa pela mesa do chefe).
export interface OfficeMeeting {
  id: string;
  agentIds: OfficeAgentId[];
  request: string;
  status: "discutindo" | "pronta" | "erro";
  /** A conversa, na ordem: quem falou e o quê. */
  lines: { agentId: OfficeAgentId; text: string }[];
  summary: string;
  /** O que cada um saiu fazendo, com o trabalho criado. */
  tasks: { agentId: OfficeAgentId; title: string; jobId: string }[];
  error?: string;
  createdAt: string;
}

export interface OfficeDecision {
  action: "aceitar" | "encaminhar" | "esclarecer";
  to?: OfficeAgentId;
  reply: string;
  jobId?: string;
}

export const OFFICE_MAX_ROUNDS = 2;
export const officeAgent = (layout: OfficeLayout, id: string) => layout.agents.find((a) => a.id === id);
export const officeTools = (a: OfficeAgent) => ["Read", "Glob", "Grep", ...(a.web ? ["WebSearch", "WebFetch"] : [])];
