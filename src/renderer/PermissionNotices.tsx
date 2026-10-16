import React from "react";
import { ShieldQuestion } from "lucide-react";
import type { Task } from "../shared/contracts";
import type { PermissionRequest } from "./permissionRequests";

export function PermissionNotices({ pending, tasks, onOpen }: {
  pending: PermissionRequest[];
  tasks: Task[];
  onOpen: (request: PermissionRequest) => void;
}) {
  const notices = pending.flatMap((request) => {
    const task = tasks.find((task) => task.id === request.taskId);
    return task ? [{ request, task }] : [];
  });
  if (!notices.length) return null;
  return <section className="permission-notices" aria-label="Pedidos de permissão">
    {notices.map(({ request, task }) => <div className="permission-notice" key={request.key} role="status">
      <ShieldQuestion size={17} aria-hidden="true" />
      <div><strong>{task.branch} precisa de permissão</strong><span>O agente aguarda sua resposta no {request.source}.</span></div>
      <button aria-label={`Abrir pedido de ${task.branch} no ${request.source}`} onClick={() => onOpen(request)}>
        Abrir pedido
      </button>
    </div>)}
  </section>;
}
