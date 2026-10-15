import { it, expect } from "vitest";
import { languageFor } from "../src/renderer/language";
const languages = [
  { id: "typescript", extensions: [".ts", ".tsx"] },
  { id: "python", extensions: [".py"] },
];
it("escolhe a linguagem pela extensão, sem diferenciar maiúsculas", () => {
  expect(languageFor("src/a.ts", languages)).toBe("typescript");
  expect(languageFor("ui/Botao.TSX", languages)).toBe("typescript");
  expect(languageFor("tools/run.py", languages)).toBe("python");
});
it("usa texto puro sem extensão reconhecida, inclusive em arquivos ocultos", () => {
  expect(languageFor("README", languages)).toBe("plaintext");
  expect(languageFor("tools/.env", languages)).toBe("plaintext");
  expect(languageFor("dados.xyz", languages)).toBe("plaintext");
  expect(languageFor("pasta.v2/arquivo", languages)).toBe("plaintext");
});
