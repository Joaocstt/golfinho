import React, { useState } from "react";
import { Folder, File, Plus, RefreshCw, Terminal, Trash2, KeyRound, ChevronDown, ChevronRight, X } from "lucide-react";
import type { Request, SshConnection, SshListing } from "../shared/contracts";
const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;
const emptyForm = { name: "", host: "", user: "", port: "22", identityFile: "" };
// Perfis de acesso SSH e a árvore de arquivos do servidor. Somente leitura: o app não
// grava nada na VPS. Nenhuma senha aparece aqui; a guardada fica no cofre do sistema.
export function SshPanel({
  connections,
  passwords,
  onSave,
  onSavePassword,
  onForgetPassword,
  onTerminal,
  onExpand,
  onError,
}: {
  connections: SshConnection[];
  passwords: string[];
  onSave: (next: SshConnection[]) => Promise<void>;
  onSavePassword: (connectionId: string, password: string) => Promise<void>;
  onForgetPassword: (connectionId: string) => Promise<void>;
  onTerminal: (connection: SshConnection) => void;
  onExpand: (connection: SshConnection) => void;
  onError: (e: unknown) => void;
}) {
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [secretError, setSecretError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  async function add(event: React.FormEvent) {
    event.preventDefault();
    const connection: SshConnection = {
      id: crypto.randomUUID(),
      name: form.name.trim() || `${form.user}@${form.host}`,
      host: form.host.trim(),
      user: form.user.trim(),
      port: Number(form.port) || 22,
      identityFile: form.identityFile.trim() || null,
    };
    try {
      await onSave([...connections, connection]);
      setForm(emptyForm);
      setFormError("");
    } catch (e) {
      setFormError((e as Error).message);
    }
  }
  return (
    <section className="ssh-panel">
      <div className="overview-head">
        <h1>SSH</h1>
        <span>Os arquivos do servidor aparecem na barra lateral</span>
      </div>
      <div className="ssh-layout">
        <div className="ssh-list">
          {connections.length === 0 && <p className="notice">Nenhuma conexão salva ainda.</p>}
          {connections.map((c) => (
            <div key={c.id} className={"ssh-card " + ""}>
              <button className="ssh-card-main" title="Mostrar os arquivos na barra lateral" onClick={() => onExpand(c)}>
                <strong>{c.name}</strong>
                <small>
                  {c.user}@{c.host}:{c.port}
                  {c.identityFile ? " · chave" : passwords.includes(c.id) ? " · senha guardada" : " · senha no terminal"}
                </small>
              </button>
              <button
                title="Conectar: abre o terminal SSH e mostra os arquivos do servidor na direita"
                aria-label={`Conectar ${c.name}`}
                onClick={() => onTerminal(c)}
              >
                <Terminal size={13} /> Conectar
              </button>
              {!c.identityFile && (
                <button
                  title={passwords.includes(c.id) ? "Trocar ou esquecer a senha guardada" : "Guardar a senha no cofre do sistema"}
                  aria-label={`Senha de ${c.name}`}
                  onClick={() => {
                    setSecret("");
                    setSecretError("");
                    setKeyFor(keyFor === c.id ? null : c.id);
                  }}
                >
                  <KeyRound size={13} />
                </button>
              )}
              <button
                title="Remover perfil"
                aria-label={`Remover ${c.name}`}
                onClick={() => {
                  if (window.confirm(`Remover o perfil "${c.name}"? Nada no servidor é alterado.`))
                    void onSave(connections.filter((x) => x.id !== c.id)).catch(onError);
                }}
              >
                <Trash2 size={13} />
              </button>
              {keyFor === c.id && (
                <form
                  className="ssh-secret"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                      await onSavePassword(c.id, secret);
                      setSecret("");
                      setKeyFor(null);
                    } catch (e) {
                      setSecretError((e as Error).message);
                    }
                  }}
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Senha do servidor"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                  {secretError && <p className="error">{secretError}</p>}
                  <div>
                    <button className="primary" disabled={!secret}>
                      Guardar no cofre
                    </button>
                    {passwords.includes(c.id) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Esquecer a senha guardada de "${c.name}"?`))
                            void onForgetPassword(c.id).then(() => setKeyFor(null), onError);
                        }}
                      >
                        Esquecer senha
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          ))}
          <form className="ssh-form" onSubmit={add}>
            <strong>Nova conexão</strong>
            <input placeholder="Nome (opcional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input required placeholder="Servidor (host ou IP)" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            <input required placeholder="Usuário" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
            <input type="number" min={1} max={65535} placeholder="Porta" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            <input placeholder="Chave privada (ex.: /home/você/.ssh/id_ed25519), opcional" value={form.identityFile} onChange={(e) => setForm({ ...form, identityFile: e.target.value })} />
            {formError && <p className="error">{formError}</p>}
            <button className="primary">
              <Plus size={12} /> Salvar conexão
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
