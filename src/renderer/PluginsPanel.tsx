import React, { useEffect, useState } from "react";
import { FileArchive, FolderOpen, GitBranch, Hammer, Puzzle, RefreshCw, ScrollText, ShieldAlert, Trash2, X } from "lucide-react";
import { Badge, Button, Switch, useConfirm } from "./ui";
import { pluginRequest, pluginsChanged, usePlugins, type PluginInfo, type PluginPreview } from "./plugins";

const SOURCE: Record<string, string> = { folder: "pasta", zip: ".zip", git: "Git" };

// Plugins no formato do ORCA. Instalar tem dois passos: o Golfinho prepara e mostra o que o
// plugin pede; só depois do "Instalar e permitir" ele passa a valer.
export function PluginsPanel({ onClose }: { onClose: () => void }) {
  const plugins = usePlugins();
  const confirm = useConfirm();
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  const [git, setGit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dropping, setDropping] = useState(false);

  async function run<T>(work: () => Promise<T>) {
    setBusy(true);
    setError("");
    try {
      return await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const prepare = (request: Record<string, unknown>) =>
    run(async () => {
      const p = await pluginRequest<PluginPreview | null>(request as { action: string });
      if (p) setPreview(p);
    });

  async function cancelPreview() {
    if (preview) await pluginRequest({ action: "discard", token: preview.token }).catch(() => {});
    setPreview(null);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !preview && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, onClose]);

  return (
    <section className="settings plugins-panel" aria-label="Plugins">
      <header className="settings-head">
        <h2>
          <Puzzle size={16} /> Plugins
        </h2>
        <button type="button" className="settings-close" aria-label="Fechar janela" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="plugins-body">
        <p className="plugins-lead">
          Plugins no formato do ORCA (<code>orca-plugin.json</code>): o mesmo plugin funciona nos dois. Arraste o
          <code>.zip</code> ou a pasta do plugin para cá, ou escolha abaixo.
        </p>
        <div
          className={"plugins-drop" + (dropping ? " over" : "")}
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const file = e.dataTransfer.files[0];
            const path = file && window.golfinho.getPathForFile(file);
            if (!path) return setError("Não deu para ler o que foi solto. Use os botões abaixo.");
            void prepare({ action: "prepare", kind: path.toLowerCase().endsWith(".zip") ? "zip" : "folder", location: path });
          }}
        >
          <div className="plugins-add">
            <Button icon={<FileArchive size={14} />} disabled={busy} onClick={() => void prepare({ action: "pick", kind: "zip" })}>
              Do .zip
            </Button>
            <Button icon={<FolderOpen size={14} />} disabled={busy} onClick={() => void prepare({ action: "pick", kind: "folder" })}>
              De uma pasta
            </Button>
            <Button icon={<GitBranch size={14} />} disabled={busy} onClick={() => setGit(git === null ? "" : null)}>
              Do Git
            </Button>
            <Button
              icon={<Hammer size={14} />}
              disabled={busy}
              title="Usa a pasta como está e recarrega o plugin quando você pedir: para quem está criando o plugin"
              onClick={() => void prepare({ action: "pick", kind: "folder", dev: true })}
            >
              Em desenvolvimento
            </Button>
          </div>
          {git !== null && (
            <form
              className="plugins-git"
              onSubmit={(e) => {
                e.preventDefault();
                if (git.trim()) void prepare({ action: "prepare", kind: "git", location: git.trim() }).then(() => setGit(null));
              }}
            >
              <input
                autoFocus
                aria-label="Link do repositório Git"
                placeholder="https://github.com/dono/plugin"
                value={git}
                onChange={(e) => setGit(e.target.value)}
              />
              <Button type="submit" variant="primary" disabled={busy || !git.trim()}>
                {busy ? "Baixando…" : "Baixar"}
              </Button>
            </form>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        {preview && (
          <div className="plugins-approve" role="dialog" aria-label={`Instalar ${preview.name}`}>
            <h3>
              {preview.replaces ? "Atualizar" : "Instalar"} {preview.name} <small>{preview.version}</small>
            </h3>
            <p className="plugins-muted">
              {preview.key}
              {preview.replaces ? ` · substitui a versão ${preview.replaces.version}` : ""}
              {preview.dev ? " · em desenvolvimento (usa a pasta original)" : ""}
            </p>
            {preview.description && <p>{preview.description}</p>}
            {preview.runsCode && (
              <p className="plugins-warning">
                <ShieldAlert size={14} /> Este plugin roda código próprio no seu computador. Instale só plugins de quem você confia.
              </p>
            )}
            <h4>O que ele pede</h4>
            {preview.capabilities.length ? (
              <ul className="plugins-capabilities">
                {preview.capabilities.map((c) => (
                  <li key={c.kind}>
                    {c.text} <code>{c.kind}</code>
                    {preview.replaces?.newCapabilities.includes(c.kind) && <Badge tone="warning">nova</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="plugins-muted">Nenhuma permissão.</p>
            )}
            {preview.editors.length > 0 && (
              <>
                <h4>Abre arquivos</h4>
                <ul>
                  {preview.editors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </>
            )}
            {preview.unsupported.length > 0 && (
              <p className="plugins-muted">
                Ainda sem efeito no Golfinho: {preview.unsupported.join(", ")}. O resto do plugin funciona normalmente.
              </p>
            )}
            <div className="plugins-actions">
              <Button variant="ghost" onClick={() => void cancelPreview()}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await pluginRequest({ action: "install", token: preview.token });
                    setPreview(null);
                    pluginsChanged();
                  })
                }
              >
                Instalar e permitir
              </Button>
            </div>
          </div>
        )}

        <h3 className="plugins-title">Instalados</h3>
        {plugins.length === 0 && <p className="plugins-muted">Nenhum plugin instalado.</p>}
        <ul className="plugins-list">
          {plugins.map((p) => (
            <InstalledPlugin
              key={p.key}
              plugin={p}
              onRemove={async () => {
                if (
                  !(await confirm({
                    title: `Remover ${p.name}?`,
                    message: "Saem o plugin e os dados dele: ambientes, histórico, segredos e configurações.",
                    confirmLabel: "Remover plugin",
                    tone: "danger",
                  }))
                )
                  return;
                await run(() => pluginRequest({ action: "remove", key: p.key }));
                pluginsChanged();
              }}
              onError={setError}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function InstalledPlugin({ plugin: p, onRemove, onError }: { plugin: PluginInfo; onRemove: () => void; onError: (e: string) => void }) {
  const [logs, setLogs] = useState<string[] | null>(null);
  const [values, setValues] = useState(p.values);
  useEffect(() => setValues(p.values), [p.values]);
  const act = (r: Record<string, unknown>) =>
    pluginRequest(r as { action: string })
      .then(() => pluginsChanged())
      .catch((e: Error) => onError(e.message));
  const save = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
    void act({ action: "settings", key: p.key, values: { [key]: value } });
  };
  return (
    <li className={"plugins-item" + (p.enabled ? "" : " off")}>
      <div className="plugins-item-head">
        <div>
          <strong>{p.name}</strong> <small>{p.version}</small>
          <div className="plugins-muted">
            {p.key} · {p.source.dev ? "em desenvolvimento" : `de ${SOURCE[p.source.kind]}`}
          </div>
        </div>
        <Switch label={p.enabled ? `Desativar ${p.name}` : `Ativar ${p.name}`} checked={p.enabled} onChange={(on) => void act({ action: "enable", key: p.key, enabled: on })} />
      </div>
      {p.description && <p className="plugins-description">{p.description}</p>}
      {p.error && <p className="error">{p.error}</p>}
      {p.editors.length > 0 && (
        <p className="plugins-muted">Abre: {p.editors.map((e) => [...e.extensions, ...e.filenames].join(", ")).join(" · ")}</p>
      )}
      {p.unsupported.length > 0 && <p className="plugins-muted">Ainda sem efeito no Golfinho: {p.unsupported.join(", ")}</p>}
      {p.settings.length > 0 && (
        <div className="plugins-settings">
          {p.settings.map((s) => (
            <label key={s.key} title={s.description}>
              <span>{s.title}</span>
              {s.type === "boolean" ? (
                <Switch label={s.title} checked={values[s.key] === true} onChange={(on) => save(s.key, on)} />
              ) : (
                <input
                  type={s.type === "string" ? "text" : "number"}
                  min={s.minimum}
                  max={s.maximum}
                  defaultValue={String(values[s.key] ?? "")}
                  onBlur={(e) => {
                    const raw = e.target.value;
                    if (raw === String(values[s.key] ?? "")) return;
                    save(s.key, s.type === "string" ? raw : Number(raw));
                  }}
                />
              )}
            </label>
          ))}
        </div>
      )}
      <div className="plugins-actions">
        {p.source.dev && (
          <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => void act({ action: "reload", key: p.key })}>
            Recarregar
          </Button>
        )}
        <Button
          size="sm"
          icon={<ScrollText size={13} />}
          onClick={() =>
            logs ? setLogs(null) : void pluginRequest<string[]>({ action: "logs", key: p.key }).then(setLogs, (e: Error) => onError(e.message))
          }
        >
          {logs ? "Esconder log" : "Log"}
        </Button>
        <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={onRemove}>
          Remover
        </Button>
      </div>
      {logs && <pre className="plugins-log">{logs.length ? logs.join("\n") : "Nada no log ainda."}</pre>}
    </li>
  );
}
