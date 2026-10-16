import type { Provider } from "../shared/contracts";
import antigravity from "./assets/agents/antigravity.svg";
import claude from "./assets/agents/claude.svg";
import codex from "./assets/agents/codex.svg";

const AGENT: Record<Provider, string> = {
  claude,
  codex,
  antigravity,
};
export function AgentIcon({ provider, size = 12 }: { provider: Provider; size?: number }) {
  return (
    <img
      src={AGENT[provider]}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={`agent-icon agent-icon--${provider}`}
    />
  );
}
