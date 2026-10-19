import { it, expect } from "vitest";
import { requestSchema } from "../src/main/schema";
it("rejects malformed IPC, excessive allocation and unsupported actions", () => {
  expect(
    requestSchema.safeParse({ action: "resize", taskId: "bad", cols: 9999, rows: 20 }).success,
  ).toBe(false);
  expect(requestSchema.safeParse({ action: "snapshot", path: "/etc/passwd" }).success).toBe(false);
  expect(requestSchema.safeParse({ action: "executeArbitrary", command: "x" }).success).toBe(false);
  expect(requestSchema.safeParse({ action: "snapshot" }).success).toBe(true);
});
it("allows bounded clipboard text and rejects unexpected payloads",()=>{
 expect(requestSchema.safeParse({action:"readClipboard"}).success).toBe(true);
 expect(requestSchema.safeParse({action:"writeClipboard",text:"seleção"}).success).toBe(true);
 expect(requestSchema.safeParse({action:"writeClipboard",text:"a".repeat(2*1024*1024+1)}).success).toBe(false);
 expect(requestSchema.safeParse({action:"readClipboard",command:"x"}).success).toBe(false);
});

it("aceita mensagens longas no chat", () => {
  expect(
    requestSchema.safeParse({
      action: "chatSend",
      taskId: "0199cf80-3b73-7252-9458-adfe7a905da5",
      text: "a".repeat(64 * 1024 + 1),
    }).success,
  ).toBe(true);
});

it("aceita criar tarefa sem título nem instruções", () => {
  const base = {
    action: "createTask",
    input: {
      projectId: "0199cf80-3b73-7252-9458-adfe7a905da5",
      provider: "codex",
      branch: "golfinho/x",
      base: "main",
      remote: "origin",
      timeoutMinutes: 0,
    },
  };
  expect(requestSchema.safeParse({ ...base, input: { ...base.input, title: "", prompt: "" } }).success).toBe(true);
  expect(requestSchema.safeParse({ ...base, input: { ...base.input, title: "a".repeat(201), prompt: "" } }).success).toBe(false);
});

it("aceita setup por projeto e recusa identificador que não é de projeto", () => {
  const ok = {
    action: "settings",
    settings: {
      concurrency: 2,
      executables: { codex: "codex", claude: "claude", antigravity: "agy" },
      setup: { "0199cf80-3b73-7252-9458-adfe7a905da5": "npm ci" },
    },
  };
  expect(requestSchema.safeParse(ok).success).toBe(true);
  expect(
    requestSchema.safeParse({ ...ok, settings: { ...ok.settings, setup: { nao_uuid: "npm ci" } } })
      .success,
  ).toBe(false);
});
