import { it, expect } from "vitest";
import { invocation } from "../src/main/agents";
it("builds interactive commands for all providers without bypassing approvals", () => {
  for (const provider of ["codex", "claude", "antigravity"] as const) {
    const command = invocation(provider, "/repo", "Faça a tarefa");
    expect(command.args.join(" ")).not.toMatch(/dangerously|bypass|skip-permissions/);
    expect(command.args).toContain("Faça a tarefa");
  }
  expect(invocation("codex", "/repo", "x").args).toContain("workspace-write");
  expect(invocation("antigravity", "/repo", "x").args).toContain("--prompt-interactive");
});
