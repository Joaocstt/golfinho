import { describe, it, expect } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/store";
import { Service } from "../src/main/service";
import { ChatManager } from "../src/main/chat";
import { GitService } from "../src/main/git";
import type { Coordinator } from "../src/main/coordinator";
import type { ChatEvent, ChatHistoryItem } from "../src/shared/contracts";
import { currentContext } from "../src/shared/chatContext";

// Teste ao vivo: usa as CLIs claude e codex de verdade, com a sua autenticação. Gasta tokens e
// demora alguns minutos. Só roda com GOLFINHO_LIVE=1. Não é parte da suíte normal.
const live = process.env.GOLFINHO_LIVE === "1";
const CODE = "ZEBRA-42";
// O Codex pode estar sem cota; o alvo da troca é escolhido por variável.
const TARGET = (process.env.GOLFINHO_LIVE_TARGET ?? "antigravity") as "codex" | "antigravity";

const which = (name: string) => execSync(`command -v ${name}`).toString().trim();

function waitIdle(store: Store, taskId: string, afterSeq: number, timeoutMs = 300_000): Promise<ChatHistoryItem[]> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const items = store.chatEvents(taskId);
      const fresh = items.filter((i) => i.seq > afterSeq);
      const status = [...fresh].reverse().find((i) => i.event.type === "status")?.event;
      if (status?.type === "status" && status.state === "error") return reject(new Error(`Agente falhou: ${status.message ?? ""}`));
      if (status?.type === "status" && status.state === "idle" && fresh.some((i) => i.event.type === "assistant"))
        return resolve(fresh);
      if (Date.now() - started > timeoutMs) return reject(new Error("Tempo esgotado esperando a resposta do agente."));
      setTimeout(tick, 1000);
    };
    tick();
  });
}

const text = (items: ChatHistoryItem[]) =>
  items
    .map((i) => i.event)
    .filter((e): e is Extract<ChatEvent, { type: "assistant" }> => e.type === "assistant")
    .flatMap((e) => e.blocks.filter((b) => b.kind === "text").map((b) => b.text))
    .join("\n");

describe.skipIf(!live)("troca de agente ao vivo com código fictício", () => {
  it(
    "o agente de destino recebe o código guardado com o Claude pelo pacote de handoff",
    async () => {
      const dir = mkdtempSync(join(process.env.GOLFINHO_LIVE_DIR ?? tmpdir(), "golfinho-live-"));
      const repo = join(dir, "repo");
      execFileSync("git", ["init", "-q", "-b", "main", repo]);
      writeFileSync(join(repo, "README.md"), "# teste\n");
      execFileSync("git", ["-C", repo, "add", "."]);
      execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
      console.log("Repositório de teste:", repo);

      const store = new Store(":memory:");
      store.addProject({ id: "p", name: "Repo", path: repo, remotes: [] });
      store.saveSettings({
        ...store.settings(),
        executables: { claude: which("claude"), codex: which("codex"), antigravity: which("agy") },
      });
      const task = store.createTask({
        projectId: "p",
        title: "Teste ao vivo",
        prompt: "Teste",
        provider: "claude",
        branch: "golfinho/zebra",
        base: "main",
        remote: "origin",
        timeoutMinutes: 0,
      });

      const chat = new ChatManager(() => {}, {
        append: (taskId, event) => store.chatAppend(taskId, event),
        list: (taskId) => store.chatEvents(taskId),
        sessionId: (taskId) => store.task(taskId).chatSessionId ?? null,
        saveSessionId: (taskId, id) => store.setChatSession(taskId, id),
      });
      const service = new Service(
        store,
        new GitService(),
        {} as Coordinator,
        {} as never,
        () => {},
        async () => null,
        undefined,
        undefined,
        undefined,
        chat,
      );

      // 1. Claude guarda o código.
      const before1 = store.chatEvents(task.id).at(-1)?.seq ?? 0;
      await service.request({
        action: "chatSend",
        taskId: task.id,
        text: `Guarde este código para depois: ${CODE}. Responda apenas "anotado".`,
      });
      const claude = await waitIdle(store, task.id, before1);
      console.log("Claude respondeu:", text(claude));

      // 2. Troca para o Codex.
      await service.request({ action: "setTaskAgent", taskId: task.id, provider: TARGET });
      const changed = store.chatEvents(task.id).find((i) => i.event.type === "agent_changed")?.event;
      expect(changed?.type).toBe("agent_changed");
      const handoff = changed?.type === "agent_changed" ? (changed.handoff ?? "") : "";
      console.log("Pacote de handoff registrado:\n", handoff || "(vazio)");
      expect(handoff).toContain(CODE);
      expect(store.task(task.id).sessionId).toBeNull();
      expect(store.task(task.id).chatSessionId).toBeNull();
      expect(currentContext(store.chatEvents(task.id).map((i) => i.event))).toBeUndefined();

      // 3. Pergunta ao Codex. A conversa do Claude não é retomada: só o pacote leva o código.
      const before2 = store.chatEvents(task.id).at(-1)?.seq ?? 0;
      await service.request({
        action: "chatSend",
        taskId: task.id,
        text: "Qual é o código que eu pedi para guardar? Responda só com o código, ou 'não sei'.",
      });
      expect(store.pendingHandoff(task.id)).toBeNull();
      const codex = await waitIdle(store, task.id, before2);
      const answer = text(codex);
      console.log("Codex respondeu:", answer);
      expect(answer).toContain(CODE);

      // 4. A barra de contexto volta a vir do Codex, se ele informou o uso.
      const ctx = currentContext(store.chatEvents(task.id).map((i) => i.event));
      console.log("Contexto atual (Codex):", ctx ?? "não informado pela CLI");

      store.close();
      console.log("Conversa e repositório mantidos em:", dir);
    },
    900_000,
  );
});
