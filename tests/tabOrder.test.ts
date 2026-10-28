// @vitest-environment jsdom
import { it, expect, beforeEach } from "vitest";
import { arrangeTabs, mergeOrder, moveTab, storedTabOrder } from "../src/renderer/tabOrder";

beforeEach(() => localStorage.clear());

it("move a aba arrastada para o lugar da aba sob o cursor", () => {
  const order = ["Terminal", "Chat", "Shell", "Diff"];
  expect(moveTab(order, "Terminal", "Shell")).toEqual(["Chat", "Shell", "Terminal", "Diff"]);
  expect(moveTab(order, "Diff", "Chat")).toEqual(["Terminal", "Diff", "Chat", "Shell"]);
  expect(moveTab(order, "Chat", "Chat")).toBe(order);
});

it("lê a ordem salva, ignora aba desconhecida e acrescenta as que faltam", () => {
  localStorage.setItem("golfinho.tabOrder", JSON.stringify(["Checks", "Fantasma", "Terminal"]));
  expect(storedTabOrder()).toEqual(["Checks", "Terminal", "Chat", "Shell", "Diff", "Commit", "Arquivos", "Histórico"]);
  localStorage.setItem("golfinho.tabOrder", "{quebrado");
  expect(storedTabOrder()[0]).toBe("Terminal");
});

it("nunca esconde o Terminal e ignora abas desconhecidas", async () => {
  const { storedHiddenTabs } = await import("../src/renderer/tabOrder");
  localStorage.setItem("golfinho.hiddenTabs", JSON.stringify(["Checks", "Terminal", "Fantasma", "Histórico"]));
  expect(storedHiddenTabs()).toEqual(["Checks", "Histórico"]);
});

it("põe sessões do + entre as abas fixas e mantém as fixas na ordem global", () => {
  const fixed = ["Terminal", "Chat", "Diff"];
  // Sem posição salva: sessões no fim.
  expect(arrangeTabs([], fixed, ["session:a"])).toEqual(["Terminal", "Chat", "Diff", "session:a"]);
  // Sessão arrastada para antes do Chat continua lá.
  const placed = moveTab(["Terminal", "Chat", "Diff", "session:a"], "session:a", "Chat");
  expect(arrangeTabs(placed, fixed, ["session:a"])).toEqual(["Terminal", "session:a", "Chat", "Diff"]);
  // Outra tarefa trocou a ordem das fixas: a sessão fica no mesmo lugar, as fixas seguem a ordem nova.
  expect(arrangeTabs(placed, ["Chat", "Terminal", "Diff"], ["session:a"])).toEqual(["Chat", "session:a", "Terminal", "Diff"]);
  // Sessão fechada some; sessão nova entra no fim.
  expect(arrangeTabs(placed, fixed, ["session:b"])).toEqual(["Terminal", "Chat", "Diff", "session:b"]);
});

it("guarda a nova ordem das fixas sem perder as que estão escondidas", () => {
  const all = ["Terminal", "Chat", "Shell", "Diff", "Checks"];
  // Shell escondida; Diff foi arrastada para o começo.
  expect(mergeOrder(["Diff", "Terminal", "Chat", "Checks"], all)).toEqual(["Diff", "Terminal", "Chat", "Shell", "Checks"]);
});
