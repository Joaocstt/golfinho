import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Signal, TerminalReplay } from "../shared/contracts";
export interface Logs {
  append(id: string, data: string): void;
  replay(id: string): TerminalReplay;
  remove(id: string): void;
}
const TAIL = 512_000;
const DISK_TAIL = 2 * 1024 * 1024;
// Uma CLI interativa emite muitos pedaços pequenos por segundo, e cada um custava
// um appendFileSync (abre, escreve, fecha) mais um IPC no processo que desenha a
// janela. Agrupar por tempo ou tamanho troca milhares dessas operações por dezenas.
const FLUSH_MS = 32;
const MAX_PENDING = 64 * 1024;
// A cauda em memória custa até 512 mil caracteres por tarefa. Guardar todas as que
// a sessão tocou prenderia dezenas de MiB, então as mais antigas são descartadas e
// relidas do arquivo quando voltam. offset e bytes continuam, ou o renderer perderia
// a referência que usa para descartar o que já reproduziu.
const LOADED_TASKS = 20;
interface Entry {
  data: string;
  loaded: boolean;
  offset: number;
  bytes: number;
  pending: string[];
  pendingOffset: number;
  pendingLength: number;
}
export class TerminalLogs implements Logs {
  private cache = new Map<string, Entry>();
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private directory: string,
    private signal: (s: Signal) => void,
  ) {}
  private file(id: string) {
    return join(this.directory, `${id}.log`);
  }
  private read(id: string) {
    const file = this.file(id);
    return existsSync(file) ? readFileSync(file, "utf8").slice(-TAIL) : "";
  }
  private entry(id: string) {
    const known = this.cache.get(id);
    if (known) {
      this.cache.delete(id);
      this.cache.set(id, known);
      if (!known.loaded) {
        known.data = this.read(id);
        known.loaded = true;
        this.evict();
      }
      return known;
    }
    const data = this.read(id);
    const fresh: Entry = {
      data,
      loaded: true,
      offset: data.length,
      bytes: Buffer.byteLength(data),
      pending: [],
      pendingOffset: data.length,
      pendingLength: 0,
    };
    this.cache.set(id, fresh);
    this.evict();
    return fresh;
  }
  private evict() {
    let loaded = 0;
    for (const e of this.cache.values()) if (e.loaded) loaded++;
    if (loaded <= LOADED_TASKS) return;
    for (const e of this.cache.values()) {
      if (loaded <= LOADED_TASKS) break;
      if (!e.loaded || e.pending.length) continue;
      e.data = "";
      e.loaded = false;
      loaded--;
    }
  }
  append(id: string, data: string) {
    if (!data) return;
    const e = this.entry(id);
    if (!e.pending.length) e.pendingOffset = e.offset;
    e.pending.push(data);
    e.pendingLength += data.length;
    e.offset += data.length;
    this.dirty.add(id);
    if (e.pendingLength >= MAX_PENDING) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }
  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const ids = [...this.dirty];
    this.dirty.clear();
    for (const id of ids) {
      const e = this.cache.get(id);
      if (!e?.pending.length) continue;
      const text = e.pending.join("");
      const offset = e.pendingOffset;
      e.pending = [];
      e.pendingLength = 0;
      e.data = (e.data + text).slice(-TAIL);
      e.bytes += Buffer.byteLength(text);
      const file = this.file(id);
      // A escrita acontece fora da chamada que produziu o texto, num timer: deixar
      // o erro escapar derrubaria o processo principal. Sem o disco a sessão segue
      // pela cauda em memória, que é o que o terminal e o replay leem.
      try {
        if (e.bytes > DISK_TAIL) {
          writeFileSync(file, e.data, { mode: 0o600 });
          e.bytes = Buffer.byteLength(e.data);
        } else appendFileSync(file, text, { mode: 0o600 });
      } catch {
        /* log do terminal é melhor-esforço; a saída ao vivo não depende dele */
      }
      this.signal({ kind: "terminal", taskId: id, data: text, offset });
    }
    this.evict();
  }
  // Sem isto o log de uma tarefa excluída ficaria órfão no disco para sempre.
  remove(id: string) {
    this.cache.delete(id);
    this.dirty.delete(id);
    try {
      rmSync(this.file(id), { force: true });
    } catch {
      /* já não existe ou não pode ser removido */
    }
  }
  replay(id: string): TerminalReplay {
    const e = this.entry(id);
    const data = e.pending.length ? (e.data + e.pending.join("")).slice(-TAIL) : e.data;
    return { data, nextOffset: e.offset };
  }
}
