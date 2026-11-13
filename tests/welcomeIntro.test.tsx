// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { INTRO_DURATION, WELCOME_MESSAGES, WelcomeIntro } from "../src/renderer/WelcomeIntro";
import type { AgentInfo } from "../src/shared/contracts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const agents: AgentInfo[] = [
  { provider: "claude", label: "Claude Code", executable: "claude", available: true, path: "/usr/local/bin/claude" },
  { provider: "codex", label: "Codex", executable: "codex", available: false, path: null },
];

it("dá boas-vindas, mostra as CLIs que vai procurar e não tem como pular", () => {
  render(<WelcomeIntro agents={agents} onDone={() => undefined} />);
  expect(screen.getByRole("dialog", { name: "Boas-vindas ao Golfinho" })).toBeTruthy();
  expect(screen.getByText(WELCOME_MESSAGES[0])).toBeTruthy();
  for (const name of ["Claude Code", "Codex", "Antigravity"]) expect(screen.getByText(name)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(INTRO_DURATION).toBe(15_000);
});

it("fecha sozinha depois de 15 s, mostrando onde achou cada CLI", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  const onDone = vi.fn();
  render(<WelcomeIntro agents={agents} onDone={onDone} />);
  await act(async () => vi.advanceTimersByTime(12_000));
  expect(screen.getByText("/usr/local/bin/claude")).toBeTruthy();
  expect(screen.getAllByText(/não encontrado/)).toHaveLength(2);
  expect(screen.getByText("1 de 3 agentes prontos para trabalhar.")).toBeTruthy();
  expect(onDone).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(4_000));
  expect(onDone).toHaveBeenCalledTimes(1);
});
