import { randomUUID } from "node:crypto";
import { query, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { Project, Task } from "../shared/contracts";
import {
  officeAgent,
  officeTools,
  type OfficeAgent,
  type OfficeDecision,
  type OfficeJob,
  type OfficeLayout,
  type OfficeLogEntry,
  type OfficeMessage,
  type OfficeState,
} from "../shared/office";
import { defaultLayout, layoutProblems } from "../shared/officeLayout";
import { summarize, wslSpawn } from "./chat";
import { sdkExecutableOption } from "./sdkBinary";
import { chatToolInput, describeTool, speechFrom } from "../shared/officeSpeech";
import type { ChatEvent } from "../shared/contracts";

export interface OfficeDeps {
  project(id: string): Project;
  /** Pacote da memória do projeto para o pedido; null quando desligada ou vazia. */
  memory(projectId: string, text: string): string | null;
  /** Cria a tarefa do Golfinho (rascunho) que o agente de código preparou. */
  createTask(project: Project, title: string, prompt: string, branchHint: string): Promise<Task>;
  /** Prepara a branch e manda as instruções pelo chat da tarefa; o andamento chega por onChat. */
  runTask(taskId: string, text: string): Promise<void>;
  /** Fim da execução: a tarefa vai para revisão (ou falha) e a pasta fica livre. */
  endRun(taskId: string, ok: boolean, message: string): void;
  /** Arquivos alterados na pasta da tarefa. */
  changes(taskId: string): Promise<Record<string, string>>;
  /** Resposta do chefe a um pedido de permissão do agente. */
  decide(taskId: string, approvalId: string, behavior: "allow" | "deny", always: boolean): Promise<void>;
  /** Commit dos arquivos da tarefa, sem publicar. */
  commit(taskId: string, paths: string[], message: string): Promise<void>;
  emit(state: OfficeState): void;
  executable(): string | undefined;
  /** Escritório salvo do projeto (sala e histórico), ou null. */
  load(projectId: string): unknown;
  save(projectId: string, state: OfficeState): void;
}

// Nada no Escritório escreve no projeto: escrita e terminal ficam fora até do contexto do modelo.
const BLOCKED = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "BashOutput", "KillShell", "Task"];
const deny = async (): Promise<PermissionResult> => ({
  behavior: "deny",
  message: "No Escritório os agentes só leem o projeto.",
});
const MODEL: Record<OfficeAgent["model"], string | undefined> = {
  padrao: undefined,
  haiku: "haiku",
  sonnet: "sonnet",
  opus: "opus",
};
const KEEP_JOBS = 60;
const KEEP_MESSAGES = 80;
const KEEP_LOG = 200;

// Histórico do trabalho para o telão: cada passo com hora e quem fez.
function note(job: OfficeJob, who: string, kind: OfficeLogEntry["kind"], text: string, detail?: string) {
  const log = (job.log ??= []);
  log.push({ at: new Date().toISOString(), who, kind, text: text.slice(0, 300), ...(detail ? { detail: detail.slice(0, 300) } : {}) });
  if (log.length > KEEP_LOG) log.splice(0, log.length - KEEP_LOG);
}

