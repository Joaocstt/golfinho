import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Provider } from "../shared/contracts";
// A sessão já existe no disco assim que a CLI sobe; o id dela é o que permite
// retomar a conversa em vez de reenviar o prompt original numa conversa nova.
const MARGIN = 60_000;
async function firstLine(file: string) {
  const reader = createInterface({ input: createReadStream(file, "utf8") });
  try {
    for await (const line of reader) if (line.trim()) return line;
    return "";
  } finally {
    reader.close();
  }
}
async function recent(directory: string, since: number, depth = 4): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: { file: string; at: number }[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && depth > 0) {
      for (const file of await recent(path, since, depth - 1)) found.push({ file, at: 0 });
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    try {
      const info = await stat(path);
      if (info.mtimeMs >= since - MARGIN) found.push({ file: path, at: info.mtimeMs });
    } catch {
      /* sumiu no meio */
    }
  }
  return found.sort((a, b) => b.at - a.at).map((entry) => entry.file);
}
// Codex grava session_meta com id e cwd na primeira linha do rollout.
async function codex(cwd: string, since: number, home: string) {
  for (const file of await recent(join(home, ".codex", "sessions"), since)) {
    try {
      const head = JSON.parse(await firstLine(file));
      if (head?.type !== "session_meta") continue;
      const payload = head.payload ?? {};
      if (payload.cwd !== cwd) continue;
      const id = String(payload.id ?? payload.session_id ?? "");
      if (id) return id;
    } catch {
      /* próximo */
    }
  }
  return null;
}
// Claude nomeia o arquivo com o id da sessão; o cwd confirma o projeto, porque o
// nome do diretório é um slug com perdas.
async function claude(cwd: string, since: number, home: string) {
  const directory = join(home, ".claude", "projects", cwd.replace(/\//g, "-"));
  for (const file of await recent(directory, since, 0)) {
    try {
      for await (const line of createInterface({ input: createReadStream(file, "utf8") })) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        if (typeof entry?.cwd !== "string") continue;
        if (entry.cwd !== cwd) break;
        const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.jsonl$/, "");
        return name || null;
      }
    } catch {
      /* próximo */
    }
  }
  return null;
}
// Antigravity mantém um índice direto de diretório para conversa.
async function antigravity(cwd: string, _since: number, home: string) {
  try {
    const index = JSON.parse(
      await readFile(join(home, ".gemini", "antigravity-cli", "cache", "last_conversations.json"), "utf8"),
    );
    const id = index?.[cwd];
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}
const finders: Record<Provider, (cwd: string, since: number, home: string) => Promise<string | null>> =
  { codex, claude, antigravity };
export function findSession(
  provider: Provider,
  cwd: string,
  since: number,
  home = homedir(),
): Promise<string | null> {
  return finders[provider](cwd, since, home).catch(() => null);
}
