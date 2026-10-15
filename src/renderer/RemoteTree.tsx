import React, { useEffect, useState } from "react";
import { Folder, File, ChevronDown, ChevronRight, HardDrive } from "lucide-react";
import type { Request, SshConnection, SshListing, SshRoots } from "../shared/contracts";
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
// Árvore do servidor na barra lateral: início, "/" e cada disco. Cada pasta é lida só
// quando você a abre, e caminhos digitados viram raízes extras (como um cd).
export function RemoteTree({
  connection,
  onOpenFile,
  selected,
}: {
  connection: SshConnection;
  onOpenFile: (path: string) => void;
  selected: string | null;
}) {
  const [roots, setRoots] = useState<SshRoots | null>(null);
  const [children, setChildren] = useState<Record<string, SshListing["entries"]>>({});
  const [cut, setCut] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<string[]>([]);
  const [goTo, setGoTo] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setError("");
    setRoots(null);
    request<SshRoots>({ action: "sshRoots", connectionId: connection.id })
      .then((result) => alive && setRoots(result))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [connection.id]);
  async function load(path: string) {
    setLoading((current) => new Set(current).add(path));
    try {
      const listing = await request<SshListing>({ action: "sshList", connectionId: connection.id, path });
      setChildren((current) => ({ ...current, [listing.path]: listing.entries }));
      setCut((current) => ({ ...current, [listing.path]: listing.truncated }));
      setError("");
      return listing.path;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setLoading((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
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
      if (!children[path]) await load(path);
      setExpanded((current) => new Set(current).add(path));
    } catch {
      /* erro já mostrado */
    }
  }
  async function go(event: React.FormEvent) {
    event.preventDefault();
    const path = goTo.trim();
    if (!path.startsWith("/")) {
      setError("Digite um caminho absoluto, começando com /.");
      return;
    }
    try {
      const resolved = await load(path);
      setCustom((current) => (current.includes(resolved) ? current : [...current, resolved]));
      setExpanded((current) => new Set(current).add(resolved));
      setGoTo("");
    } catch {
      /* erro já mostrado */
    }
  }
  function rows(folder: string, depth: number): React.ReactNode {
    return (children[folder] ?? []).map((entry) => {
      const full = folder === "/" ? `/${entry.name}` : `${folder}/${entry.name}`;
      const isDirectory = entry.kind === "directory";
      const isOpen = expanded.has(full);
      return (
        <React.Fragment key={full}>
          <button
            className={"tree-row" + (selected === full ? " active" : "")}
            style={{ paddingLeft: 8 + depth * 14 }}
            title={full}
            disabled={loading.has(full)}
            onClick={() => (isDirectory ? void toggle(full) : onOpenFile(full))}
          >
            {isDirectory ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="tree-spacer" />}
            {isDirectory ? <Folder size={13} /> : <File size={13} />}
            <span className="tree-name">{entry.name}</span>
          </button>
          {isDirectory && isOpen && rows(full, depth + 1)}
          {isDirectory && isOpen && cut[full] && (
            <p className="tree-note" style={{ paddingLeft: 22 + depth * 14 }}>
              Lista cortada em 2000 itens.
            </p>
          )}
        </React.Fragment>
      );
    });
  }
  const rootPaths = roots
    ? [roots.home, ...roots.mounts, ...custom].filter((p, i, all) => all.indexOf(p) === i)
    : [];
  return (
    <div className="remote-tree">
      <form className="remote-goto" onSubmit={go}>
        <input
          value={goTo}
          onChange={(e) => setGoTo(e.target.value)}
          placeholder="Ir para caminho, ex.: /sigep"
          aria-label="Ir para caminho"
        />
      </form>
      {error && <p className="error">{error}</p>}
      {!roots && !error && <p className="notice">Consultando o servidor…</p>}
      {rootPaths.map((path) => {
        const isOpen = expanded.has(path);
        const label = path === roots?.home ? `Início · ${path}` : path;
        return (
          <React.Fragment key={path}>
            <button
              className="tree-row tree-root"
              title={path}
              disabled={loading.has(path)}
              onClick={() => void toggle(path)}
            >
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {path === "/" || roots?.mounts.includes(path) ? <HardDrive size={13} /> : <Folder size={13} />}
              <span className="tree-name">{label}</span>
            </button>
            {isOpen && rows(path, 1)}
          </React.Fragment>
        );
      })}
    </div>
  );
}
