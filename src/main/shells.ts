import { randomUUID } from "node:crypto";
import type { Driver, Handle } from "./coordinator";
import type { Signal } from "../shared/contracts";
// Shell avulso na pasta da tarefa: sem a CLI do agente, sem fila e sem bloqueio. É o
// terminal que você usaria no próprio editor, só que já posicionado na pasta certa.
interface Session {
  taskId: string;
  handle: Handle;
}
export class Shells {
  private sessions = new Map<string, Session>();
  constructor(
    private driver: Driver,
    private emit: (signal: Signal) => void,
  ) {}
  // Sessão avulsa: um shell ou um agente sem prompt, na pasta da tarefa. Não passa pela
  // fila, não muda o status da tarefa e não entra nos checks.
  async open(
    taskId: string,
    cwd: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
  ) {
    const id = randomUUID();
    const handle = await this.driver.start(
      command,
      args,
      cwd,
      (data) => this.emit({ kind: "shell", id, data }),
      (code) => {
        this.sessions.delete(id);
        this.emit({ kind: "shellEnded", id, code });
      },
      env,
    );
    this.sessions.set(id, { taskId, handle });
    return id;
  }
  private session(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Este terminal já foi encerrado. Abra outro.");
    return session;
  }
  input(id: string, data: string) {
    this.session(id).handle.write(data);
  }
  resize(id: string, cols: number, rows: number) {
    this.session(id).handle.resize(cols, rows);
  }
  close(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.handle.stop();
  }
  closeTask(taskId: string) {
    for (const [id, session] of [...this.sessions]) if (session.taskId === taskId) this.close(id);
  }
  closeAll() {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}
