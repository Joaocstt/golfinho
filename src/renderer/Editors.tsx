import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff, RefreshCw } from "lucide-react";
import { FileTypeIcon } from "./fileIcons";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type { Changes, FileChange, Request, TreeEntry, TreeListing } from "../shared/contracts";
import { languageFor } from "./language";
import { countLines } from "./diffStats";
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
export { TerminalPane } from "./TerminalPane";
// Mesmas cores da árvore e dos chips: verde para o que entrou, vermelho para o que saiu.
// Os tons são mais fortes que os do vs-dark, para a diferença ser vista de relance.
const DIFF_THEME = "golfinho-diff";
let diffThemeReady = false;
function ensureDiffTheme() {
  if (diffThemeReady) return;
  monaco.editor.defineTheme(DIFF_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "diffEditor.insertedLineBackground": "#98c37924",
      "diffEditor.removedLineBackground": "#e06c7530",
      "diffEditor.insertedTextBackground": "#98c3794d",
      "diffEditor.removedTextBackground": "#e06c755c",
      "diffEditorGutter.insertedLineBackground": "#98c379",
      "diffEditorGutter.removedLineBackground": "#e06c75",
      "diffEditor.border": "#ffffff14",
    },
  });
  diffThemeReady = true;
}
const VIEW_KEY = "golfinho.diff.sideBySide";
function savedSideBySide() {
  try {
    return localStorage.getItem(VIEW_KEY) === "1";
  } catch {
    return false;
  }
}
// Diff de um arquivo. Por padrão mostra só os trechos alterados (com contexto) em modo unificado,
// que é o jeito mais rápido de ver o que mudou; o resto do arquivo abre ao clicar na faixa recolhida.
export function DiffPane({ file }: { file: FileChange }) {
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [sideBySide, setSideBySide] = useState(savedSideBySide);
  const [showAll, setShowAll] = useState(false);
  const [stats, setStats] = useState<{ added: number; removed: number; hunks: number } | null>(null);
  useEffect(() => {
    if (file.binary || file.error) return;
    ensureDiffTheme();
    setStats(null);
    const language = languageOf(file.path);
    const original = monaco.editor.createModel(file.original, language);
    const modified = monaco.editor.createModel(file.modified, language);
    const editor = monaco.editor.createDiffEditor(host.current!, {
      theme: DIFF_THEME,
      automaticLayout: true,
      readOnly: true,
      minimap: { enabled: false },
      fontSize: 13,
      renderSideBySide: savedSideBySide(),
      // A escolha vem do botão Unificado/Lado a lado. Sem isto, o Monaco força o unificado
      // abaixo de 900 px de largura e o botão parece não funcionar.
      useInlineViewWhenSpaceIsLimited: false,
      renderMarginRevertIcon: false,
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 },
    });
    editor.setModel({ original, modified });
    editorRef.current = editor;
    let first = true;
    const updated = editor.onDidUpdateDiff(() => {
      const changes = editor.getLineChanges() ?? [];
      setStats(countLines(changes));
      // Na primeira vez, já leva à primeira mudança.
      if (first && changes.length) {
        first = false;
        const line = changes[0].modifiedStartLineNumber || changes[0].modifiedEndLineNumber || 1;
        editor.getModifiedEditor().revealLineInCenter(line);
      }
    });
    return () => {
      updated.dispose();
      editorRef.current = null;
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [file]);
  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide, useInlineViewWhenSpaceIsLimited: false });
    try {
      localStorage.setItem(VIEW_KEY, sideBySide ? "1" : "0");
    } catch {}
  }, [sideBySide]);
  useEffect(() => {
    editorRef.current?.updateOptions({ hideUnchangedRegions: { enabled: !showAll } });
  }, [showAll]);
  if (file.error) return <div className="empty">Não foi possível ler este arquivo: {file.error}</div>;
  if (file.binary) return <div className="empty">Arquivo binário: revisão textual indisponível.</div>;
  return (
    <div className="diff-pane">
      <div className="diff-toolbar">
        <span className="diff-stats" aria-live="polite">
          {stats ? (
            stats.hunks ? (
              <>
                <b className="diff-added">+{stats.added}</b>
                <b className="diff-removed">−{stats.removed}</b>
                <span>
                  {stats.hunks} {stats.hunks === 1 ? "trecho alterado" : "trechos alterados"}
                </span>
              </>
            ) : (
              <span>Sem diferenças de conteúdo</span>
            )
          ) : (
            <span>Comparando…</span>
          )}
        </span>
        <div className="diff-nav">
          <button
            title="Mudança anterior"
            aria-label="Mudança anterior"
            disabled={!stats?.hunks}
            onClick={() => editorRef.current?.goToDiff("previous")}
          >
            <ChevronUp size={14} /> Anterior
          </button>
          <button
            title="Próxima mudança"
            aria-label="Próxima mudança"
            disabled={!stats?.hunks}
            onClick={() => editorRef.current?.goToDiff("next")}
          >
            <ChevronDown size={14} /> Próxima
          </button>
        </div>
        <button
          className="diff-all"
          aria-pressed={showAll}
          title={showAll ? "Recolher os trechos sem mudança" : "Mostrar também os trechos sem mudança"}
          onClick={() => setShowAll((all) => !all)}
        >
          {showAll ? <EyeOff size={14} /> : <Eye size={14} />}
          {showAll ? "Só mudanças" : "Arquivo inteiro"}
        </button>
        <div className="diff-view" role="group" aria-label="Modo de exibição">
          <button aria-pressed={!sideBySide} onClick={() => setSideBySide(false)}>
            Unificado
          </button>
          <button aria-pressed={sideBySide} onClick={() => setSideBySide(true)}>
            Lado a lado
          </button>
        </div>
      </div>
      <div ref={host} className="editor-host" />
    </div>
  );
}
// Escolhe a linguagem pela extensão; sem extensão reconhecida, texto puro.
function languageOf(path: string): string {
  return languageFor(path, monaco.languages.getLanguages());
}
export function FileEditor({
  taskId,
  path,
  readOnly,
  onError,
  onDirty,
}: {
  taskId: string;
  path: string;
  readOnly: boolean;
  onError: (e: unknown) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [busy, setBusy] = useState(true);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setDirty(false);
    onDirty(false);
    request<string>({ action: "readTree", taskId, path })
      .then((content) => {
        if (!alive) return;
        editor.current = monaco.editor.create(host.current!, {
          value: content,
          language: languageOf(path),
          theme: "vs-dark",
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13,
          readOnly,
        });
        editor.current.onDidChangeModelContent(() => {
          setDirty(true);
          onDirty(true);
        });
      })
      .catch(onError)
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
      const model = editor.current?.getModel();
      editor.current?.dispose();
      model?.dispose();
      editor.current = null;
    };
  }, [taskId, path, readOnly]);
  async function save() {
    const current = editor.current;
    if (!current) return;
    const version = current.getModel()?.getVersionId();
    const content = current.getValue();
    setBusy(true);
    try {
      await request({ action: "saveFile", taskId, path, content });
      if (
        editor.current === current &&
        current.getModel()?.getVersionId() === version &&
        current.getValue() === content
      ) {
        setDirty(false);
        onDirty(false);
      }
    } catch (e) {
      onError(e);
    } finally {
      if (editor.current === current) setBusy(false);
    }
  }
  return (
    <>
      <div className="file-toolbar">
        <span className="file-toolbar-path">
          <FileTypeIcon name={path.split("/").pop() ?? path} size={15} />
          {path}
          {readOnly ? " • somente leitura" : dirty ? " • alterações não salvas" : ""}
        </span>
        {!readOnly && (
          <button disabled={busy || !dirty} onClick={save}>
            Salvar arquivo
          </button>
        )}
      </div>
      <div ref={host} className="editor-host" />
    </>
  );
}

