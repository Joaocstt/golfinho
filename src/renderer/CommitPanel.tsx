import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { Changes, FileChange, Request } from "../shared/contracts";
import { DiffPane } from "./Editors";
const KIND: Record<string, { label: string; tone: string }> = {
  added: { label: "novo", tone: "added" },
  untracked: { label: "novo", tone: "added" },
  modified: { label: "alterado", tone: "modified" },
  deleted: { label: "removido", tone: "deleted" },
};
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
// Aba Commit: escolha o que entra no commit, veja o diff de cada arquivo e escreva a mensagem.
export function CommitPanel({
  taskId,
  branch,
  request,
  onError,
}: {
  taskId: string;
  branch: string;
  request: <T>(r: Request) => Promise<T>;
  onError: (e: unknown) => void;
}) {
  const [changes, setChanges] = useState<Changes>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileChange | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const paths = useMemo(() => Object.keys(changes).sort(), [changes]);
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const path of paths) map.set(dirOf(path), [...(map.get(dirOf(path)) ?? []), path]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [paths]);
  async function reload(keepPreview = false) {
    try {
      const next = await request<Changes>({ action: "changes", taskId });
      setChanges(next);
      setPicked(new Set(Object.keys(next)));
      if (!keepPreview || !(previewing && previewing in next))
        setPreviewing(Object.keys(next).sort()[0] ?? null);
    } catch (e) {
      onError(e);
    }
  }
  useEffect(() => {
    setDone("");
    setPreviewing(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  useEffect(() => {
    if (!previewing) {
      setDiff(null);
      return;
    }
    let alive = true;
    request<FileChange>({ action: "changeDiff", taskId, path: previewing })
      .then((d) => alive && setDiff(d))
      .catch((e) => alive && onError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing, taskId, changes]);
  function setMany(list: string[], on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const p of list) if (on) next.add(p);
      else next.delete(p);
      return next;
    });
  }
  function toggleFolder(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  async function commit(push: boolean) {
    setBusy(true);
    setDone("");
    try {
      const sha = await request<string>({
        action: "commitFiles",
        taskId,
        paths: paths.filter((p) => picked.has(p)),
        message,
        push,
      });
      setMessage("");
      setDone(push ? `Commit ${sha} criado e branch enviada.` : `Commit ${sha} criado.`);
      await reload(true);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const selected = picked.size;
  const canCommit = !busy && selected > 0 && message.trim().length > 0;
  return (
    <div className="commit">
      <aside className="commit-side">
        <header className="commit-head">
          <div>
            <strong>Alterações</strong>
            <span className="commit-branch">{branch}</span>
          </div>
          <span className="commit-count">
            {selected} de {paths.length}
          </span>
        </header>
        <div className="commit-quick">
          <button disabled={busy || paths.length === 0} onClick={() => setPicked(new Set(paths))}>
            Todos
          </button>
          <button disabled={busy || selected === 0} onClick={() => setPicked(new Set())}>
            Nenhum
          </button>
        </div>
        <div className="commit-tree">
          {paths.length === 0 && <p className="commit-empty">Nenhuma alteração nesta pasta.</p>}
          {groups.map(([dir, files]) => {
            const on = files.filter((f) => picked.has(f)).length;
            const isOpen = !collapsed.has(dir);
            return (
              <div className="commit-folder" key={dir}>
                <div className="commit-folder-row">
                  <button
                    className="commit-chevron"
                    aria-label={isOpen ? "Recolher pasta" : "Expandir pasta"}
                    onClick={() => toggleFolder(dir)}
                  >
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <input
                    type="checkbox"
                    aria-label={`Selecionar pasta ${dir}`}
                    checked={on === files.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < files.length;
                    }}
                    onChange={(e) => setMany(files, e.target.checked)}
                  />
                  <Folder size={13} className="commit-folder-icon" />
                  <span className="commit-folder-name">{dir === "." ? "raiz" : dir}</span>
                  <span className="commit-folder-count">{files.length}</span>
                </div>
                {isOpen &&
                  files.map((path) => (
                    <div
                      key={path}
                      className={"commit-file " + (previewing === path ? "active" : "")}
                      onClick={() => setPreviewing(path)}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Incluir ${path}`}
                        checked={picked.has(path)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setMany([path], e.target.checked)}
                      />
                      <span className={"commit-dot " + KIND[changes[path]]?.tone}></span>
                      <span className="commit-name">{nameOf(path)}</span>
                      <em className={"commit-kind " + KIND[changes[path]]?.tone}>
                        {KIND[changes[path]]?.label ?? changes[path]}
                      </em>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
        <div className="commit-compose">
          <textarea
            aria-label="Mensagem do commit"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Descreva a mudança (o que e por quê)"
            rows={3}
          />
          <div className="commit-actions">
            <button className="primary" disabled={!canCommit} onClick={() => void commit(false)}>
              Commit{selected > 0 ? ` (${selected})` : ""}
            </button>
            <button disabled={!canCommit} onClick={() => void commit(true)}>
              Commit e enviar
            </button>
          </div>
          {done && <p className="commit-done">{done}</p>}
        </div>
      </aside>
      <section className="commit-preview">
        {diff && previewing ? (
          <>
            <header className="commit-preview-head">
              <span className={"commit-dot " + KIND[diff.status]?.tone}></span>
              <code>{previewing}</code>
              <em className={"commit-kind " + KIND[diff.status]?.tone}>
                {KIND[diff.status]?.label ?? diff.status}
              </em>
            </header>
            <div className="commit-diff">
              <DiffPane key={previewing + diff.status} file={diff} />
            </div>
          </>
        ) : (
          <div className="commit-blank">
            {paths.length === 0 ? "Sem alterações para mostrar." : "Escolha um arquivo para ver o diff."}
          </div>
        )}
      </section>
    </div>
  );
}
