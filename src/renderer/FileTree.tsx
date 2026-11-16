import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FilePlus, FolderPlus, RefreshCw } from "lucide-react";
import { FileTypeIcon } from "./fileIcons";
import { TerminalMenu, type MenuItem } from "./TerminalMenu";
import { useConfirm } from "./ui";
import type { Changes, Request, TreeEntry, TreeListing } from "../shared/contracts";
import { baseName, canMove, followMove, isInside, joinPath, parentDir, stemLength, targetDir } from "./fileTreeOps";
import { pluginRequest, usePlugins } from "./plugins";
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;

// Atualiza a árvore a cada poucos segundos, só com a aba aberta. Consulta apenas as
// pastas expandidas, então o custo cresce com o que você está vendo, não com o projeto.
const TREE_REFRESH_MS = 3_000;
const CHANGE_LABEL = {
  modified: "modificado",
  added: "novo",
  untracked: "novo (ainda não versionado)",
  deleted: "apagado",
} as const;
// Arrastar dentro da árvore leva o caminho neste tipo; de fora, chegam arquivos ("Files").
const DRAG_TYPE = "application/x-golfinho-path";
const ROOT: TreeEntry = { name: "", path: "", kind: "directory" };
// `template`: arquivo novo de um plugin (newFiles do ORCA), com extensão e conteúdo inicial.
type Template = { key: string; id: string; extension: string };
type Editing = { kind: "file" | "directory"; dir: string; template?: Template } | { kind: "rename"; entry: TreeEntry };
// Nome digitado na própria árvore: Enter confirma, Esc cancela, sair do campo confirma.
function NameInput({
  initial,
  select,
  indent,
  icon,
  onDone,
}: {
  initial: string;
  select: number;
  indent: number;
  icon: React.ReactNode;
  onDone: (name: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  useEffect(() => {
    input.current?.focus();
    input.current?.setSelectionRange(0, select);
  }, [select]);
  return (
    <div className="tree-row tree-editing" style={{ paddingLeft: indent }}>
      {icon}
      <input
        ref={input}
        aria-label="Nome"
        defaultValue={initial}
        spellCheck={false}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(e.currentTarget.value.trim() || null);
          if (e.key === "Escape") finish(null);
        }}
        onBlur={(e) => finish(e.currentTarget.value.trim() || null)}
      />
    </div>
  );
}
export function FileTree({
  taskId,
  selected,
  onOpen,
  onMoved,
  onError,
}: {
  taskId: string;
  selected: string;
  onOpen: (path: string, writable: boolean) => void;
  /** Um item mudou de lugar (to) ou foi excluído (null): o arquivo aberto acompanha. */
  onMoved?: (from: string, to: string | null) => void;
  onError: (e: unknown) => void;
}) {
  const confirm = useConfirm();
  const [root, setRoot] = useState<TreeListing["root"] | null>(null);
  const [children, setChildren] = useState<Record<string, TreeEntry[]>>({});
  const [cut, setCut] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState<Changes>({});
  const [busy, setBusy] = useState(false);
  // Item escolhido para o teclado e o menu (pode ser uma pasta); o arquivo aberto é `selected`.
  const [focus, setFocus] = useState<TreeEntry | null>(null);
  const [clip, setClip] = useState<{ entry: TreeEntry; cut: boolean } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const plugins = usePlugins();
  const [menu, setMenu] = useState<{ x: number; y: number; entry: TreeEntry | null } | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const writable = root === "task";
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
  async function open(path: string) {
    if (!path) return;
    if (!children[path]) await loadDirectory(path);
    setExpanded((current) => new Set(current).add(path));
  }
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
      await open(path);
    } catch (e) {
      onError(e);
    }
  }
  // Toda alteração passa por aqui: erro vira alerta, e a árvore mostra o resultado em seguida.
  async function change(operation: () => Promise<void>) {
    try {
      await operation();
    } catch (e) {
      onError(e);
    }
    await refresh().catch(() => undefined);
  }
  // Depois de criar, colar ou mover: abre a pasta de destino e deixa o item novo escolhido.
  async function reveal(path: string, kind: TreeEntry["kind"]) {
    await open(parentDir(path)).catch(() => undefined);
    setFocus({ name: baseName(path), path, kind });
  }
  function startCreate(kind: "file" | "directory", entry: TreeEntry | null, template?: Template) {
    const dir = targetDir(entry);
    void open(dir)
      .catch(() => undefined)
      .then(() => setEditing({ kind, dir, template }));
  }
  async function finishEdit(name: string | null) {
    const current = editing;
    setEditing(null);
    if (!current || !name) return;
    if (current.kind === "rename") {
      const from = current.entry.path;
      const to = joinPath(parentDir(from), name);
      if (to === from) return;
      await move(current.entry, to);
      return;
    }
    const template = current.template;
    const path = joinPath(current.dir, template && !name.toLowerCase().endsWith(template.extension) ? name + template.extension : name);
    await change(async () => {
      await request({ action: "fileCreate", taskId, path, kind: current.kind });
      if (template) {
        const content = await pluginRequest<string>({ action: "template", key: template.key, id: template.id });
        if (content) await request({ action: "saveFile", taskId, path, content });
      }
      await reveal(path, current.kind);
      if (current.kind === "file") onOpen(path, true);
    });
  }
  async function move(entry: TreeEntry, to: string) {
    await change(async () => {
      const moved = await request<string>({ action: "fileMove", taskId, from: entry.path, to });
      setExpanded((current) => new Set([...current].map((path) => followMove(path, entry.path, moved)!)));
      if (clip && followMove(clip.entry.path, entry.path, moved) !== clip.entry.path) setClip(null);
      onMoved?.(entry.path, moved);
      await reveal(moved, entry.kind);
    });
  }
  async function copyInto(entry: TreeEntry, dir: string) {
    await change(async () => {
      const copied = await request<string>({ action: "fileCopy", taskId, from: entry.path, dir });
      await reveal(copied, entry.kind);
    });
  }
  async function importInto(sources: string[], dir: string) {
    await change(async () => {
      const copied = await request<string[]>({ action: "fileImport", taskId, sources, dir });
      if (copied.length) await reveal(copied[copied.length - 1], "file");
    });
  }
  // A cópia interna também vai como texto para a área de transferência do sistema. Assim, colar
  // depois de copiar algo no gerenciador de arquivos usa o que foi copiado lá, que é o mais novo.
  async function copy(entry: TreeEntry, isCut: boolean) {
    setClip({ entry, cut: isCut });
    try {
      const text = await request<string>({ action: "filePath", taskId, path: entry.path });
      await request({ action: "writeClipboard", text });
    } catch {}
  }
  async function paste(entry: TreeEntry | null) {
    if (!writable) return;
    const dir = targetDir(entry);
    try {
      const external = await request<string[]>({ action: "clipboardFiles" });
      if (external.length) return importInto(external, dir);
    } catch (e) {
      return onError(e);
    }
    if (!clip) return;
    if (!clip.cut) return copyInto(clip.entry, dir);
    if (!canMove(clip.entry.path, dir)) return;
    setClip(null);
    await move(clip.entry, joinPath(dir, clip.entry.name));
  }
  async function remove(entry: TreeEntry) {
    const isDirectory = entry.kind === "directory";
    const ok = await confirm({
      title: `Excluir ${entry.name}?`,
      message: isDirectory
        ? "A pasta e tudo o que está dentro dela vão para a lixeira."
        : "O arquivo vai para a lixeira.",
      confirmLabel: "Excluir",
      tone: "danger",
    });
    if (!ok) return;
    await change(async () => {
      let deleted = await request<boolean>({ action: "fileDelete", taskId, path: entry.path });
      if (!deleted) {
        const permanent = await confirm({
          title: "Não foi possível usar a lixeira",
          message: `Excluir ${entry.path} definitivamente? Isso não pode ser desfeito.`,
          confirmLabel: "Excluir definitivamente",
          tone: "danger",
        });
        if (!permanent) return;
        deleted = await request<boolean>({ action: "fileDelete", taskId, path: entry.path, permanent: true });
      }
      if (!deleted) return;
      if (clip && isInside(clip.entry.path, entry.path)) setClip(null);
      if (focus && isInside(focus.path, entry.path)) setFocus(null);
      onMoved?.(entry.path, null);
    });
  }
  async function copyPath(entry: TreeEntry | null, relativePath: boolean) {
    try {
      const text = relativePath
        ? entry?.path || "."
        : await request<string>({ action: "filePath", taskId, path: entry?.path ?? "" });
      await request({ action: "writeClipboard", text });
    } catch (e) {
      onError(e);
    }
  }
  function menuItems(entry: TreeEntry | null): MenuItem[] {
    const item = entry && entry.path ? entry : null;
    return [
      { label: "Novo arquivo", disabled: !writable, onSelect: () => startCreate("file", entry) },
      { label: "Nova pasta", disabled: !writable, onSelect: () => startCreate("directory", entry) },
      // Tipos de arquivo que os plugins ensinam a criar ("Novo arquivo HTTP").
      ...plugins.flatMap((pl) =>
        pl.newFiles.map((f) => ({
          label: `Novo: ${f.title}`,
          disabled: !writable,
          onSelect: () => startCreate("file", entry, { key: pl.key, id: f.id, extension: f.extension }),
        })),
      ),
      {
        label: "Recortar",
        shortcut: "Ctrl+X",
        separator: true,
        disabled: !writable || !item,
        onSelect: () => item && void copy(item, true),
      },
      { label: "Copiar", shortcut: "Ctrl+C", disabled: !item, onSelect: () => item && void copy(item, false) },
      { label: "Colar", shortcut: "Ctrl+V", disabled: !writable, onSelect: () => void paste(entry) },
      {
        label: "Duplicar",
        disabled: !writable || !item,
        onSelect: () => item && void copyInto(item, parentDir(item.path)),
      },
      {
        label: "Renomear",
        shortcut: "F2",
        separator: true,
        disabled: !writable || !item,
        onSelect: () => item && setEditing({ kind: "rename", entry: item }),
      },
      { label: "Excluir", shortcut: "Delete", disabled: !writable || !item, onSelect: () => item && void remove(item) },
      { label: "Copiar caminho", separator: true, onSelect: () => void copyPath(entry, false) },
      { label: "Copiar caminho relativo", onSelect: () => void copyPath(entry, true) },
      {
        label: "Revelar no gerenciador de arquivos",
        onSelect: () =>
          void request({ action: "fileReveal", taskId, path: entry?.path ?? "" }).catch(onError),
      },
    ];
  }
  function openMenu(e: React.MouseEvent, entry: TreeEntry | null) {
    e.preventDefault();
    e.stopPropagation();
    setFocus(entry);
    // O menu não pode sair pela parte de baixo da janela.
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 380), entry });
  }
  function keyDown(e: React.KeyboardEvent) {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const item = focus && focus.path ? focus : null;
    if (mod && key === "c" && item) void copy(item, false);
    else if (mod && key === "x" && item && writable) void copy(item, true);
    else if (mod && key === "v" && writable) void paste(focus);
    else if (e.key === "F2" && item && writable) setEditing({ kind: "rename", entry: item });
    else if ((e.key === "Delete" || (e.metaKey && e.key === "Backspace")) && item && writable) void remove(item);
    else if (e.key === "Escape" && clip?.cut) setClip(null);
    else return;
    e.preventDefault();
  }
  // Soltar: caminho da árvore é movido (com Ctrl, copiado); arquivos de fora são copiados.
  function dragOver(e: React.DragEvent, entry: TreeEntry | null) {
    if (!writable) return;
    const types = [...e.dataTransfer.types];
    if (!types.includes(DRAG_TYPE) && !types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = types.includes(DRAG_TYPE) && !e.ctrlKey && !e.altKey ? "move" : "copy";
    setDropDir(targetDir(entry));
  }
  function drop(e: React.DragEvent, entry: TreeEntry | null) {
    if (!writable) return;
    e.preventDefault();
    e.stopPropagation();
    setDropDir(null);
    const dir = targetDir(entry);
    const from = e.dataTransfer.getData(DRAG_TYPE);
    if (from) {
      const dragged = findEntry(from);
      if (!dragged) return;
      if (e.ctrlKey || e.altKey) void copyInto(dragged, dir);
      else if (canMove(from, dir)) void move(dragged, joinPath(dir, dragged.name));
      return;
    }
    const sources = [...e.dataTransfer.files].map((file) => window.golfinho.getPathForFile(file)).filter(Boolean);
    if (sources.length) void importInto(sources, dir);
    else onError(new Error("Não foi possível ler os arquivos arrastados. Arraste do gerenciador de arquivos."));
  }
  function findEntry(path: string) {
    return (children[parentDir(path)] ?? []).find((entry) => entry.path === path) ?? null;
  }
  function creating(dir: string, depth: number) {
    if (!editing || editing.kind === "rename" || editing.dir !== dir) return null;
    const initial = editing.template ? `novo${editing.template.extension}` : "";
    return (
      <NameInput
        initial={initial}
        select={editing.template ? 4 : 0}
        indent={8 + depth * 14 + 16}
        icon={<FileTypeIcon name="" kind={editing.kind} />}
        onDone={(name) => void finishEdit(name)}
      />
    );
  }
  function rows(parent: string, depth: number): React.ReactNode {
    return (children[parent] ?? []).map((entry) => {
      const isDirectory = entry.kind === "directory";
      const isOpen = expanded.has(entry.path);
      const change = isDirectory ? undefined : changes[entry.path];
      const marked = isDirectory ? dirsWithChanges.has(entry.path) : Boolean(change);
      const title = change ? `${entry.path} · ${CHANGE_LABEL[change]}` : entry.path;
      const chevron = isDirectory ? (
        isOpen ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )
      ) : (
        <span className="tree-spacer" />
      );
      const icon = <FileTypeIcon name={entry.name} kind={isDirectory ? "directory" : "file"} open={isOpen} />;
      const renaming = editing?.kind === "rename" && editing.entry.path === entry.path;
      return (
        <React.Fragment key={entry.path}>
          {renaming ? (
            <NameInput
              initial={entry.name}
              select={stemLength(entry.name, isDirectory)}
              indent={8 + depth * 14}
              icon={
                <>
                  {chevron}
                  {icon}
                </>
              }
              onDone={(name) => void finishEdit(name)}
            />
          ) : (
            <button
              className={
                "tree-row" +
                (selected === entry.path ? " active" : "") +
                (focus?.path === entry.path ? " focused" : "") +
                (clip?.cut && clip.entry.path === entry.path ? " tree-cut" : "") +
                (isDirectory && dropDir === entry.path ? " tree-drop" : "") +
                (change ? ` changed-${change}` : "") +
                (isDirectory && marked ? " tree-dirty" : "")
              }
              style={{ paddingLeft: 8 + depth * 14 }}
              title={title}
              draggable={writable}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, entry.path);
                e.dataTransfer.effectAllowed = "copyMove";
              }}
              onDragEnd={() => setDropDir(null)}
              onDragOver={(e) => dragOver(e, entry)}
              onDrop={(e) => drop(e, entry)}
              onFocus={() => setFocus(entry)}
              onContextMenu={(e) => openMenu(e, entry)}
              onClick={() => {
                setFocus(entry);
                if (isDirectory) void toggle(entry.path);
                else onOpen(entry.path, writable);
              }}
            >
              {chevron}
              {icon}
              <span className="tree-name">{entry.name}</span>
            </button>
          )}
          {isDirectory && isOpen && creating(entry.path, depth + 1)}
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
        <span className="file-tree-actions">
          {writable && (
            <>
              <button aria-label="Novo arquivo" title="Novo arquivo" onClick={() => startCreate("file", focus)}>
                <FilePlus size={12} />
              </button>
              <button aria-label="Nova pasta" title="Nova pasta" onClick={() => startCreate("directory", focus)}>
                <FolderPlus size={12} />
              </button>
            </>
          )}
          <button aria-label="Atualizar árvore" title="Atualizar árvore" disabled={busy} onClick={() => void reload()}>
            <RefreshCw size={12} />
          </button>
        </span>
      </div>
      <div
        className={"file-tree-body" + (dropDir === "" ? " tree-drop" : "")}
        role="tree"
        aria-label="Pasta da tarefa"
        tabIndex={-1}
        onKeyDown={keyDown}
        onContextMenu={(e) => openMenu(e, ROOT)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setFocus(null);
        }}
        onDragOver={(e) => dragOver(e, null)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropDir(null);
        }}
        onDrop={(e) => drop(e, null)}
      >
        {creating("", 0)}
        {rows("", 0)}
      </div>
      {menu && <TerminalMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />}
    </aside>
  );
}
