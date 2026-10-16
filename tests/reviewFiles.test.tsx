// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { ReviewFiles, groupByFolder } from "../src/renderer/ReviewFiles";
import type { FileChange } from "../src/shared/contracts";
afterEach(cleanup);
const change = (path: string, status: string): FileChange => ({ path, status, original: "", modified: "", binary: false });
const files = [
  change("src/renderer/App.tsx", "modified"),
  change("README.md", "modified"),
  change("src/renderer/HelpPane.tsx", "added"),
  change("build/icons/16x16.png", "added"),
  change("build/icons/32x32.png", "added"),
  change("src/main/old.ts", "deleted"),
  change("tests/help.test.tsx", "added"),
];
it("agrupa por pasta, com a raiz primeiro e nomes em ordem", () => {
  const groups = groupByFolder(files);
  expect(groups.map((g) => g.dir)).toEqual(["", "build/icons/", "src/main/", "src/renderer/", "tests/"]);
  expect(groups.find((g) => g.dir === "src/renderer/")!.files.map((f) => f.path)).toEqual([
    "src/renderer/App.tsx",
    "src/renderer/HelpPane.tsx",
  ]);
});
it("mostra o total e os contadores por tipo de mudança", () => {
  render(<ReviewFiles files={files} selected="" onSelect={() => undefined} />);
  expect(screen.getByText("7 arquivos")).toBeTruthy();
  expect(screen.getByTitle("4 novos")).toBeTruthy();
  expect(screen.getByTitle("2 modificados")).toBeTruthy();
  expect(screen.getByTitle("1 apagado")).toBeTruthy();
});
it("filtra por nome e avisa quando nada combina", () => {
  render(<ReviewFiles files={files} selected="" onSelect={() => undefined} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Filtrar arquivos" }), { target: { value: "icons" } });
  const list = screen.getByRole("listbox", { name: "Escolher arquivo" });
  expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["N16x16.png", "N32x32.png"]);
  fireEvent.change(screen.getByRole("searchbox", { name: "Filtrar arquivos" }), { target: { value: "zzz" } });
  expect(screen.getByText("Nenhum arquivo com esse nome.")).toBeTruthy();
});
it("não mostra filtro com poucos arquivos", () => {
  render(<ReviewFiles files={files.slice(0, 3)} selected="" onSelect={() => undefined} />);
  expect(screen.queryByRole("searchbox")).toBeNull();
});
it("clique e setas trocam o arquivo na ordem da lista", () => {
  const onSelect = vi.fn();
  render(<ReviewFiles files={files} selected="README.md" onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("option", { name: /HelpPane\.tsx/ }));
  expect(onSelect).toHaveBeenLastCalledWith("src/renderer/HelpPane.tsx");
  const list = screen.getByRole("listbox", { name: "Escolher arquivo" });
  fireEvent.keyDown(list, { key: "ArrowDown" });
  expect(onSelect).toHaveBeenLastCalledWith("build/icons/16x16.png");
  fireEvent.keyDown(list, { key: "ArrowUp" });
  expect(onSelect).toHaveBeenLastCalledWith("README.md");
});