// Resposta em JSON do modelo: o texto inteiro, um bloco ```json, ou do primeiro { ao último }.
export function parseJson(text: string): Record<string, unknown> | null {
  const tries = [text, /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? ""];
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start >= 0 && end > start) tries.push(text.slice(start, end + 1));
  for (const t of tries) {
    try {
      const value = JSON.parse(t.trim());
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {}
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const teamText = (team: OfficeAgent[]) =>
  team.map((a) => `- id "${a.id}": ${a.name}, ${a.role}. Cuida de: ${a.scope}.`).join("\n");
const conversation = (agent: OfficeAgent, chat: OfficeMessage[], n = 12) =>
  chat
    .slice(-n)
    .filter((m) => m.who !== "sistema")
    .map((m) => `${m.who === "chefe" ? "Chefe" : agent.name}: ${m.text}`)
    .join("\n");
const persona = (agent: OfficeAgent, project: Project) =>
  `Você é ${agent.name}, ${agent.role} na equipe do Escritório do Golfinho. Personalidade: ${agent.personality || "profissional"}. ` +
  `Você cuida de: ${agent.scope}. A equipe trabalha no projeto "${project.name}", na pasta ${project.path}.`;

interface Plan {
  title: string;
  branch: string;
  instructions: string;
  summary: string;
}
// O que fica gravado além do estado visível: o plano do agente de código e a conversa do pedido.
interface Saved extends OfficeState {
  plans?: Record<string, Plan>;
  contexts?: Record<string, string>;
}

// Execução em andamento: a tarefa que o agente está fazendo pelo chat, e quem espera o fim.
interface Run {
  projectId: string;
  job: OfficeJob;
  agent: OfficeAgent;
  summary: string;
  done: (r: { ok: boolean; message?: string }) => void;
}

export class Office {
  private states = new Map<string, OfficeState>();
  private runs = new Map<string, Run>();
  private busy = new Set<string>();
  private reviewing = new Set<string>();
  private plans = new Map<string, Plan>();
  private contexts = new Map<string, string>();
  private controllers = new Set<AbortController>();
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  constructor(private readonly deps: OfficeDeps) {}

  state(projectId: string): OfficeState {
    this.deps.project(projectId);
    let s = this.states.get(projectId);
    if (!s) {
      s = this.restore(projectId);
      this.states.set(projectId, s);
    }
    return s;
  }

  // Sala salva com problema volta para o modelo padrão; trabalho que estava andando quando o app
  // fechou não continua sozinho, então fica marcado como interrompido.
  private restore(projectId: string): OfficeState {
    const saved = this.deps.load(projectId) as Saved | null;
    const fresh: OfficeState = { projectId, layout: defaultLayout(), chats: {}, thinking: [], jobs: [] };
    if (!saved || typeof saved !== "object") return fresh;
    let layout = fresh.layout;
    try {
      if (saved.layout && layoutProblems(saved.layout).length === 0) layout = saved.layout;
    } catch {}
    const jobs = Array.isArray(saved.jobs) ? saved.jobs : [];
    for (const job of jobs)
      if (job.status === "fila" || job.status === "fazendo" || job.status === "revisao") {
        job.status = "erro";
        job.activity = "";
        job.error = "Interrompido quando o Golfinho fechou. Peça de novo.";
        note(job, "Golfinho", "erro", job.error);
      }
    for (const [id, plan] of Object.entries(saved.plans ?? {})) this.plans.set(id, plan);
    for (const [id, text] of Object.entries(saved.contexts ?? {})) this.contexts.set(id, text);
    return { projectId, layout, chats: saved.chats && typeof saved.chats === "object" ? saved.chats : {}, thinking: [], jobs };
  }

  saveLayout(projectId: string, layout: OfficeLayout): OfficeState {
    const problems = layoutProblems(layout);
    if (problems.length) throw new Error(problems.join(" "));
    const s = this.state(projectId);
    s.layout = layout;
    // Pedido na fila de quem saiu da equipe não tem mais quem faça.
    for (const job of s.jobs)
      if (job.status === "fila" && !officeAgent(layout, job.agentId)) {
        job.status = "erro";
        job.error = `${job.agentName} saiu da equipe antes de começar.`;
        note(job, "Golfinho", "erro", job.error);
      }
    this.emit(s);
    this.pump(projectId);
    return s;
  }

  markRead(projectId: string) {
    const s = this.state(projectId);
    for (const job of s.jobs) if (job.status === "entregue" || job.status === "erro") job.read = true;
    this.emit(s);
    return s;
  }

  stop() {
    this.stopped = true;
    for (const timer of this.sendTimers.values()) clearTimeout(timer);
    this.sendTimers.clear();
    for (const c of this.controllers) c.abort();
    for (const [projectId, timer] of this.saveTimers) {
      clearTimeout(timer);
      this.persist(projectId);
    }
    this.saveTimers.clear();
  }

  async ask(projectId: string, agentId: string, text: string): Promise<OfficeDecision> {
    const project = this.deps.project(projectId);
    const s = this.state(projectId);
    const agent = officeAgent(s.layout, agentId);
    if (!agent) throw new Error("Esse agente não está na equipe.");
    if (s.thinking.includes(agent.id)) throw new Error(`${agent.name} ainda está respondendo.`);
    const chat = (s.chats[agent.id] ??= []);
    chat.push({ who: "chefe", text });
    s.thinking.push(agent.id);
    this.emit(s);
    let decision: OfficeDecision & { title?: string };
    try {
      decision = await this.decide(project, s.layout.agents, agent, chat);
    } catch (error) {
      decision = {
        action: "esclarecer",
        reply: `Não consegui pensar nisso agora (${(error as Error).message}). Tenta de novo?`,
      };
    } finally {
      s.thinking = s.thinking.filter((id) => id !== agent.id);
    }
    chat.push({ who: "agente", text: decision.reply });
    if (decision.action === "aceitar") {
      const job: OfficeJob = {
        id: randomUUID(),
        agentId: agent.id,
        agentName: agent.name,
        title: decision.title || text.slice(0, 120),
        request: text,
        status: "fila",
        activity: "",
        result: "",
        notes: [],
        read: false,
        createdAt: new Date().toISOString(),
      };
      this.contexts.set(job.id, conversation(agent, chat));
      note(job, "Chefe", "pedido", text);
      s.jobs.unshift(job);
      chat.push({ who: "sistema", text: `Tarefa criada: ${job.title}` });
      decision.jobId = job.id;
    }
    if (chat.length > KEEP_MESSAGES) chat.splice(0, chat.length - KEEP_MESSAGES);
    this.trim(s);
    this.emit(s);
    this.pump(projectId);
    const { title: _title, ...answer } = decision;
    return answer;
  }

  private trim(s: OfficeState) {
    const done = (j: OfficeJob) => j.status === "entregue" || j.status === "erro";
    while (s.jobs.length > KEEP_JOBS) {
      const i = s.jobs.map(done).lastIndexOf(true);
      if (i < 0) break;
      const [gone] = s.jobs.splice(i, 1);
      this.plans.delete(gone.id);
      this.contexts.delete(gone.id);
    }
  }

  private async decide(
    project: Project,
    team: OfficeAgent[],
    agent: OfficeAgent,
    chat: OfficeMessage[],
  ): Promise<OfficeDecision & { title?: string }> {
    const prompt = `${persona(agent, project)}

Equipe:
${teamText(team)}

O chefe veio até a sua mesa. Decida o que fazer com a ÚLTIMA mensagem dele:
- "aceitar": é da sua área e dá para começar. Não peça detalhes à toa: o projeto está na pasta e você vai poder lê-lo.
- "encaminhar": é trabalho de outra pessoa da equipe. Diga quem em "para" e, na fala, mande o chefe até a mesa dela(e).
- "esclarecer": é da sua área mas falta algo essencial, ou é só conversa. Responda naturalmente.

Conversa:
${conversation(agent, chat)}

Responda só com JSON: {"acao":"aceitar|encaminhar|esclarecer","para":"id ou null","fala":"resposta ao chefe em português do Brasil, 1 ou 2 frases curtas, com a sua personalidade","titulo":"título curto da tarefa, só se aceitar"}`;
    const data = parseJson(await this.run(prompt, { cwd: project.path, tools: [], model: "haiku", maxTurns: 1 }));
    const reply = str(data?.fala);
    const action = str(data?.acao);
    if (!data || !reply) throw new Error("resposta fora do formato");
    if (action === "encaminhar") {
      const to = team.find((a) => a.id === str(data.para));
      if (to && to.id !== agent.id) return { action: "encaminhar", to: to.id, reply };
      return { action: "esclarecer", reply };
    }
    if (action === "aceitar") return { action: "aceitar", reply, title: str(data.titulo).slice(0, 120) };
    return { action: "esclarecer", reply };
  }

  private reviewer(s: OfficeState) {
    return s.layout.reviewer ? officeAgent(s.layout, s.layout.reviewer) : undefined;
  }

  // Cada agente faz uma coisa por vez; o revisor atende os pedidos dele e as revisões na ordem.
  private pump(projectId: string) {
    if (this.stopped) return;
    const s = this.states.get(projectId);
    if (!s) return;
    const ordered = [...s.jobs].reverse();
    const reviewer = this.reviewer(s);
    for (const agent of s.layout.agents) {
      const key = `${projectId}:${agent.id}`;
      if (this.busy.has(key)) continue;
      const next = ordered.find(
        (j) =>
          (j.agentId === agent.id && j.status === "fila") ||
          (agent.id === reviewer?.id && j.status === "revisao" && !this.reviewing.has(j.id)),
      );
      if (!next) continue;
      this.busy.add(key);
      const work = next.status === "revisao" ? this.review(projectId, next, agent) : this.work(projectId, next, agent);
      void work.finally(() => {
        this.busy.delete(key);
        this.pump(projectId);
      });
    }
    // Sem revisor (ou ele saiu da equipe): o que esperava revisão segue direto para o chefe.
    if (!reviewer)
      for (const job of s.jobs)
        if (job.status === "revisao" && !this.reviewing.has(job.id)) void this.finish(projectId, job).then(() => this.emit(s));
  }

  private async work(projectId: string, job: OfficeJob, agent: OfficeAgent) {
    const s = this.state(projectId);
    const project = this.deps.project(projectId);
    job.status = "fazendo";
    job.activity = "Começando";
    job.startedAt ??= new Date().toISOString();
    // Plano já aprovado na mesa do chefe: vai direto para a implementação.
    const approvedPlan = agent.mode === "task" && job.approved ? this.plans.get(job.id) : undefined;
    if (approvedPlan) {
      note(job, agent.name, "inicio", `${agent.name} começou a implementar: ${job.title}`);
      this.emit(s);
      try {
        await this.execute(projectId, job, agent, approvedPlan);
        job.stage = "codigo";
        await this.afterWork(projectId, job, agent);
      } catch (error) {
        this.fail(job, error);
      }
      this.emit(s);
      return;
    }
    note(job, agent.name, "inicio", `${agent.name} começou: ${job.title}`);
    this.emit(s);
    const memory = this.deps.memory(projectId, job.request);
    const web = agent.web ? ", pesquisar na web (WebSearch, WebFetch)" : "";
    const base = `${persona(agent, project)}
Você pode ler os arquivos do projeto (Read, Glob, Grep)${web}. Você não pode alterar nada.
Enquanto trabalha, antes de cada ferramenta, escreva UMA frase curta em primeira pessoa, em português, dizendo o que vai fazer e por quê, como se falasse com a equipe (ex.: "Vou ver como o login confere o token."). Não cite caminhos completos de arquivos nessas frases.
${memory ? `\n${memory}\n` : ""}
Pedido do chefe: ${job.title}
Conversa em que o pedido foi feito:
${this.contexts.get(job.id) ?? job.request}
`;
    const prompt =
      agent.mode === "task"
        ? `${base}
Investigue o projeto (sem alterar nada) e monte um plano de implementação. O plano vai para a mesa do chefe, que decide se você implementa; se ele aprovar, você mesmo vai executar o plano numa branch própria.
Responda só com JSON: {"titulo":"até 60 caracteres","branch":"sufixo curto em kebab-case, sem barra","instrucoes":"o plano de execução: objetivo, arquivos envolvidos, passos e critérios de pronto, em Markdown","resumo":"2 a 4 frases para o chefe, em Markdown"}`
        : `${base}
Faça o trabalho agora. Investigue o projeto no que for útil e escreva a entrega final em Markdown, em português do Brasil, objetiva (até umas 500 palavras, a não ser que o pedido peça mais). Não faça perguntas: assuma o razoável e diga o que assumiu.`;
    try {
      const text = await this.run(prompt, {
        cwd: project.path,
        tools: officeTools(agent),
        model: MODEL[agent.model],
        maxTurns: 40,
        onTool: (name, input, raw) => {
          job.activity = describeTool(name, input);
          note(job, agent.name, "ferramenta", job.activity, `${name} ${raw}`);
          this.emit(s);
        },
        onText: (text) => {
          const said = speechFrom(text);
          if (!said || said === job.speech) return;
          job.speech = said;
          note(job, agent.name, "fala", said);
          this.emit(s);
        },
      });
      if (agent.mode === "task") {
        const data = parseJson(text);
        const plan: Plan = {
          title: str(data?.titulo).slice(0, 80) || job.title,
          branch: str(data?.branch),
          instructions: str(data?.instrucoes) || text,
          summary: str(data?.resumo),
        };
        this.plans.set(job.id, plan);
        job.result = planText(plan);
        // Implementação só com a decisão do chefe. Pedido vindo de um relatório que ele mandou
        // implementar já está aprovado; um pedido novo para aqui, como plano.
        if (job.approved) {
          await this.execute(projectId, job, agent, plan);
          job.stage = "codigo";
        } else job.stage = "plano";
      } else job.result = text.trim() || "(entrega vazia)";
      await this.afterWork(projectId, job, agent);
    } catch (error) {
      this.fail(job, error);
    }
    this.emit(s);
  }

  // Fim do trabalho do agente: vai para a revisão, ou direto para a mesa do chefe.
  private async afterWork(projectId: string, job: OfficeJob, agent: OfficeAgent) {
    const s = this.state(projectId);
    job.activity = "";
    job.speech = undefined;
    const reviewer = this.reviewer(s);
    if (!reviewer || reviewer.id === agent.id) await this.finish(projectId, job);
    else {
      job.status = "revisao";
      job.activity = `Aguardando ${reviewer.name}`;
      note(job, agent.name, "revisao", `Entregou para ${reviewer.name} revisar.`);
    }
  }

  private async review(projectId: string, job: OfficeJob, reviewer: OfficeAgent) {
    const s = this.state(projectId);
    const project = this.deps.project(projectId);
    const plan = this.plans.get(job.id);
    this.reviewing.add(job.id);
    job.activity = `${reviewer.name}: revisando`;
    job.speech = undefined;
    note(job, reviewer.name, "revisao", `${reviewer.name} começou a revisão.`);
    this.emit(s);
    const executed = Boolean(job.taskId && job.changed);
    const content = executed
      ? `Plano:\n${plan?.instructions ?? ""}\n\nResumo de quem fez:\n${job.result}\n\nArquivos alterados na branch:\n${
          job.changed!.map((c) => `- ${c.path} (${c.kind})`).join("\n") || "(nenhum)"
        }`
      : plan
        ? plan.instructions
        : job.result;
    const what = executed
      ? "a execução de uma tarefa de código (as alterações já estão nos arquivos do projeto, nesta pasta)"
      : plan
        ? "as instruções de uma tarefa para um agente de código"
        : "a entrega";
    const prompt = `${persona(reviewer, project)}
Você pode ler os arquivos do projeto (Read, Glob, Grep) para conferir. Você não pode alterar nada.
Enquanto trabalha, antes de cada ferramenta, escreva UMA frase curta em primeira pessoa, em português, dizendo o que vai fazer e por quê, como se falasse com a equipe (ex.: "Vou ver como o login confere o token."). Não cite caminhos completos de arquivos nessas frases.

${job.agentName} preparou ${what} abaixo, para o pedido do chefe "${job.title}":
-----
${content.slice(0, 20000)}
-----
${
      executed
        ? `Leia os arquivos alterados e confira se o plano foi cumprido e se há erros. Em "versao_final", escreva para o chefe o que foi feito, o que você conferiu e o que ainda falta ou preocupa, em Markdown.`
        : "Revise com olhar crítico: corrija o que estiver errado ou não bater com o projeto e complete o que faltar, mantendo o formato e um tamanho parecido."
    }
Responda só com JSON: {"notas":["até 3 observações curtas sobre o que você corrigiu, aprovou ou encontrou"],"versao_final":"o texto final completo, em Markdown"}`;
    try {
      const data = parseJson(
        await this.run(prompt, {
          cwd: project.path,
          tools: officeTools(reviewer),
          model: MODEL[reviewer.model],
          maxTurns: 25,
          onTool: (name, input, raw) => {
            const what = describeTool(name, input);
            job.activity = `${reviewer.name}: ${what}`;
            note(job, reviewer.name, "ferramenta", what, `${name} ${raw}`);
            this.emit(s);
          },
          onText: (text) => {
            const said = speechFrom(text);
            if (!said || said === job.speech) return;
            job.speech = said;
            note(job, reviewer.name, "fala", said);
            this.emit(s);
          },
        }),
      );
      const final = str(data?.versao_final);
      job.notes = Array.isArray(data?.notas) ? data.notas.map(String).filter(Boolean).slice(0, 3) : [];
      if (final) {
        job.reviewedBy = reviewer.name;
        if (executed) job.result = final;
        else if (plan) {
          plan.instructions = final;
          job.result = planText(plan);
        } else job.result = final;
      } else job.notes = [`A revisão não veio no formato esperado; segue a versão de ${job.agentName}.`];
    } catch (error) {
      job.notes = [`Revisão indisponível (${(error as Error).message}); segue a versão de ${job.agentName}.`];
    } finally {
      this.reviewing.delete(job.id);
    }
    note(job, reviewer.name, "revisao", job.notes.length ? `Revisão: ${job.notes.join(" · ")}` : "Revisão concluída.");
    await this.finish(projectId, job);
    this.emit(s);
  }

  // O agente de código executa o próprio plano: cria a tarefa, prepara a branch e trabalha pelo
  // chat do Golfinho. Cada fala, ação e pedido de permissão chega por onChat e aparece no
  // Escritório; o chefe aprova por lá. Ao terminar, guarda os arquivos alterados.
  private async execute(projectId: string, job: OfficeJob, agent: OfficeAgent, plan: Plan) {
    const s = this.state(projectId);
    const task = await this.deps.createTask(this.deps.project(projectId), plan.title, plan.instructions, plan.branch);
    job.taskId = task.id;
    note(job, agent.name, "tarefa", `Criou a tarefa "${task.title || plan.title}"${task.branch ? ` na branch ${task.branch}` : ""} e começou a executar.`);
    job.activity = "Preparando a branch";
    job.speech = "Plano pronto. Agora vou fazer as alterações.";
    this.emit(s);
    const finished = new Promise<{ ok: boolean; message?: string }>((done) =>
      this.runs.set(task.id, { projectId, job, agent, summary: "", done }),
    );
    const text = `${plan.instructions}

---
Você é ${agent.name}, ${agent.role}. Execute o plano acima agora, nesta pasta (a branch da tarefa já está ativa).
Antes de cada ferramenta, escreva UMA frase curta em primeira pessoa, em português, dizendo o que vai fazer (ex.: "Vou ajustar a validação do token."), sem caminhos completos.
Rode os testes do projeto se existirem. Não faça commit nem push: o chefe decide depois.
Ao terminar, escreva um resumo curto do que mudou e do que ficou faltando.`;
    try {
      await this.deps.runTask(task.id, text);
    } catch (error) {
      this.runs.delete(task.id);
      throw error;
    }
    const end = await finished;
    const run = this.runs.get(task.id);
    this.runs.delete(task.id);
    job.approval = undefined;
    if (run?.summary) job.result = `${plan.summary ? `${plan.summary}\n\n` : ""}${run.summary}`;
    try {
      const changes = await this.deps.changes(task.id);
      job.changed = Object.entries(changes).map(([path, kind]) => ({ path, kind }));
    } catch {
      job.changed = [];
    }
    this.deps.endRun(task.id, end.ok, end.ok ? "Escritório: execução terminada, pronta para revisar." : `Escritório: ${end.message ?? "a execução falhou"}.`);
    if (!end.ok) throw new Error(end.message ?? "a execução falhou");
    note(
      job,
      agent.name,
      "tarefa",
      job.changed.length ? `Terminou: ${job.changed.length} arquivo(s) alterado(s).` : "Terminou sem alterar arquivos.",
    );
  }

  /** Eventos do chat das tarefas: os da tarefa em execução viram falas, ações e aprovações. */
  onChat(taskId: string, event: ChatEvent) {
    const run = this.runs.get(taskId);
    if (!run) return;
    const { job, agent } = run;
    const s = this.states.get(run.projectId);
    if (event.type === "assistant") {
      for (const block of event.blocks) {
        if (block.kind === "text") {
          run.summary = block.text.trim() || run.summary;
          const said = speechFrom(block.text);
          if (said && said !== job.speech) {
            job.speech = said;
            note(job, agent.name, "fala", said);
          }
        } else {
          job.activity = describeTool(block.name, chatToolInput(block.summary));
          note(job, agent.name, "ferramenta", job.activity, `${block.name} ${block.summary}`);
        }
      }
    } else if (event.type === "approval") {
      const text = describeTool(event.toolName, chatToolInput(event.summary));
      job.approval = { id: event.id, tool: event.toolName, text, canAlways: event.canAlwaysAllow };
      job.speech = `Chefe, posso? ${text}`;
      note(job, agent.name, "fala", `Pediu permissão: ${text}`, `${event.toolName} ${event.summary}`);
    } else if (event.type === "approval_resolved") {
      if (job.approval?.id === event.id) job.approval = undefined;
      note(job, "Chefe", "revisao", event.behavior === "allow" ? "Permitiu." : "Negou.");
    } else if (event.type === "status" && event.state !== "running") {
      if (event.state === "idle") run.done({ ok: event.message !== "Interrompido." , message: event.message });
      else run.done({ ok: false, message: event.message ?? "a execução terminou com erro" });
    }
    if (s) this.emit(s);
  }

  async decidePermission(projectId: string, jobId: string, behavior: "allow" | "deny", always: boolean) {
    const job = this.state(projectId).jobs.find((j) => j.id === jobId);
    if (!job?.taskId || !job.approval) throw new Error("Não há pedido de permissão esperando.");
    await this.deps.decide(job.taskId, job.approval.id, behavior, always);
    return this.state(projectId);
  }

  // Relatório entregue → trabalho de código: vai direto para quem entrega tarefas de código,
  // com o relatório inteiro como contexto, sem passar pela decisão de quem faz.
  implement(projectId: string, jobId: string) {
    const s = this.state(projectId);
    const source = s.jobs.find((j) => j.id === jobId);
    if (!source || source.status !== "entregue") throw new Error("Só dá para implementar uma entrega pronta.");
    if (source.taskId) throw new Error("Essa entrega já é uma tarefa de código.");
    // Plano do agente de código: o mesmo trabalho volta para a fila, agora aprovado.
    if (source.stage === "plano" && this.plans.has(source.id)) {
      source.approved = true;
      source.status = "fila";
      source.read = false;
      source.finishedAt = undefined;
      note(source, "Chefe", "pedido", "Aprovou o plano: pode implementar.");
      this.emit(s);
      this.pump(projectId);
      return s;
    }
    if (source.followUp && s.jobs.some((j) => j.id === source.followUp))
      throw new Error("A implementação desse relatório já foi pedida.");
    const coder = s.layout.agents.find((a) => a.mode === "task");
    if (!coder) throw new Error("Ninguém na equipe entrega código. Configure um agente para entregar tarefas de código.");
    const request = `Implemente as recomendações de "${source.title}", de ${source.agentName}.`;
    const job: OfficeJob = {
      id: randomUUID(),
      agentId: coder.id,
      agentName: coder.name,
      title: `Implementar: ${source.title}`.slice(0, 120),
      request,
      status: "fila",
      activity: "",
      result: "",
      notes: [],
      read: false,
      createdAt: new Date().toISOString(),
      basedOn: source.id,
      approved: true,
    };
    this.contexts.set(
      job.id,
      `Chefe: ${request}\n\nRelatório de ${source.agentName}${source.reviewedBy ? ` (revisado por ${source.reviewedBy})` : ""}:\n${source.result.slice(0, 20000)}`,
    );
    note(job, "Chefe", "pedido", `${request} (a partir do relatório de ${source.agentName})`);
    source.followUp = job.id;
    note(source, "Chefe", "pedido", `Pediu a ${coder.name} para implementar.`);
    const chat = (s.chats[coder.id] ??= []);
    chat.push({ who: "sistema", text: `Tarefa criada a partir do relatório de ${source.agentName}: ${source.title}` });
    s.jobs.unshift(job);
    this.trim(s);
    this.emit(s);
    this.pump(projectId);
    return s;
  }

  // Commit pelo Escritório: os arquivos que a tarefa mudou, com o título do pedido.
  async commitJob(projectId: string, jobId: string) {
    const s = this.state(projectId);
    const job = s.jobs.find((j) => j.id === jobId);
    if (!job?.taskId) throw new Error("Esse trabalho não tem tarefa de código.");
    const changes = await this.deps.changes(job.taskId);
    const paths = Object.keys(changes);
    if (!paths.length) throw new Error("Não há alterações para commitar.");
    const message = `${job.title}\n\nFeito pelo Escritório (${job.agentName}${job.reviewedBy ? `, revisado por ${job.reviewedBy}` : ""}).`;
    await this.deps.commit(job.taskId, paths, message);
    job.committed = new Date().toISOString();
    note(job, "Chefe", "fim", `Commit feito com ${paths.length} arquivo(s).`);
    this.emit(s);
    return s;
  }

  private async finish(_projectId: string, job: OfficeJob) {
    job.status = "entregue";
    job.activity = "";
    job.speech = undefined;
    job.finishedAt = new Date().toISOString();
    note(
      job,
      job.reviewedBy ?? job.agentName,
      "fim",
      job.stage === "plano" ? "Plano na mesa do chefe, esperando a decisão de implementar." : "Entregue na mesa do chefe.",
    );
  }

  private fail(job: OfficeJob, error: unknown) {
    job.status = "erro";
    job.activity = "";
    job.error = (error as Error).message || "Falha desconhecida.";
    job.finishedAt = new Date().toISOString();
    note(job, job.agentName, "erro", job.error);
  }

  // Envio para a tela agrupado: numa rajada de ferramentas, sai no máximo um estado a cada
  // 200 ms (o último sempre sai), em vez de um por ferramenta.
  private sendTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sendPending = new Set<string>();
  private emit(s: OfficeState) {
    if (this.sendTimers.has(s.projectId)) this.sendPending.add(s.projectId);
    else {
      this.deps.emit(structuredClone(s));
      const flush = () => {
        if (this.sendPending.delete(s.projectId)) {
          const current = this.states.get(s.projectId);
          if (current) this.deps.emit(structuredClone(current));
          this.sendTimers.set(s.projectId, setTimeout(flush, 200));
        } else this.sendTimers.delete(s.projectId);
      };
      this.sendTimers.set(s.projectId, setTimeout(flush, 200));
    }
    // Gravação agrupada: a atividade muda a cada ferramenta, o banco não precisa de cada uma.
    if (!this.saveTimers.has(s.projectId))
      this.saveTimers.set(
        s.projectId,
        setTimeout(() => {
          this.saveTimers.delete(s.projectId);
          this.persist(s.projectId);
        }, 500),
      );
  }

  private persist(projectId: string) {
    const s = this.states.get(projectId);
    if (!s) return;
    const ids = new Set(s.jobs.map((j) => j.id));
    const pick = <T,>(m: Map<string, T>) => Object.fromEntries([...m].filter(([id]) => ids.has(id)));
    const saved: Saved = { ...s, thinking: [], plans: pick(this.plans), contexts: pick(this.contexts) };
    try {
      this.deps.save(projectId, saved);
    } catch (error) {
      console.error("Escritório: não foi possível salvar.", error);
    }
  }

  // Uma consulta ao Claude sem conversa: o texto final do agente, depois das ferramentas que usar.
  private async run(
    prompt: string,
    o: {
      cwd: string;
      tools: string[];
      model?: string;
      maxTurns: number;
      onTool?: (name: string, input: Record<string, unknown>, raw: string) => void;
      /** Texto que o agente escreve entre as ferramentas (a narração). */
      onText?: (text: string) => void;
    },
  ): Promise<string> {
    if (this.stopped) throw new Error("O Golfinho está encerrando.");
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const stream = query({
        prompt,
        options: {
          cwd: o.cwd,
          model: o.model,
          maxTurns: o.maxTurns,
          tools: o.tools,
          allowedTools: o.tools,
          disallowedTools: BLOCKED,
          permissionMode: "default",
          canUseTool: deny,
          abortController: controller,
          ...sdkExecutableOption(),
          ...wslSpawn(o.cwd, this.deps.executable()),
        },
      });
      let result: string | null = null;
      for await (const message of stream) {
        if (message.type === "assistant") {
          for (const part of message.message.content)
            if (part.type === "text" && message.message.content.some((p) => p.type === "tool_use")) o.onText?.(part.text);
            else if (part.type === "tool_use") {
              const input = part.input as Record<string, unknown>;
              o.onTool?.(part.name, input, summarize(part.name, input));
            }
        } else if (message.type === "result") {
          if (message.subtype !== "success")
            throw new Error((message as { errors?: string[] }).errors?.join(" ") || "a execução terminou com erro");
          result = message.result;
        }
      }
      if (result === null) throw new Error("o agente não respondeu");
      return result;
    } finally {
      this.controllers.delete(controller);
    }
  }
}

function planText(plan: Plan) {
  return `${plan.summary ? `${plan.summary}\n\n` : ""}### Tarefa: ${plan.title}\n\n${plan.instructions}`;
}
