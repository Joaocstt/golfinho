import { useEffect, useState } from "react";
import { Pencil, X, Save } from "lucide-react";
import type { Request, SshWriteResult } from "../shared/contracts";
import { useConfirm } from "./ui";
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
// Visualizador e editor de um arquivo do servidor. Começa somente leitura; editar é uma
// escolha explícita, e salvar sempre passa por confirmação.
export function RemoteViewer({
  connectionId,
  serverName,
  path,
  onClose,
  onError,
}: {
  connectionId: string;
  serverName: string;
  path: string;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const confirm = useConfirm();
  const [content, setContent] = useState<string | null>(null);
  const [mtime, setMtime] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    setContent(null);
    setEditing(false);
    setConfirming(false);
    setError("");
    setNotice("");
    Promise.all([
      request<string>({ action: "sshRead", connectionId, path }),
      request<number>({ action: "sshStat", connectionId, path }),
    ])
      .then(([text, time]) => {
        if (!alive) return;
        setContent(text);
        setMtime(time);
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [connectionId, path]);
  const dirty = editing && content !== null && draft !== content;
  function startEditing() {
    setDraft(content ?? "");
    setEditing(true);
    setNotice("");
  }
  async function stopEditing() {
    if (
      dirty &&
      !(await confirm({
        title: "Descartar as alterações?",
        message: "As alterações neste arquivo ainda não foram salvas no servidor.",
        confirmLabel: "Descartar",
        tone: "danger",
      }))
    )
      return;
    setEditing(false);
  }
  async function save() {
    setConfirming(false);
    setSaving(true);
    setError("");
    try {
      const result = await request<SshWriteResult>({
        action: "sshWrite",
        connectionId,
        path,
        content: draft,
        expectedMtime: mtime ?? 0,
      });
      setContent(draft);
      setMtime(result.mtime);
      setEditing(false);
      setNotice(`Salvo. O original foi copiado para ${result.backup}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="ssh-viewer">
      <div className="ssh-browser-head">
        <span title={path}>
          {serverName} · {path} · {editing ? "editando" : "somente leitura"}
        </span>
        <div>
          {!editing && content !== null && (
            <button onClick={startEditing} title="Liberar edição deste arquivo">
              <Pencil size={12} /> Editar
            </button>
          )}
          {editing && (
            <>
              <button disabled={!dirty || saving} onClick={() => setConfirming(true)} className="primary" title="Salvar no servidor (pede confirmação)">
                <Save size={12} /> Salvar…
              </button>
              <button disabled={saving} onClick={stopEditing}>
                Ler somente
              </button>
            </>
          )}
          <button aria-label="Fechar arquivo" onClick={onClose}>
            <X size={12} />
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice notice-ok">{notice}</p>}
      {content === null && !error && <p className="notice">Abrindo o arquivo…</p>}
      {content !== null && !editing && <pre>{content}</pre>}
      {content !== null && editing && (
        <textarea
          className="ssh-editor"
          value={draft}
          spellCheck={false}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      {confirming && (
        <div className="modal-backdrop">
          <div className="modal confirm" role="dialog" aria-modal="true" aria-label="Salvar no servidor">
            <div className="modal-title">
              <h2>Salvar no servidor de produção?</h2>
            </div>
            <p>
              Você está alterando <strong>{path}</strong> em <strong>{serverName}</strong>.
            </p>
            <ul className="confirm-list">
              <li>O arquivo atual é copiado para um backup, na mesma pasta, antes da gravação.</li>
              <li>Se o arquivo mudou no servidor desde que você abriu, o salvamento é recusado.</li>
              <li>Dono e permissões do arquivo são mantidos.</li>
            </ul>
            <div className="modal-actions">
              <button onClick={() => setConfirming(false)}>Cancelar</button>
              <button className="primary" onClick={() => void save()}>
                Confirmar e salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
