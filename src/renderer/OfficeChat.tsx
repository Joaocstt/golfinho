import React, { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Task } from "../shared/contracts";
import type { OfficeState } from "../shared/office";
import { ChatPane } from "./ChatPane";
import { chatTask, projectTasks } from "./officeChatTask";

// O PC do chefe: só o chat do Golfinho de uma tarefa (o mesmo da aba da tarefa), sem sair do
// Escritório. Abre na tarefa que a equipe está acompanhando; dá para trocar de tarefa.
export default function OfficeChat({
  tasks,
  projectId,
  office,
  onOpenTask,
}: {
  tasks: Task[];
  projectId: string;
  office: OfficeState | null;
  onOpenTask: (taskId: string) => void;
}) {
  const list = projectTasks(tasks, projectId);
  const [taskId, setTaskId] = useState(() => chatTask(tasks, projectId, office)?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const task = list.find((t) => t.id === taskId);
  if (!list.length)
    return (
      <p className="office-muted office-chat-empty">
        Este projeto ainda não tem tarefas. Crie uma no Golfinho, ou peça algo de código para a equipe: a conversa aparece aqui.
      </p>
    );
  return (
    <div className="office-chat">
      <div className="office-chat-bar">
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Tarefa do chat">
          {list.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title || t.prompt.slice(0, 60) || "Tarefa sem título"}
            </option>
          ))}
        </select>
        {task && (
          <button type="button" onClick={() => onOpenTask(task.id)} title="Abrir a tarefa completa (diff, terminal, arquivos)">
            <ExternalLink size={13} /> Abrir a tarefa
          </button>
        )}
      </div>
      {error && <p className="office-error">{error}</p>}
      {task && (
        <div className="office-chat-body">
          <ChatPane
            key={task.id}
            taskId={task.id}
            provider={task.provider}
            model={task.model ?? null}
            permissionMode={task.permissionMode ?? null}
            effort={task.effort ?? null}
            draft={drafts[task.id] ?? ""}
            onDraftChange={(d) => setDrafts((all) => ({ ...all, [task.id]: d }))}
            onError={(e) => setError((e as Error)?.message ?? String(e))}
          />
        </div>
      )}
    </div>
  );
}
