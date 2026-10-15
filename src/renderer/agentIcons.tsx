import { Orbit, Sparkles, TerminalSquare } from "lucide-react";
import type { Provider } from "../shared/contracts";
// Ícones genéricos do lucide, com uma cor por agente. Não usamos logotipos de terceiros.
const AGENT: Record<Provider, { Icon: typeof Sparkles; color: string }> = {
  claude: { Icon: Sparkles, color: "#d97757" },
  codex: { Icon: TerminalSquare, color: "#10a37f" },
  antigravity: { Icon: Orbit, color: "#4285f4" },
};
export function AgentIcon({ provider, size = 12 }: { provider: Provider; size?: number }) {
  const { Icon, color } = AGENT[provider];
  return <Icon size={size} color={color} aria-hidden="true" className="agent-icon" />;
}
