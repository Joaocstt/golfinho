import type { SshConnection } from "../shared/contracts";

export const SSH_SERVER = "golfinho_ssh";
export const SSH_TOKEN_ENV = "GOLFINHO_SSH_TOKEN";

export interface SshMcpEndpoint {
  url: string;
  token: string;
  /** Pasta com `.agents/mcp_config.json`, passada ao `agy` via `--add-dir`. */
  agyDir: string;
}

export interface SshMcpLink {
  endpoint(taskId: string, wsl?: boolean): SshMcpEndpoint | null;
}

export interface SshApprovalRequest {
  toolName: string;
  summary: string;
  signal?: AbortSignal;
}

// Aviso curto adicionado na primeira mensagem de uma conversa nova quando há servidores liberados.
export function sshPromptNote(connections: SshConnection[]): string | null {
  const allowed = connections.filter((c) => c.allowAi === true);
  if (!allowed.length) return null;
  const list = allowed
    .map((c) => `- ${c.name} (${c.user}@${c.host}${c.port !== 22 ? `:${c.port}` : ""})`)
    .join("\n");
  return [
    `Servidores SSH liberados para análise neste Golfinho (via MCP ${SSH_SERVER}):`,
    list,
    "Use ssh_servidores, ssh_resumo, ssh_arquivos e ssh_ler para consultar, e ssh_executar para rodar comandos (sempre pede confirmação do usuário no chat antes de executar).",
  ].join("\n");
}
