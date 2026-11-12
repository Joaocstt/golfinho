import { it, expect } from "vitest";
import { describeTool, shortPath, speechFrom } from "../src/shared/officeSpeech";
import {
  TEMPLATES,
  addDesk,
  defaultLayout,
  findPath,
  fits,
  itemAt,
  layoutProblems,
  moveItem,
  paint,
  placeFurniture,
  removeItem,
  tileAt,
} from "../src/shared/officeLayout";

it("todos os modelos prontos são salas válidas", () => {
  for (const t of TEMPLATES) expect(layoutProblems(t.build())).toEqual([]);
});

it("pintar troca só a célula escolhida", () => {
  const l = paint(defaultLayout(), { col: 12, row: 7 }, "azulejo");
  expect(tileAt(l, { col: 12, row: 7 })).toBe("azulejo");
  expect(tileAt(l, { col: 11, row: 7 })).toBe("tapete");
});

it("mesa nova cria um agente e não cabe em cima de outra", () => {
  const base = defaultLayout();
  expect(addDesk(base, { col: 4, row: 3 })).toBeNull();
  const added = addDesk(base, { col: 20, row: 11 })!;
  expect(added.layout.agents).toHaveLength(base.agents.length + 1);
  expect(itemAt(added.layout, { col: 21, row: 12 })).toEqual({ type: "agent", id: added.id });
  expect(layoutProblems(added.layout)).toEqual([]);
});

it("mesa do chefe e quadro só mudam de lugar; o resto sai", () => {
  const base = defaultLayout();
  const moved = placeFurniture(base, "chefe", { col: 2, row: 13 }, "x")!;
  expect(moved.furniture.filter((f) => f.kind === "chefe")).toEqual([{ id: "chefe", kind: "chefe", col: 2, row: 13 }]);
  expect(removeItem(base, { type: "furniture", id: "quadro" })).toBe(base);
  expect(removeItem(base, { type: "furniture", id: "planta-1" }).furniture.some((f) => f.id === "planta-1")).toBe(false);
  // Tirar o revisor da equipe deixa a sala sem revisor.
  expect(removeItem(base, { type: "agent", id: "eva" }).reviewer).toBeNull();
});

it("mover respeita parede e outros móveis", () => {
  const base = defaultLayout();
  expect(moveItem(base, { type: "agent", id: "ana" }, { col: 3, row: 0 })).toBeNull();
  expect(moveItem(base, { type: "agent", id: "ana" }, { col: 10, row: 3 })).toBeNull();
  const ok = moveItem(base, { type: "agent", id: "ana" }, { col: 3, row: 11 })!;
  expect(ok.agents.find((a) => a.id === "ana")!.desk).toEqual({ col: 3, row: 11 });
  expect(fits(base, "quadro", { col: 1, row: 0 })).toBe(true);
});

it("aponta o que impede salvar", () => {
  const base = defaultLayout();
  // Uma parede separando a fileira de cima do resto da sala.
  let walled = base;
  for (let col = 0; col < 25; col++) walled = paint(walled, { col, row: 6 }, "parede");
  const problems = layoutProblems(walled);
  expect(problems.some((p) => p.includes("não consegue chegar") && p.includes("Ana"))).toBe(true);
  expect(layoutProblems({ ...base, agents: [] })).toContain("Coloque pelo menos uma mesa com um agente.");
  expect(layoutProblems({ ...base, agents: [...base.agents, { ...base.agents[0], id: "outra" }] }).join(" ")).toMatch(/mesmo nome|em cima/);
  expect(layoutProblems({ ...base, reviewer: "ninguem" })).toContain("O revisor escolhido não está na equipe.");
});

it("o caminho contorna as mesas", () => {
  const path = findPath(defaultLayout(), { col: 1, row: 5 }, { col: 22, row: 5 })!;
  expect(path[0]).toEqual({ col: 1, row: 5 });
  expect(path.at(-1)).toEqual({ col: 22, row: 5 });
});

it("o telão fica na parede, não ocupa o chão e pode ter mais de um", () => {
  const base = defaultLayout();
  expect(base.furniture.some((f) => f.kind === "telao")).toBe(true);
  const two = placeFurniture(base, "telao", { col: 19, row: 1 }, "telao-2")!;
  expect(two.furniture.filter((f) => f.kind === "telao")).toHaveLength(2);
  expect(layoutProblems(two)).toEqual([]);
  expect(itemAt(two, { col: 20, row: 1 })).toEqual({ type: "furniture", id: "telao-2" });
});

it("as ações viram frases curtas, sem caminho completo", () => {
  expect(shortPath("C:\\Users\\x\\eventos\\src\\main\\auth.ts")).toBe("auth.ts (main)");
  expect(describeTool("Read", { file_path: "C:/a/b/src/App.tsx" })).toBe("Lendo App.tsx (src)");
  expect(describeTool("Grep", { pattern: "login" })).toBe('Buscando "login" no código');
  expect(describeTool("WebFetch", { url: "https://www.exemplo.com/x" })).toBe("Lendo a página exemplo.com");
  expect(speechFrom("**Vou** conferir os testes agora. E depois...")).toBe("Vou conferir os testes agora.");
  expect(speechFrom('{"titulo":"x"}')).toBe("");
});
