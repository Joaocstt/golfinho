import { it, expect } from "vitest";
import { countLines } from "../src/renderer/diffStats";
it("conta linhas adicionadas, removidas e trechos, incluindo adição e remoção puras", () => {
  expect(
    countLines([
      // Troca de 2 linhas por 3.
      { originalStartLineNumber: 5, originalEndLineNumber: 6, modifiedStartLineNumber: 5, modifiedEndLineNumber: 7 },
      // Só adição: o fim da faixa original vem 0.
      { originalStartLineNumber: 10, originalEndLineNumber: 0, modifiedStartLineNumber: 11, modifiedEndLineNumber: 12 },
      // Só remoção: o fim da faixa nova vem 0.
      { originalStartLineNumber: 20, originalEndLineNumber: 23, modifiedStartLineNumber: 21, modifiedEndLineNumber: 0 },
    ]),
  ).toEqual({ added: 5, removed: 6, hunks: 3 });
  expect(countLines([])).toEqual({ added: 0, removed: 0, hunks: 0 });
});
