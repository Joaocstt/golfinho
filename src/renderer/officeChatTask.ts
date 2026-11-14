import type { Task } from "../shared/contracts";
import type { OfficeState } from "../shared/office";

/** Tarefas do projeto que têm conversa, as mais recentes primeiro. */
export function projectTasks(tasks: Task[], projectId: string): Task[] {
  return tasks.filter((t) => t.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * A tarefa que o PC do chefe mostra: a que o Escritório está acompanhando agora (o chat em
 * andamento, ou o último trabalho com tarefa); sem nenhuma, a tarefa mais recente do projeto.
 */
export function chatTask(tasks: Task[], projectId: string, office: OfficeState | null): Task | undefined {
  const list = projectTasks(tasks, projectId);
  const jobs = office?.jobs ?? [];
  const live = jobs.find((j) => j.taskId && j.status === "fazendo");
  const recent = live ?? jobs.find((j) => j.taskId);
  return (recent && list.find((t) => t.id === recent.taskId)) || list[0];
}
