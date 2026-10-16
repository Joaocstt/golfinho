import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { FileChange } from "../shared/contracts";
const COLOR: Record<string, string> = { added: "#98c379", modified: "#e5c07b", deleted: "#e06c75" };
const LETTER: Record<string, string> = { added: "N", modified: "M", deleted: "A" };
const WORD: Record<string, string> = { added: "novo", modified: "modificado", deleted: "apagado" };
const PLURAL: Record<string, string> = { added: "novos", modified: "modificados", deleted: "apagados" };
const FILTER_FROM = 6;
const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
// Arquivos agrupados pela pasta, em ordem alfabética; a raiz do projeto vem primeiro.
export function groupByFolder(files: FileChange[]): { dir: string; files: FileChange[] }[] {
  const groups = new Map<string, FileChange[]>();
  for (const file of files) {
    const dir = dirOf(file.path);
    groups.set(dir, [...(groups.get(dir) ?? []), file]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, list]) => ({ dir, files: [...list].sort((a, b) => nameOf(a.path).localeCompare(nameOf(b.path))) }));
}
// Lista dos arquivos alterados ao lado do diff. Com muitos arquivos, os chips em linha ocupavam
// metade da tela; aqui a lista rola sozinha e o diff fica sempre visível.
export function ReviewFiles({
  files,
  selected,
  onSelect,
}: {
  files: FileChange[];
  selected: string;
  onSelect: (path: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    return needle ? files.filter((f) => f.path.toLocaleLowerCase().includes(needle)) : files;
  }, [files, filter]);
  const groups = useMemo(() => groupByFolder(shown), [shown]);
  const order = groups.flatMap((g) => g.files.map((f) => f.path));
  const counts = (["added", "modified", "deleted"] as const)
    .map((status) => ({ status, n: files.filter((f) => f.status === status).length }))
    .filter((c) => c.n > 0);
  function move(step: number) {
    if (!order.length) return;
    const index = order.indexOf(selected);
    const next = order[Math.max(0, Math.min(order.length - 1, (index < 0 ? -1 : index) + step))];
    if (next) onSelect(next);
  }
  return (
    <aside className="review-files" aria-label="Arquivos alterados">
      <div className="review-files-head">
        <strong>
          {files.length} {files.length === 1 ? "arquivo" : "arquivos"}
        </strong>
        <span className="review-counts">
          {counts.map(({ status, n }) => (
            <span key={status} style={{ color: COLOR[status] }} title={`${n} ${n === 1 ? WORD[status] : PLURAL[status]}`}>
              {LETTER[status]} {n}
            </span>
          ))}
        </span>
      </div>
      {files.length > FILTER_FROM && (
        <label className="review-filter">
          <Search size={12} aria-hidden />
          <input
            type="search"
            value={filter}
            placeholder="Filtrar arquivos"
            aria-label="Filtrar arquivos"
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
      )}
      <div
        className="review-files-list"
        role="listbox"
        aria-label="Escolher arquivo"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            move(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        {groups.map(({ dir, files: list }) => (
          <div key={dir} className="review-group">
            <div className="review-dir" title={dir || "raiz do projeto"}>
              {dir || "raiz do projeto"}
            </div>
            {list.map((f) => (
              <button
                key={f.path}
                role="option"
                aria-selected={selected === f.path}
                className={"review-file " + (selected === f.path ? "active" : "")}
                title={`${WORD[f.status] ?? f.status} · ${f.path}`}
                onClick={() => onSelect(f.path)}
              >
                <span className="review-badge" style={{ color: COLOR[f.status] }}>
                  {LETTER[f.status] ?? "?"}
                </span>
                <span className="review-name">{nameOf(f.path)}</span>
              </button>
            ))}
          </div>
        ))}
        {!shown.length && <p className="review-empty">Nenhum arquivo com esse nome.</p>}
      </div>
    </aside>
  );
}
