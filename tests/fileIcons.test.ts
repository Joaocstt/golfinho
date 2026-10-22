import { it, expect } from "vitest";
import { fileIcon, fileIconUrl, folderIcon } from "../src/renderer/fileIcons";


it("escolhe o ícone como o VS Code: nome exato, extensão mais longa, linguagem e genérico", () => {
  expect(fileIcon("package.json")).toBe("nodejs");
  expect(fileIcon("App.tsx")).toBe("react_ts");
  expect(fileIcon("store.ts")).toBe("typescript");
  expect(fileIcon("memory.test.ts")).toBe("test-ts");
  expect(fileIcon("Dockerfile")).toBe("docker");
  expect(fileIcon("arquivo.semtipo")).toBe("file");
});
it("usa os ícones de pasta especiais, abertos e fechados", () => {
  expect(folderIcon("src")).toBe("folder-src");
  expect(folderIcon("src", true)).toBe("folder-src-open");
  expect(folderIcon("minha-pasta")).toBe("folder");
  expect(folderIcon("x", false, true)).toBe("folder-root");
});
it("todo ícone escolhido existe no pacote", () => {
  for (const name of ["package.json", "App.tsx", "README.md", "x.py", "arquivo.semtipo"])
    expect(fileIconUrl(name)).toBeTruthy();
});
