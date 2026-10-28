import { useEffect, useState } from "react";
import type { Provider, ProviderQuota, QuotaWindow } from "../shared/contracts";
const WINDOW: Record<QuotaWindow["window"], string> = { "5h": "Sessão de 5 h", weekly: "Semana" };
// O reset vem como ISO quando a CLI informa a data; caso contrário, o texto cru do rótulo.
function resetText(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
// Conteúdo do tooltip da barra inferior: consumo de cada janela do plano do agente.
export function AgentQuotaTip({ label, quota, loading }: { label: string; quota?: ProviderQuota; loading: boolean }) {
  return (
    <div className="agent-tip" role="tooltip">
      <strong>{label}</strong>
      {!quota && loading && <p className="agent-tip-muted">Carregando consumo…</p>}
      {quota && !quota.available && <p className="agent-tip-muted">CLI não encontrada.</p>}
      {quota?.available && quota.error && <p className="agent-tip-muted">{quota.error}</p>}
      {quota?.available &&
        quota.groups.map((group) => (
          <div className="agent-tip-group" key={group.name}>
            {quota.groups.length > 1 && <em>{group.name}</em>}
            {group.windows.map((w) => (
              <div className="agent-tip-row" key={w.window}>
                <span>{WINDOW[w.window]}</span>
                <div className="agent-tip-bar">
                  <i style={{ width: `${Math.min(100, Math.max(0, w.usedPercent))}%` }} />
                </div>
                <b>{Math.round(w.usedPercent)}%</b>
                <small>reseta {resetText(w.resetsAt)}</small>
              </div>
            ))}
          </div>
        ))}
      {quota?.available && quota.plan && <p className="agent-tip-muted">Plano: {quota.plan}</p>}
      {quota?.account && <p className="agent-tip-muted">Conta: {quota.account}</p>}
    </div>
  );
}

const LABELS: Record<string, string> = { "5h": "Janela de 5 h", weekly: "Semanal" };
const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
function reset(value: string) {
  if (!value) return "";
  const parsed = Date.parse(value);
  return isFinite(parsed) ? quando.format(parsed) : value;
}
// Barras de consumo por janela: usadas no painel Consumo e no inspetor da tarefa.
export function QuotaPanel({
  quota,
  busy,
  failed,
}: {
  quota: ProviderQuota | null;
  busy: boolean;
  failed: boolean;
}) {
  if (!quota)
    return (
      <p className="usage-note">
        {busy ? "Consultando a CLI…" : failed ? "Não foi possível consultar a CLI." : "—"}
      </p>
    );
  if (!quota.available || !quota.groups.length)
    return <p className="usage-note">{quota.error || "A CLI não informou limites."}</p>;
  return (
    <>
      {quota.groups.map((group, index) => (
        <div className="quota-group" key={group.name || index}>
          {group.name && <h5>{group.name}</h5>}
          {group.windows.map((w) => (
            <div className="quota-row" key={w.window}>
              <div className="quota-head">
                <span>{LABELS[w.window] ?? w.window}</span>
                <strong>{w.usedPercent}%</strong>
              </div>
              <div
                className="quota-bar"
                role="meter"
                aria-label={`${LABELS[w.window] ?? w.window}: ${w.usedPercent}% usado`}
                aria-valuenow={w.usedPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i
                  data-level={w.usedPercent >= 90 ? "alto" : w.usedPercent >= 70 ? "medio" : "ok"}
                  style={{ width: `${w.usedPercent}%` }}
                />
              </div>
              {w.resetsAt && <small>renova em {reset(w.resetsAt)}</small>}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
const QUOTA_INTERVAL_MS = 60_000;
// Consumo só do agente da tarefa, no fim do inspetor. Atualiza a cada minuto enquanto aparece;
// o processo principal guarda a leitura por um minuto, então várias abas não multiplicam as chamadas.
export function TaskQuota({ provider, label }: { provider: Provider; label: string }) {
  const [quota, setQuota] = useState<ProviderQuota | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setQuota(null);
    const load = async () => {
      setBusy(true);
      try {
        const value = (await window.golfinho.request({ action: "quota", provider })) as ProviderQuota;
        if (alive) (setQuota(value), setFailed(false));
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setBusy(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), QUOTA_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [provider]);
  return (
    <div className="inspector-section task-quota">
      <div className="task-quota-head">
        <h3>Consumo · {label}</h3>
        {quota?.plan && <span>{quota.plan}</span>}
      </div>
      {quota?.account && <small className="usage-account">{quota.account}</small>}
      <QuotaPanel quota={quota} busy={busy} failed={failed} />
    </div>
  );
}
