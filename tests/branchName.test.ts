import { it, expect } from "vitest";
import { branchProblem } from "../src/renderer/TaskForm";
it("aceita nomes comuns e recusa os que o git não aceita", () => {
  for (const ok of ["golfinho/login", "feature/assinatura-v2", "fix_1.2"]) expect(branchProblem(ok)).toBe("");
  for (const bad of ["a b", "a..b", "a//b", "-x", "/x", "x/", "x.", "x.lock", "a~b", "a:b", "a@{b"])
    expect(branchProblem(bad)).not.toBe("");
});
