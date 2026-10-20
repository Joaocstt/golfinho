import { it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const fake = vi.hoisted(() => ({ children: [] as any[] }));

vi.mock("node:child_process", () => ({
  spawn: () => {
    const stdout = new EventEmitter() as any;
    stdout.setEncoding = () => {};
    const stderr = new EventEmitter() as any;
    stderr.setEncoding = () => {};
    const child = new EventEmitter() as any;
    child.stdout = stdout;
    child.stderr = stderr;
    child.sent = [] as string[];
    child.stdin = {
      writable: true,
      write: (data: string) => {
        child.sent.push(data);
        return true;
      },
    };
    child.kill = () => {};
    fake.children.push(child);
    return child;
  },
}));

import { AntigravityChatSession } from "../src/main/antigravityChat";
import type { ChatEvent } from "../src/shared/contracts";

let events: ChatEvent[];
const EXECUTABLE = process.execPath;

beforeEach(() => {
  fake.children.length = 0;
  events = [];
});

const sentMessages = () =>
  fake.children.flatMap((c) => c.sent.map((line: string) => JSON.parse(line)));

it("o pacote de handoff vai no turno do agy, mas a conversa mostra só a mensagem", () => {
  const session = new AntigravityChatSession("C:/repo", EXECUTABLE, (event) => events.push(event));
  session.send("continue", [], "CONTEXTO\n\n---\n\ncontinue");
  const [message] = sentMessages();
  expect(message.message.content).toEqual([{ type: "text", text: "CONTEXTO\n\n---\n\ncontinue" }]);
  expect(events).toContainEqual({ type: "user", text: "continue" });
  expect(JSON.stringify(events)).not.toContain("CONTEXTO");
});

it("sem pacote, o agy recebe só a mensagem", () => {
  const session = new AntigravityChatSession("C:/repo", EXECUTABLE, (event) => events.push(event));
  session.send("olá");
  const [message] = sentMessages();
  expect(message.message.content).toEqual([{ type: "text", text: "olá" }]);
});
