// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import { it, expect, afterEach } from "vitest";
import { HelpPane } from "../src/renderer/HelpPane";
afterEach(cleanup);
it("mostra o fluxo em 7 etapas na ordem do trabalho", () => {
  render(<HelpPane />);
  const flow = screen.getByRole("list", { name: "Fluxo de uma tarefa" });
  const steps = within(flow).getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent);
  expect(steps).toEqual(["Projeto", "Tarefa", "Fila", "Trabalho", "Revisão", "Concluir", "Publicar"]);
});
it("traz os tópicos, com só o primeiro aberto", () => {
  const { container } = render(<HelpPane />);
  const topics = [...container.querySelectorAll("details.help-topic")];
  expect(topics.map((d) => d.querySelector("summary")?.textContent)).toContain("Terminal ou Chat: qual usar");
  expect(topics.filter((d) => (d as HTMLDetailsElement).open)).toHaveLength(1);
  expect((topics[0] as HTMLDetailsElement).open).toBe(true);
});
it("lista atalhos e problemas comuns", () => {
  render(<HelpPane />);
  const shortcuts = screen.getByRole("region", { name: "Atalhos" });
  expect(within(shortcuts).getByText("Ctrl+Shift+F")).toBeTruthy();
  const problems = screen.getByRole("region", { name: "Problemas comuns" });
  expect(within(problems).getByText("A tarefa não sai da fila")).toBeTruthy();
});
