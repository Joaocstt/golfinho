import type { ProviderQuota, QuotaWindow } from "../shared/contracts";
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
