import { it, expect } from "vitest";
import { CodexChatSession } from "../src/main/codexChat";
import type { ChatEvent } from "../src/shared/contracts";
it("lê o uso de contexto da notificação thread/tokenUsage/updated do Codex", () => {
  const events: ChatEvent[] = [];
  const session = new CodexChatSession("/repo", "codex", (e) => events.push(e)) as unknown as {
    notification: (method: string, params: unknown) => void;
  };
  session.notification("thread/tokenUsage/updated", {
    threadId: "t",
    turnId: "u",
    tokenUsage: {
      last: { inputTokens: 1200, cachedInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 1500, cacheWriteInputTokens: 0 },
      total: { inputTokens: 5000, cachedInputTokens: 0, outputTokens: 900, reasoningOutputTokens: 0, totalTokens: 5900, cacheWriteInputTokens: 0 },
      modelContextWindow: 200000,
    },
  });
  expect(events).toEqual([{ type: "context", used: 1200, limit: 200000 }]);
});
