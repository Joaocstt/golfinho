import type { Project, Task } from "../shared/contracts";
// Onde a branch da tarefa está ativa. Tarefas novas têm pasta própria; tarefas
// criadas antes dela continuam no checkout do projeto. Null significa que a
// branch ainda não existe, então não há nada para operar.
export function checkoutOf(task: Task, project: Project): string | null {
  if (task.worktreePath) return task.worktreePath;
  return task.branchCreated ? project.path : null;
}
export function requireCheckout(task: Task, project: Project): string {
  const path = checkoutOf(task, project);
  if (!path) throw new Error("Inicie a tarefa antes desta ação.");
  return path;
}
