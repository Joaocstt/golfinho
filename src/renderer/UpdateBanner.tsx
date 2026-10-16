import { useEffect, useState } from "react";
import type { UpdateStatus } from "../shared/contracts";

// Aviso discreto no canto inferior direito. Aparece só quando há algo para o usuário fazer
// ou acompanhar; sem atualização, sem API (testes) ou em desenvolvimento, não renderiza nada.
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    const api = window.golfinho?.update;
    if (!api) return;
    let alive = true;
    void api.status().then((s) => alive && setStatus(s));
    const unsubscribe = api.subscribe((s) => alive && setStatus(s));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  if (status.state === "downloading") {
    return (
      <div className="update-banner" role="status">
        Baixando a versão {status.version}… {status.percent}%
      </div>
    );
  }
  if (status.state !== "ready") return null;
  return (
    <div className="update-banner" role="status">
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
    </div>
  );
}
