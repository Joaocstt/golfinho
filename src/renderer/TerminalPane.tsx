import React, { useEffect, useRef, useState } from "react";
import { Terminal, type IBufferRange } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { Request, TerminalReplay } from "../shared/contracts";
export interface TerminalPaneProps {
  taskId: string;
  active?: boolean;
  provider?: string;
  status?: string;
  onError: (e: unknown) => void;
}
interface Position {
  line: number;
  following: boolean;
  selection?: IBufferRange;
}
const positions = new Map<string, Position>();
const FONT_KEY = "golfinho.terminal.fontSize";
const DEFAULT_FONT = 14;
const clamp = (size: number) => Math.max(10, Math.min(22, size));
// A saída das CLIs é quase toda colorida. Uma paleta própria mantém negrito, erro e
// diff legíveis sobre este fundo, em vez do vermelho/verde saturado padrão do xterm.
export const terminalTheme = {
  background: "#282c34",
  foreground: "#c6d7e8",
  cursor: "#fafafa",
  cursorAccent: "#282c34",
  selectionBackground: "#3e4a5b",
  selectionForeground: "#ffffff",
  black: "#3f4451",
  red: "#e06c75",
  green: "#8cc265",
  yellow: "#d6a35c",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#c6ccd7",
  brightBlack: "#6b7384",
  brightRed: "#ec8d94",
  brightGreen: "#a5d684",
  brightYellow: "#e5c07b",
  brightBlue: "#7cc3ff",
  brightMagenta: "#d7a0ea",
  brightCyan: "#73c7d1",
  brightWhite: "#e6e9ef",
};
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
const searchOptions: ISearchOptions = {
  decorations: {
    matchBackground: "#5e512c",
    activeMatchBackground: "#976e2e",
    matchOverviewRuler: "#c7a594",
    activeMatchColorOverviewRuler: "#fafafa",
  },
};
function initialFont() {
  try {
    const size = Number(localStorage.getItem(FONT_KEY));
    return Number.isFinite(size) && size >= 10 ? clamp(size) : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}
export function TerminalPane({ taskId, active = false, provider, status, onError }: TerminalPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const ready = useRef(active);
  const error = useRef(onError);
  ready.current = active;
  error.current = onError;
  const runtime = useRef<{ resize: () => void; following: boolean; alive: boolean } | null>(null);
  const [fontSize, setFontSize] = useState(initialFont);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState({ resultIndex: -1, resultCount: 0 });
  const [reading, setReading] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [clipboardBusy, setClipboardBusy] = useState(false);
  function zoom(amount: number | "reset") {
    setFontSize((size) => (amount === "reset" ? DEFAULT_FONT : clamp(size + amount)));
  }
  function openSearch() {
    setMenuOpen(false);
    setSearchOpen(true);
  }
  function closeSearch() {
    setSearchOpen(false);
    searchRef.current?.clearDecorations();
    terminalRef.current?.focus();
  }
  async function copy() {
    const current = terminalRef.current;
    const text = current?.getSelection();
    if (!text) return;
    setClipboardBusy(true);
    try {
      await request({ action: "writeClipboard", text });
    } catch (e) {
      error.current(e);
    } finally {
      if (terminalRef.current === current) setClipboardBusy(false);
    }
  }
  async function paste() {
    const current = terminalRef.current;
    if (!current || clipboardBusy) return;
    // Sem CLI rodando não há para onde mandar o texto: avisa em vez de ignorar.
    if (!ready.current) {
      error.current(new Error("A CLI não está rodando. Inicie a tarefa para colar aqui."));
      return;
    }
    setClipboardBusy(true);
    try {
      const text = await request<string>({ action: "readClipboard" });
      if (terminalRef.current !== current || !ready.current) return;
      if (new TextEncoder().encode(text).length > 64 * 1024)
        throw new Error("O texto para colar excede 64 KiB.");
      current.paste(text);
      current.focus();
    } catch (e) {
      error.current(e);
    } finally {
      if (terminalRef.current === current) setClipboardBusy(false);
    }
  }
  const commands = useRef({ copy, paste, zoom, openSearch });
  commands.current = { copy, paste, zoom, openSearch };
  function keyHandler(event: KeyboardEvent) {
    if (event.type !== "keydown" || !event.ctrlKey || event.altKey || event.metaKey) return true;
    const key = event.key.toLowerCase();
    let handled = true;
    if (event.shiftKey && key === "f") commands.current.openSearch();
    else if (event.shiftKey && key === "c") void commands.current.copy();
    else if (event.shiftKey && key === "v") void commands.current.paste();
    else if (key === "+" || key === "=") commands.current.zoom(1);
    else if (key === "-") commands.current.zoom(-1);
    else if (key === "0") commands.current.zoom("reset");
    else handled = false;
    if (handled) {
      event.preventDefault();
      return false;
    }
    return true;
  }
  useEffect(() => {
    const terminal = new Terminal({
      fontFamily:
        "SF Mono,SFMono-Regular,ui-monospace,Cascadia Code,Menlo,Consolas,Liberation Mono,monospace",
      fontSize,
      cursorBlink: ready.current,
      disableStdin: !ready.current,
      scrollback: 10000,
      scrollOnUserInput: false,
      lineHeight: 1.3,
      // O destaque de resultados da busca usa registerDecoration, uma API proposta do xterm.
      allowProposedApi: true,
      theme: terminalTheme,
    });
    const fit = new FitAddon();
    const search = new SearchAddon({ highlightLimit: 1000 });
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(host.current!);
    terminalRef.current = terminal;
    searchRef.current = search;
    let alive = true;
    let replaying = true;
    let cursor = 0;
    const buffer: { offset: number; data: string }[] = [];
    const saved = positions.get(taskId);
    const state = { alive: true, following: saved?.following ?? true, resize: () => {} };
    runtime.current = state;
    setReading(!state.following);
    setHasSelection(!!terminal.getSelection());
    const restoreSelection = (selection: IBufferRange | undefined) => {
      if (selection)
        terminal.select(
          selection.start.x,
          selection.start.y,
          (selection.end.y - selection.start.y) * terminal.cols +
            selection.end.x -
            selection.start.x,
        );
    };
    const write = (data: string, restore?: Position, after?: () => void) => {
      if (!alive) return;
      const line = restore?.line ?? terminal.buffer.active.viewportY;
      const follow = restore?.following ?? state.following;
      const selection = restore?.selection ?? terminal.getSelectionPosition();
      terminal.write(data, () => {
        if (!alive) return;
        if (follow) terminal.scrollToBottom();
        else terminal.scrollToLine(line);
        restoreSelection(selection);
        if (!ready.current) terminal.write("\x1b[?25l");
        after?.();
      });
    };
    const append = (frame: { offset: number; data: string }) => {
      if (!alive) return;
      const skip = Math.max(0, cursor - frame.offset);
      if (skip < frame.data.length) {
        write(frame.data.slice(skip));
        cursor = frame.offset + frame.data.length;
      }
    };
    const unsubscribe = window.golfinho.subscribe((s) => {
      if (!alive) return;
      if (s.kind === "terminal" && s.taskId === taskId) {
        if (replaying) buffer.push(s);
        else append(s);
      }
    });
    request<TerminalReplay>({ action: "terminal", taskId })
      .then((history) => {
        if (!alive) return;
        cursor = history.nextOffset;
        write(history.data, saved, () => {
          buffer.forEach(append);
          buffer.length = 0;
          replaying = false;
        });
      })
      .catch((e) => {
        if (!alive) return;
        replaying = false;
        buffer.forEach(append);
        error.current(e);
      });
    const input = terminal.onData((data) => {
      if (alive && ready.current)
        request({ action: "input", taskId, data }).catch((e) => {
          if (alive) error.current(e);
        });
    });
    const scroll = terminal.onScroll(() => {
      if (!alive) return;
      state.following = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
      setReading(!state.following);
    });
    const selection = terminal.onSelectionChange(() => {
      if (alive) setHasSelection(!!terminal.getSelection());
    });
    const result = search.onDidChangeResults((r) => {
      if (alive) setResults(r);
    });
    terminal.attachCustomKeyEventHandler(keyHandler);
    state.resize = () => {
      if (!alive) return;
      fit.fit();
      request({ action: "resize", taskId, cols: terminal.cols, rows: terminal.rows }).catch((e) => {
        if (alive && ready.current) error.current(e);
      });
    };
    const observer = new ResizeObserver(state.resize);
    observer.observe(host.current!);
    state.resize();
    return () => {
      positions.delete(taskId);
      positions.set(taskId, {
        line: terminal.buffer.active.viewportY,
        following: state.following,
        selection: terminal.getSelectionPosition(),
      });
      while (positions.size > 50) positions.delete(positions.keys().next().value!);
      alive = false;
      state.alive = false;
      unsubscribe();
      observer.disconnect();
      input.dispose();
      scroll.dispose();
      selection.dispose();
      result.dispose();
      terminalRef.current = null;
      searchRef.current = null;
      runtime.current = null;
      terminal.dispose();
    };
  }, [taskId]);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.disableStdin = !active;
    terminal.options.cursorBlink = active;
    terminal.write(active ? "\x1b[?25h" : "\x1b[?25l");
    if (active) runtime.current?.resize();
  }, [active, taskId]);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.options.fontSize = fontSize;
      runtime.current?.resize();
    }
    try {
      localStorage.setItem(FONT_KEY, String(fontSize));
    } catch {}
  }, [fontSize, taskId]);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (searchOpen && query) searchRef.current?.findNext(query, { ...searchOptions, incremental: true });
    else {
      searchRef.current?.clearDecorations();
      setResults({ resultIndex: -1, resultCount: 0 });
    }
  }, [query, searchOpen, taskId]);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: Event) => {
      if (!tools.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menuOpen]);
  function bottom() {
    if (runtime.current) runtime.current.following = true;
    terminalRef.current?.scrollToBottom();
    setReading(false);
    terminalRef.current?.focus();
  }
  function clear() {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.clear();
    bottom();
  }
  // Menu actions close the menu and return the caret to the terminal; zoom repeats in place.
  function run(action: () => void) {
    setMenuOpen(false);
    action();
  }
  // Com a CLI pronta o cursor já indica que o terminal aceita entrada; só os estados
  // em que digitar não faz nada merecem ocupar espaço permanente na tela.
  const flag = active ? "" : status === "running" ? "Preparando CLI" : "Somente leitura";
  return (
    <div
      className="terminal-pane"
      data-chrome={searchOpen || menuOpen ? "open" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          terminalRef.current?.focus();
          return;
        }
        if ((e.target as HTMLElement).closest(".xterm")) return;
        if (!keyHandler(e.nativeEvent)) e.stopPropagation();
      }}
    >
      <div
        className="terminal-host"
        ref={host}
        // Clique direito cola, como no shell. O xterm não tem menu de contexto próprio.
        onContextMenu={(e) => {
          e.preventDefault();
          void commands.current.paste();
        }}
      />
      <div className="terminal-chrome">
        {flag && (
          <span className="terminal-flag">
            {provider && <strong>{provider}</strong>}
            {flag}
          </span>
        )}
        <div className="terminal-tools" ref={tools}>
          <button
            title="Buscar no terminal (Ctrl+Shift+F)"
            aria-label="Buscar no terminal"
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
          >
            <Search size={13} />
          </button>
          <button
            title="Mais ações do terminal"
            aria-label="Mais ações do terminal"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Ellipsis size={13} />
          </button>
          {menuOpen && (
            <div className="terminal-menu" role="group" aria-label="Ações do terminal">
              <div className="terminal-menu-font" role="group" aria-label="Tamanho da fonte">
                <span>Fonte</span>
                <button
                  title="Diminuir fonte (Ctrl+-)"
                  aria-label="Diminuir fonte do terminal"
                  disabled={fontSize <= 10}
                  onClick={() => zoom(-1)}
                >
                  <Minus size={12} />
                </button>
                <button
                  title="Restaurar fonte (Ctrl+0)"
                  aria-label="Restaurar tamanho da fonte"
                  onClick={() => zoom("reset")}
                >
                  {fontSize}
                </button>
                <button
                  title="Aumentar fonte (Ctrl++)"
                  aria-label="Aumentar fonte do terminal"
                  disabled={fontSize >= 22}
                  onClick={() => zoom(1)}
                >
                  <Plus size={12} />
                </button>
              </div>
              <button
                aria-label="Copiar seleção"
                disabled={!hasSelection || clipboardBusy}
                onClick={() => run(() => void copy())}
              >
                Copiar seleção<kbd>Ctrl+Shift+C</kbd>
              </button>
              <button
                aria-label="Colar no terminal"
                disabled={!active || clipboardBusy}
                onClick={() => run(() => void paste())}
              >
                Colar sem Enter<kbd>Ctrl+Shift+V</kbd>
              </button>
              <button
                aria-label="Selecionar tudo no terminal"
                onClick={() => run(() => terminalRef.current?.selectAll())}
              >
                Selecionar tudo
              </button>
              <button
                aria-label="Limpar somente a tela"
                title="Limpar somente a tela; mantém o histórico salvo"
                onClick={() => run(clear)}
              >
                Limpar a tela
              </button>
            </div>
          )}
        </div>
      </div>
      {searchOpen && (
        <div className="terminal-search">
          <Search size={12} />
          <input
            ref={searchInput}
            type="search"
            aria-label="Texto no terminal"
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
            aria-label="Resultado anterior"
            title="Resultado anterior"
            disabled={!query}
            onClick={() => searchRef.current?.findPrevious(query, searchOptions)}
          >
            <ChevronUp size={12} />
          </button>
          <button
            aria-label="Próximo resultado"
            title="Próximo resultado"
            disabled={!query}
            onClick={() => searchRef.current?.findNext(query, searchOptions)}
          >
            <ChevronDown size={12} />
          </button>
          <button
            aria-label="Fechar busca do terminal"
            title="Fechar busca (Esc)"
            onClick={closeSearch}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {reading && (
        <button
          className="terminal-bottom"
          aria-label="Voltar ao fim do terminal"
          onClick={bottom}
        >
          <ArrowDown size={12} />
          Voltar ao fim
        </button>
      )}
    </div>
  );
}