// Atualiza a árvore a cada poucos segundos, só com a aba aberta. Consulta apenas as
// pastas expandidas, então o custo cresce com o que você está vendo, não com o projeto.
const TREE_REFRESH_MS = 3_000;
const CHANGE_LABEL = {
  modified: "modificado",
  added: "novo",
  untracked: "novo (ainda não versionado)",
  deleted: "apagado",
} as const;
export function FileTree({
  taskId,
  selected,
  onOpen,
  onError,
}: {
  taskId: string;
  selected: string;
  onOpen: (path: string, writable: boolean) => void;
  onError: (e: unknown) => void;
}) {
  const [root, setRoot] = useState<TreeListing["root"] | null>(null);
  const [children, setChildren] = useState<Record<string, TreeEntry[]>>({});
  const [cut, setCut] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState<Changes>({});
  const [busy, setBusy] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const loadDirectory = useCallback(
    async (path: string) => {
      const listing = await request<TreeListing>({ action: "tree", taskId, path });
      setRoot(listing.root);
      setChildren((current) => ({ ...current, [path]: listing.entries }));
      setCut((current) => ({ ...current, [path]: listing.truncated }));
    },
    [taskId],
  );
  // Pasta aberta que sumiu (apagada pela CLI ou pelo git) é recolhida, sem erro.
  const refresh = useCallback(async () => {
    const gone: string[] = [];
    await Promise.all(
      ["", ...expandedRef.current].map(async (path) => {
        try {
          await loadDirectory(path);
        } catch (e) {
          if (!path) throw e;
          gone.push(path);
        }
      }),
    );
    if (gone.length)
      setExpanded((current) => {
        const next = new Set(current);
        for (const path of gone) next.delete(path);
        return next;
      });
    setChanges(await request<Changes>({ action: "changes", taskId }));
  }, [loadDirectory, taskId]);
  const reload = useCallback(async () => {
    setBusy(true);
    setChildren({});
    setCut({});
    setExpanded(new Set());
    try {
      await refresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }, [refresh, onError]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const polling = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      // Falha de atualização automática não gera alerta a cada 3 s; o botão mostra erros.
      refresh()
        .catch(() => undefined)
        .finally(() => {
          polling.current = false;
        });
    }, TREE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  // Pastas que contêm alguma alteração, para marcá-las mesmo recolhidas.
  const dirsWithChanges = useMemo(() => {
    const dirs = new Set<string>();
    for (const path of Object.keys(changes)) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    }
    return dirs;
  }, [changes]);
  async function toggle(path: string) {
    if (expanded.has(path)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      return;
    }
    try {
      if (!children[path]) await loadDirectory(path);
      setExpanded((current) => new Set(current).add(path));
    } catch (e) {
      onError(e);
    }
  }
  function rows(parent: string, depth: number): React.ReactNode {
    return (children[parent] ?? []).map((entry) => {
      const isDirectory = entry.kind === "directory";
      const isOpen = expanded.has(entry.path);
      const change = isDirectory ? undefined : changes[entry.path];
      const marked = isDirectory ? dirsWithChanges.has(entry.path) : Boolean(change);
      const title = change ? `${entry.path} · ${CHANGE_LABEL[change]}` : entry.path;
      return (
        <React.Fragment key={entry.path}>
          <button
            className={
              "tree-row" +
              (selected === entry.path ? " active" : "") +
              (change ? ` changed-${change}` : "") +
              (isDirectory && marked ? " tree-dirty" : "")
            }
            style={{ paddingLeft: 8 + depth * 14 }}
            title={title}
            onClick={() =>
              isDirectory ? void toggle(entry.path) : onOpen(entry.path, root === "task")
            }
          >
            {isDirectory ? (
              isOpen ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )
            ) : (
              <span className="tree-spacer" />
            )}
            <FileTypeIcon name={entry.name} kind={isDirectory ? "directory" : "file"} open={isOpen} />
            <span className="tree-name">{entry.name}</span>
          </button>
          {isDirectory && isOpen && rows(entry.path, depth + 1)}
          {isDirectory && isOpen && cut[entry.path] && (
            <p className="tree-note" style={{ paddingLeft: 22 + depth * 14 }}>
              Lista cortada em 2000 itens.
            </p>
          )}
        </React.Fragment>
      );
    });
  }
  return (
    <aside className="file-tree" aria-label="Arquivos da tarefa">
      <div className="file-tree-head">
        <span>
          {root === "task"
            ? "Pasta da tarefa · editável"
            : root === "project"
              ? "Projeto · somente leitura"
              : "Arquivos"}
        </span>
        <button
          aria-label="Atualizar árvore"
          title="Atualizar árvore"
          disabled={busy}
          onClick={() => void reload()}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="file-tree-body">{rows("", 0)}</div>
    </aside>
  );
}
