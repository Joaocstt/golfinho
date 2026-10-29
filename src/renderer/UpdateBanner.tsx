import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { UpdateStatus } from "../shared/contracts";

// Aviso discreto no canto inferior direito. Nada é verificado sozinho: `requested` muda quando
// o usuário clica em "Verificar atualizações", e só então o aviso aparece com o resultado.
// Baixar e reiniciar também são cliques do usuário.
export function UpdateBanner({ requested }: { requested: number }) {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [installing, setInstalling] = useState(false);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const api = window.golfinho?.update;
    if (!api) return;
    let alive = true;
    void api.status().then((s) => alive && setStatus(s));
    const unsubscribe = api.subscribe((s) => {
      if (!alive) return;
      setStatus(s);
      setHidden(false);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!requested) return;
    setHidden(false);
    void window.golfinho?.update?.check();
  }, [requested]);
  // "Já está atualizado" some sozinho.
  useEffect(() => {
    if (status.state !== "latest" || hidden) return;
    const timer = setTimeout(() => setHidden(true), 5000);
    return () => clearTimeout(timer);
  }, [status, hidden]);

  if (hidden || status.state === "idle") return null;
  const close = (
    <button className="update-close" aria-label="Fechar aviso" title="Fechar" onClick={() => setHidden(true)}>
      <X size={13} />
    </button>
  );
  let body: React.ReactNode;
  switch (status.state) {
    case "unsupported":
      body = <><span>Esta instalação não se atualiza por aqui (modo de desenvolvimento, snap ou .deb).</span>{close}</>;
      break;
    case "checking":
      body = <span>Verificando atualizações…</span>;
      break;
    case "latest":
      body = <><span>Você já está na versão mais recente ({status.version}).</span>{close}</>;
      break;
    case "error":
      body = <><span>{status.message}</span>{close}</>;
      break;
    case "available":
      body = (
        <>
          <span>Versão {status.version} disponível.</span>
          <button className="primary" onClick={() => void window.golfinho.update.download()}>
            Atualizar
          </button>
          {close}
        </>
      );
      break;
    case "downloading":
      body = <span>Baixando a versão {status.version}… {status.percent}%</span>;
      break;
    case "ready":
      body = (
        <>
          <span>Versão {status.version} pronta.</span>
          <button
            className="primary"
            disabled={installing}
            onClick={() => {
              setInstalling(true);
              void window.golfinho.update.install().catch(() => setInstalling(false));
            }}
          >
            {installing ? "Reiniciando…" : "Reiniciar e atualizar"}
          </button>
          {close}
        </>
      );
  }
  return (
    <div className="update-banner" role="status">
      {body}
    </div>
  );
}
