import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
import { FileTypeIcon } from "./fileIcons";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type { FileChange, Request } from "../shared/contracts";
import { languageFor } from "./language";
import { countLines } from "./diffStats";
import { PluginEditor } from "./PluginEditor";
import { pluginEditorFor, usePlugins } from "./plugins";
import { registerPluginSyntaxes } from "./pluginSyntax";
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
export { TerminalPane } from "./TerminalPane";
export { FileTree } from "./FileTree";
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
  // Texto do arquivo, de onde o editor de código e o do plugin partem quando um troca pelo outro.
  const [text, setText] = useState<string | null>(null);
  const textRef = useRef<string | null>(null);
  // Arquivo que um plugin sabe abrir (ex.: .http): abre no editor dele; "Código" volta ao Monaco.
  const plugins = usePlugins();
  const custom = pluginEditorFor(path, plugins);
  const [code, setCode] = useState(false);
  const usePlugin = Boolean(custom) && !code;
  const markDirty = (value: boolean) => {
    setDirty(value);
    onDirty(value);
  };
  useEffect(() => {
    let alive = true;
    setBusy(true);
    markDirty(false);
    setText(null);
    textRef.current = null;
    setCode(false);
    request<string>({ action: "readTree", taskId, path })
      .then((content) => {
        if (!alive) return;
        textRef.current = content;
        setText(content);
      })
      .catch(onError)
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [taskId, path]);
  useEffect(() => {
    if (text === null || usePlugin || !host.current) return;
    editor.current = monaco.editor.create(host.current, {
      value: textRef.current ?? "",
      language: languageOf(path),
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      readOnly,
    });
    const current = editor.current;
    current.onDidChangeModelContent(() => {
      textRef.current = current.getValue();
      markDirty(true);
    });
    return () => {
      // Volta para o editor do plugin com o que foi digitado aqui.
      if (textRef.current !== null) setText(textRef.current);
      const model = current.getModel();
      current.dispose();
      model?.dispose();
      if (editor.current === current) editor.current = null;
    };
  }, [text === null, usePlugin, path, readOnly]);
  // Linguagem trazida por um plugin (ex.: .http): o arquivo ganha as cores assim que ela é registrada.
  useEffect(() => {
    if (!plugins.some((p) => p.syntaxes.length)) return;
    void registerPluginSyntaxes(plugins).then(() => {
      const model = editor.current?.getModel();
      if (model) monaco.editor.setModelLanguage(model, languageOf(path));
    });
  }, [plugins, path, text === null, usePlugin]);
  async function save() {
    const current = editor.current;
    const content = current ? current.getValue() : textRef.current;
    if (content === null) return;
    const version = current?.getModel()?.getVersionId();
    setBusy(true);
    try {
      await request({ action: "saveFile", taskId, path, content });
      const unchanged = current
        ? editor.current === current && current.getModel()?.getVersionId() === version && current.getValue() === content
        : textRef.current === content;
      if (unchanged) markDirty(false);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
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
        {custom && (
          <button
            type="button"
            title={usePlugin ? "Ver e editar o arquivo como texto" : `Abrir no editor do plugin ${custom.plugin.name}`}
            onClick={() => setCode((c) => !c)}
          >
            {usePlugin ? "Código" : custom.editor.title}
          </button>
        )}
        {!readOnly && (
          <button disabled={busy || !dirty} onClick={save}>
            Salvar arquivo
          </button>
        )}
      </div>
      {usePlugin && custom && text !== null ? (
        <PluginEditor
          key={`${custom.plugin.key}:${path}`}
          pluginKey={custom.plugin.key}
          editorId={custom.editor.id}
          title={custom.editor.title}
          path={path}
          value={text}
          readOnly={readOnly}
          dark
          onChange={(value) => {
            textRef.current = value;
            setText(value);
            markDirty(true);
          }}
          onSave={save}
        />
      ) : (
        <div ref={host} className="editor-host" />
      )}
    </>
  );
}
