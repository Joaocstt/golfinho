import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Provider, Request, Signal } from "../shared/contracts";
type ShellSignal = Extract<Signal, { kind: "shell" | "shellEnded" }>;
import { terminalTheme } from "./TerminalPane";
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
// Aberturas em andamento por sessão, para o efeito duplicado do StrictMode reaproveitar a mesma.
const starts = new Map<string, Promise<string>>();
// Shell limpo na pasta da tarefa. Fecha ao sair da tarefa; "Abrir novo" começa outro.
// scopeKey identifica a sessão (tarefa ou terminal geral); openSession abre o processo.
export function ShellPane({
  scopeKey,
  openSession,
  onError,
}: {
  scopeKey: string;
  openSession: () => Promise<string>;
  onError: (e: unknown) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [ended, setEnded] = useState<number | null>(null);
  const [restart, setRestart] = useState(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const openRef = useRef(openSession);
  openRef.current = openSession;
  const mounted = useRef(false);
  useEffect(() => {
    const terminal = new Terminal({
      fontFamily:
        "SF Mono,SFMono-Regular,ui-monospace,Cascadia Code,Menlo,Consolas,Liberation Mono,monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      lineHeight: 1.3,
      theme: terminalTheme,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current!);
    fit.fit();
    // Uma sessão abre no máximo um processo. Em StrictMode o efeito roda duas vezes; sem
    // isto, cada prompt inicial iniciaria um agente, e dois agentes trabalhariam na mesma pasta.
    const key = `${scopeKey}#${restart}`;
    let start = starts.get(key);
    if (!start) {
      start = openRef.current();
      starts.set(key, start);
    }
    let shellId: string | null = null;
    let alive = true;
    let endedNow = false;
    // Saída que chega antes de o id voltar do processo principal fica guardada.
    const backlog: ShellSignal[] = [];
    const apply = (signal: ShellSignal) => {
      if (signal.kind === "shell") terminal.write(signal.data);
      if (signal.kind === "shellEnded") {
        endedNow = true;
        setEnded(signal.code);
        terminal.write(`\r\n[terminal encerrado, código ${signal.code}]\r\n`);
      }
    };
    const unsubscribe = window.golfinho.subscribe((signal) => {
      if (signal.kind !== "shell" && signal.kind !== "shellEnded") return;
      if (shellId === null) backlog.push(signal);
      else if (signal.id === shellId) apply(signal);
    });
    const typed = terminal.onData((data) => {
      if (shellId && !endedNow)
        void request({ action: "shellInput", shellId, data }).catch((e) => errorRef.current(e));
    });
    // Mesmos atalhos do terminal de agentes. Colar usa a área de transferência do processo
    // principal, e o texto entra pelo onData acima, como digitação.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey)
        return true;
      const key = event.key.toLowerCase();
      if (key === "v") {
        event.preventDefault();
        void request<string>({ action: "readClipboard" })
          .then((text) => {
            if (text) terminal.paste(text);
          })
          .catch((e) => errorRef.current(e));
        return false;
      }
      if (key === "c" && terminal.hasSelection()) {
        event.preventDefault();
        void request({ action: "writeClipboard", text: terminal.getSelection() }).catch((e) =>
          errorRef.current(e),
        );
        return false;
      }
      return true;
    });
    // Clique direito cola, como em outros terminais. O xterm não tem menu de contexto próprio.
    const hostElement = host.current!;
    const rightClick = (event: MouseEvent) => {
      event.preventDefault();
      void request<string>({ action: "readClipboard" })
        .then((text) => {
          if (text) terminal.paste(text);
        })
        .catch((e) => errorRef.current(e));
    };
    hostElement.addEventListener("contextmenu", rightClick);
    const sendSize = () => {
      if (shellId && !endedNow)
        void request({
          action: "shellResize",
          shellId,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => undefined);
    };
    const observer = new ResizeObserver(() => {
      fit.fit();
      sendSize();
    });
    observer.observe(host.current!);
    mounted.current = true;
    start
      .then((id) => {
        if (alive) {
          shellId = id;
          for (const signal of backlog.splice(0)) if (signal.id === id) apply(signal);
          sendSize();
          terminal.focus();
        } else if (!mounted.current) {
          // Desmontagem de verdade: o processo que acabou de abrir não tem mais quem o veja.
          starts.delete(key);
          void request({ action: "shellClose", shellId: id }).catch(() => undefined);
        }
      })
      .catch((e) => {
        if (alive && mounted.current) errorRef.current(e);
      });
    return () => {
      alive = false;
      mounted.current = false;
      unsubscribe();
      typed.dispose();
      hostElement.removeEventListener("contextmenu", rightClick);
      observer.disconnect();
      if (shellId && !endedNow) {
        starts.delete(key);
        void request({ action: "shellClose", shellId }).catch(() => undefined);
      }
      terminal.dispose();
    };
  }, [scopeKey, restart]);
  return (
    <div className="shell-pane">
      {ended !== null && (
        <div className="shell-ended">
          O shell encerrou (código {ended}).
          <button
            onClick={() => {
              setEnded(null);
              setRestart((n) => n + 1);
            }}
          >
            Abrir novo
          </button>
        </div>
      )}
      <div ref={host} className="shell-host" />
    </div>
  );
}
