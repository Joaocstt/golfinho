import React, { useState } from "react";
import { Briefcase } from "lucide-react";
import type { Request, Settings } from "../shared/contracts";

const request = <T,>(r: Request) => window.golfinho.request(r) as Promise<T>;

// Escritório desligado: nada roda nem acompanha o chat. Daqui dá para ligar de novo ou refazer o
// tutorial (e montar a equipe outra vez).
export function OfficeOff({ settings }: { settings: Settings }) {
  const [error, setError] = useState("");
  const save = (office: Settings["office"]) =>
    request({ action: "settings", settings: { ...settings, office } }).catch((e) => setError((e as Error).message));
  return (
    <section className="office-off" aria-label="Escritório desligado">
      <Briefcase size={40} />
      <h2>O Escritório está desligado</h2>
      <p>Com ele ligado, uma equipe de agentes em 3D trabalha no projeto e acompanha o que você pede no chat das tarefas.</p>
      <div>
        <button type="button" className="primary" onClick={() => void save({ enabled: true, tutorial: true })}>
          Ligar o Escritório
        </button>
        <button type="button" onClick={() => void save({ enabled: false, tutorial: false })}>
          Ver o tutorial de novo
        </button>
      </div>
      {error && <p className="office-error">{error}</p>}
    </section>
  );
}
