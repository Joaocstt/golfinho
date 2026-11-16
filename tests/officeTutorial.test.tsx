// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfficeTutorial } from "../src/renderer/OfficeTutorial";
import type { Project, Request, Settings } from "../src/shared/contracts";

afterEach(cleanup);
const project: Project = { id: "11111111-1111-4111-8111-111111111111", name: "Golfinho", path: "C:/repo", remotes: [] };
const settings = { ssh: [], executables: { claude: "claude", codex: "codex", antigravity: "agy" }, setup: {} } as Settings;

function setup() {
  const request = vi.fn(async (_r: Request) => null);
  (window as any).golfinho = { request, subscribe: () => () => undefined };
  const onClose = vi.fn();
  render(<OfficeTutorial projects={[project]} initialProject={project.id} settings={settings} onClose={onClose} />);
  return { request, onClose };
}
const next = (name: string | RegExp = "Continuar") => fireEvent.click(screen.getByRole("button", { name }));

it("monta a equipe: quem é, personagem, mesa e lugar; depois salva a sala e liga o Escritório", async () => {
  const { request } = setup();
  next("Vamos lá");
  next();
  expect(screen.getByText(/Não precisa de chave de API/)).toBeTruthy();
  next();
  fireEvent.click(screen.getByRole("button", { name: /Usar o Escritório/ }));
  fireEvent.change(screen.getByLabelText("Nome do agente"), { target: { value: "Lia" } });
  fireEvent.click(screen.getByRole("radio", { name: /Código/ }));
  next("Escolher o visual");
  next("Montar a mesa");
  next("Escolher o lugar");
  expect(screen.getByLabelText("Planta da sala")).toBeTruthy();
  next("Pronto");
  expect(screen.getByText("1 de 4 agentes")).toBeTruthy();
  next("Terminar");
  fireEvent.click(screen.getByRole("button", { name: "Abrir o Escritório" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: "settings" })));
  const saved = request.mock.calls.map((c) => c[0]).find((r) => r.action === "officeSaveLayout") as Extract<Request, { action: "officeSaveLayout" }>;
  expect(saved.layout.agents).toHaveLength(1);
  expect(saved.layout.agents[0]).toMatchObject({ name: "Lia", mode: "task", desk: { col: 3, row: 3 } });
  expect(request).toHaveBeenCalledWith({ action: "settings", settings: { ...settings, office: { enabled: true, tutorial: true } } });
});

it("agora não: desliga o Escritório sem montar equipe", async () => {
  const { request } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Pular a explicação" }));
  fireEvent.click(screen.getByRole("button", { name: /Agora não/ }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({ action: "settings", settings: { ...settings, office: { enabled: false, tutorial: true } } }),
  );
  expect(request.mock.calls.some((c) => c[0].action === "officeSaveLayout")).toBe(false);
});

it("não deixa passar sem nome", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Pular a explicação" }));
  fireEvent.click(screen.getByRole("button", { name: /Usar o Escritório/ }));
  next("Escolher o visual");
  expect(screen.getByText("Dê um nome ao agente.")).toBeTruthy();
});
