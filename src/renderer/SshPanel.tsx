import React, { useState } from "react";
import { FolderTree, KeyRound, Lock, Plus, Server, Terminal, Trash2 } from "lucide-react";
import type { SshConnection } from "../shared/contracts";
import { Badge, Button, Field, TextInput, useConfirm } from "./ui";
const emptyForm = { name: "", host: "", user: "", port: "22", identityFile: "" };

// Perfis de acesso SSH. Os arquivos do servidor aparecem na barra lateral; o app não grava
// nada na VPS por conta própria. Nenhuma senha aparece aqui: a guardada fica no cofre do sistema.
export function SshPanel({
  connections,
  passwords,
  expanded = {},
  onSave,
  onSavePassword,
  onForgetPassword,
  onTerminal,
  onExpand,
  onError,
}: {
  connections: SshConnection[];
  passwords: string[];
  /** Perfis com a árvore de arquivos aberta na barra lateral. */
  expanded?: Record<string, boolean>;
  onSave: (next: SshConnection[]) => Promise<void>;
  onSavePassword: (connectionId: string, password: string) => Promise<void>;
  onForgetPassword: (connectionId: string) => Promise<void>;
  onTerminal: (connection: SshConnection) => void;
  onExpand: (connection: SshConnection) => void;
  onError: (e: unknown) => void;
}) {
  const confirm = useConfirm();
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [secretError, setSecretError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const connection: SshConnection = {
      id: crypto.randomUUID(),
      name: form.name.trim() || `${form.user.trim()}@${form.host.trim()}`,
      host: form.host.trim(),
      user: form.user.trim(),
      port: Number(form.port) || 22,
      identityFile: form.identityFile.trim() || null,
    };
    try {
      await onSave([...connections, connection]);
      setForm(emptyForm);
      setFormError("");
      setCreating(false);
    } catch (e) {
      setFormError((e as Error).message);
    }
  }
  const auth = (c: SshConnection) =>
    c.identityFile ? (
      <Badge tone="brand">
        <KeyRound size={11} /> Chave
      </Badge>
    ) : passwords.includes(c.id) ? (
      <Badge tone="success">
        <Lock size={11} /> Senha guardada
      </Badge>
    ) : (
      <Badge>Senha no terminal</Badge>
    );

  return (
    <section className="ssh-panel">
      <div className="ssh-inner">
        <div className="ssh-head">
          <div>
            <h1>SSH</h1>
            <p>Conecte em servidores pelo terminal do Golfinho. Os arquivos do servidor aparecem na barra lateral.</p>
          </div>
          {!creating && (
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              Nova conexão
            </Button>
          )}
        </div>

        {creating && (
          <form className="ui-card ssh-new" onSubmit={add} onKeyDown={(e) => e.key === "Escape" && setCreating(false)}>
            <div className="ssh-new-head">
              <Server size={16} />
              <strong>Nova conexão</strong>
            </div>
            <div className="ssh-new-grid">
              <Field label="Nome" htmlFor="ssh-name" hint="Opcional. Sem nome, vira usuário@servidor.">
                <TextInput
                  id="ssh-name"
                  autoFocus
                  placeholder="Ex.: Produção"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Servidor" htmlFor="ssh-host">
                <TextInput
                  id="ssh-host"
                  required
                  spellCheck={false}
                  placeholder="Host ou IP"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                />
              </Field>
              <Field label="Usuário" htmlFor="ssh-user">
                <TextInput
                  id="ssh-user"
                  required
                  spellCheck={false}
                  placeholder="Ex.: suporte"
                  value={form.user}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                />
              </Field>
              <Field label="Porta" htmlFor="ssh-port">
                <TextInput
                  id="ssh-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                />
              </Field>
              <Field
                label="Chave privada"
                htmlFor="ssh-key"
                className="ssh-wide"
                hint="Opcional. Caminho absoluto da chave. Sem chave, a senha é pedida no terminal ou vem do cofre."
              >
                <TextInput
                  id="ssh-key"
                  spellCheck={false}
                  placeholder="/home/você/.ssh/id_ed25519"
                  value={form.identityFile}
                  onChange={(e) => setForm({ ...form, identityFile: e.target.value })}
                />
              </Field>
            </div>
            {formError && <p className="ssh-error">{formError}</p>}
            <div className="ssh-new-actions">
              <Button
                onClick={() => {
                  setCreating(false);
                  setFormError("");
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="primary">
                Salvar conexão
              </Button>
            </div>
          </form>
        )}

        {connections.length === 0 && !creating && (
          <div className="ssh-empty">
            <Server size={28} />
            <strong>Nenhuma conexão salva</strong>
            <p>Cadastre um servidor para abrir o terminal SSH e navegar pelos arquivos dele.</p>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              Nova conexão
            </Button>
          </div>
        )}

        <div className="ssh-grid">
          {connections.map((c) => (
            <article key={c.id} className={"ui-card ssh-conn" + (expanded[c.id] ? " open" : "")}>
              <div className="ssh-conn-head">
                <span className="ssh-conn-icon">
                  <Server size={16} />
                </span>
                <div className="ssh-conn-title">
                  <strong title={c.name}>{c.name}</strong>
                  <code title={`${c.user}@${c.host}:${c.port}`}>
                    {c.user}@{c.host}
                    {c.port !== 22 && `:${c.port}`}
                  </code>
                </div>
                {auth(c)}
              </div>
              <div className="ssh-conn-actions">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Terminal size={13} />}
                  title="Abre o terminal SSH e mostra os arquivos do servidor na barra lateral"
                  aria-label={`Conectar ${c.name}`}
                  onClick={() => onTerminal(c)}
                >
                  Conectar
                </Button>
                <Button
                  size="sm"
                  icon={<FolderTree size={13} />}
                  aria-pressed={Boolean(expanded[c.id])}
                  title="Mostrar ou esconder os arquivos do servidor na barra lateral"
                  onClick={() => onExpand(c)}
                >
                  {expanded[c.id] ? "Esconder arquivos" : "Arquivos"}
                </Button>
                {!c.identityFile && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<KeyRound size={13} />}
                    aria-label={`Senha de ${c.name}`}
                    aria-expanded={keyFor === c.id}
                    title={passwords.includes(c.id) ? "Trocar ou esquecer a senha guardada" : "Guardar a senha no cofre do sistema"}
                    onClick={() => {
                      setSecret("");
                      setSecretError("");
                      setKeyFor(keyFor === c.id ? null : c.id);
                    }}
                  >
                    Senha
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ssh-remove"
                  icon={<Trash2 size={13} />}
                  aria-label={`Remover ${c.name}`}
                  title="Remover perfil"
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Remover o perfil "${c.name}"?`,
                        message: "O perfil sai do Golfinho, junto com a senha guardada. Nada no servidor é alterado.",
                        confirmLabel: "Remover perfil",
                        tone: "danger",
                      })
                    )
                      void onSave(connections.filter((x) => x.id !== c.id)).catch(onError);
                  }}
                />
              </div>
              {keyFor === c.id && (
                <form
                  className="ssh-secret-form"
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
                  <Field
                    label={passwords.includes(c.id) ? "Nova senha" : "Senha do servidor"}
                    htmlFor={`ssh-secret-${c.id}`}
                    error={secretError || undefined}
                    hint="Fica no cofre do sistema (GNOME Keyring ou Keychain), nunca no banco do Golfinho."
                  >
                    <TextInput
                      id={`ssh-secret-${c.id}`}
                      type="password"
                      autoFocus
                      autoComplete="new-password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                    />
                  </Field>
                  <div className="ssh-secret-actions">
                    {passwords.includes(c.id) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ssh-remove"
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `Esquecer a senha de "${c.name}"?`,
                              message: "A senha sai do cofre do sistema. Na próxima conexão, ela será pedida no terminal.",
                              confirmLabel: "Esquecer senha",
                              tone: "danger",
                            })
                          )
                            void onForgetPassword(c.id).then(() => setKeyFor(null), onError);
                        }}
                      >
                        Esquecer senha
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setKeyFor(null)}>
                      Cancelar
                    </Button>
                    <Button size="sm" type="submit" variant="primary" disabled={!secret}>
                      Guardar no cofre
                    </Button>
                  </div>
                </form>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
