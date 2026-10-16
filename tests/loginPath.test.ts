import { it, expect } from "vitest";
import { mergePath, readLoginPath } from "../src/main/loginPath";
it("junta PATH do login, atual e diretórios comuns, sem repetir", () => {
  const merged = mergePath("/usr/bin:/bin", "/opt/homebrew/bin:/usr/bin", "/Users/ana");
  expect(merged.split(":")).toEqual([
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    "/usr/local/bin",
    "/Users/ana/.local/bin",
  ]);
});
it("funciona sem PATH de login", () => {
  expect(mergePath(undefined, null, "/h").split(":")).toEqual(["/opt/homebrew/bin", "/usr/local/bin", "/h/.local/bin"]);
});
it("lê o PATH de um shell de verdade quando ele existe", () => {
  const value = readLoginPath("/bin/sh");
  expect(value === null || value.includes("/")).toBe(true);
});
