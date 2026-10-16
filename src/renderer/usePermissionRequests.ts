import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "../shared/contracts";
import { PermissionRequests, type PermissionRequest } from "./permissionRequests";

export function usePermissionRequests(tasks: Task[] | undefined) {
  const tracker = useRef(new PermissionRequests());
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  useEffect(() => window.golfinho.subscribe((signal) => {
    if (tracker.current.receive(signal)) setPending(tracker.current.items);
  }), []);
  useEffect(() => {
    if (tasks && tracker.current.syncTasks(tasks)) setPending(tracker.current.items);
  }, [tasks]);
  const answeredTerminal = useCallback((taskId: string, data: string) => {
    if (tracker.current.answeredTerminal(taskId, data)) setPending(tracker.current.items);
  }, []);
  return { pending, answeredTerminal };
}
