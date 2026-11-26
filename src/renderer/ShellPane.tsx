import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { Request, Signal } from "../shared/contracts";
type ShellSignal = Extract<Signal, { kind: "shell" | "shellEnded" }>;
import { searchOptions, terminalTheme } from "./TerminalPane";
import { TerminalMenu } from "./TerminalMenu";
import { clipboardToPaste, filesToPaste } from "./clipboardPaste";
import { findShortcutLabel, isFindShortcut } from "./shortcuts";
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
// Aberturas em andamento por sessão, para o efeito duplicado do StrictMode reaproveitar a mesma.
const starts = new Map<string, Promise<string>>();
// Shell limpo na pasta da tarefa. Fecha ao sair da tarefa; "Abrir novo" começa outro.
// scopeKey identifica a sessão (tarefa ou terminal geral); openSession abre o processo.
export function ShellPane({
  scopeKey,
  openSession,
  onError,
  autoFocus = true,
}: {
  scopeKey: string;
  openSession: () => Promise<string>;
  onError: (e: unknown) => void;
  autoFocus?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [ended, setEnded] = useState<number | null>(null);
  const [restart, setRestart] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState({ resultIndex: -1, resultCount: 0 });
  const terminalRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const openRef = useRef(openSession);
  openRef.current = openSession;
  const mounted = useRef(false);
  const focusAllowed = useRef(autoFocus);
  focusAllowed.current = autoFocus;

  function openSearch() {
    setMenu(null);
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInput.current?.focus();
      searchInput.current?.select();
    });
  }
  function closeSearch() {
    setSearchOpen(false);
    searchRef.current?.clearDecorations();
    terminalRef.current?.focus();
  }
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;

  useEffect(() => {
    const terminal = new Terminal({
      fontFamily:
        "SF Mono,SFMono-Regular,ui-monospace,Cascadia Code,Menlo,Consolas,Liberation Mono,monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      lineHeight: 1.3,
      allowProposedApi: true,
      theme: terminalTheme,
    });
    const fit = new FitAddon();
    const search = new SearchAddon({ highlightLimit: 1000 });
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(host.current!);
    fit.fit();
    searchRef.current = search;
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
    const resultSub = search.onDidChangeResults((r) => {
      if (alive) setResults(r);
    });
    // Mesmos atalhos do terminal de agentes (Ctrl+F / Cmd+F para busca em todos os SOs).
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (isFindShortcut(event)) {
        event.preventDefault();
        openSearchRef.current();
        return false;
      }
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return true;
      const key = event.key.toLowerCase();
      if (key === "v") {
        event.preventDefault();
        void clipboardToPaste(request)
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
    // Clique direito abre o menu, como no terminal dos agentes.
    const hostElement = host.current!;
    terminalRef.current = terminal;
    const rightClick = (event: MouseEvent) => {
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY });
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
          if (focusAllowed.current) terminal.focus();
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
      resultSub.dispose();
      hostElement.removeEventListener("contextmenu", rightClick);
      terminalRef.current = null;
      searchRef.current = null;
      observer.disconnect();
      if (shellId && !endedNow) {
        starts.delete(key);
        void request({ action: "shellClose", shellId }).catch(() => undefined);
      }
      terminal.dispose();
    };
  }, [scopeKey, restart]);

  useEffect(() => {
    if (searchOpen && query) searchRef.current?.findNext(query, { ...searchOptions, incremental: true });
    else {
      searchRef.current?.clearDecorations();
      setResults({ resultIndex: -1, resultCount: 0 });
    }
  }, [query, searchOpen, scopeKey, restart]);

  function dragOver(e: React.DragEvent<HTMLDivElement>) {
    if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
  }
  function dropFiles(e: React.DragEvent<HTMLDivElement>) {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    try {
      terminalRef.current?.paste(filesToPaste(e.dataTransfer.files));
      terminalRef.current?.focus();
    } catch (err) {
      errorRef.current(err);
    }
  }
  return (
    <div
      className="shell-pane"
      onDragOver={dragOver}
      onDrop={dropFiles}
      onKeyDown={(e) => {
        if (isFindShortcut(e.nativeEvent)) {
          e.preventDefault();
          e.stopPropagation();
          openSearch();
        }
      }}
    >
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
      <div className="shell-tools">
        <button
          type="button"
          title={`Buscar no shell (${findShortcutLabel()})`}
          aria-label="Buscar no shell"
          aria-pressed={searchOpen}
          onClick={() => (searchOpen ? closeSearch() : openSearch())}
        >
          <Search size={13} />
        </button>
      </div>
      {searchOpen && (
        <div className="terminal-search">
          <Search size={12} />
          <input
            ref={searchInput}
            type="search"
            aria-label="Texto no shell"
            placeholder="Buscar no histórico"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) searchRef.current?.findPrevious(query, searchOptions);
                else searchRef.current?.findNext(query, searchOptions);
              }
            }}
          />
          <span role="status">
            {results.resultCount
              ? `${results.resultIndex >= 0 ? results.resultIndex + 1 : "—"} de ${results.resultCount}`
              : query
                ? "Nenhum resultado"
                : ""}
          </span>
          <button
            type="button"
            aria-label="Resultado anterior"
            title="Resultado anterior (Shift+Enter)"
            disabled={!query}
            onClick={() => searchRef.current?.findPrevious(query, searchOptions)}
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            aria-label="Próximo resultado"
            title="Próximo resultado (Enter)"
            disabled={!query}
            onClick={() => searchRef.current?.findNext(query, searchOptions)}
          >
            <ChevronDown size={12} />
          </button>
          <button
            type="button"
            aria-label="Fechar busca do shell"
            title="Fechar busca (Esc)"
            onClick={closeSearch}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {menu && (
        <TerminalMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Copiar",
              shortcut: "Ctrl+Shift+C",
              disabled: !terminalRef.current?.hasSelection(),
              onSelect: () => {
                const text = terminalRef.current?.getSelection();
                if (text)
                  void request({ action: "writeClipboard", text }).catch((e) => errorRef.current(e));
              },
            },
            {
              label: "Colar",
              shortcut: "Ctrl+Shift+V",
              onSelect: () =>
                void clipboardToPaste(request)
                  .then((text) => {
                    if (text) terminalRef.current?.paste(text);
                  })
                  .catch((e) => errorRef.current(e)),
            },
            { label: "Selecionar tudo", onSelect: () => terminalRef.current?.selectAll() },
            { label: "Buscar", shortcut: findShortcutLabel(), onSelect: openSearch },
          ]}
        />
      )}
    </div>
  );
}
