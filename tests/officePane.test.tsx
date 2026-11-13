// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OfficePane } from "../src/renderer/OfficePane";
import type { Project, Request, Signal } from "../src/shared/contracts";
import type { OfficeState } from "../src/shared/office";
import { defaultLayout } from "../src/shared/officeLayout";
import { ConfirmProvider } from "../src/renderer/ui";

afterEach(cleanup);
const project: Project = { id: "11111111-1111-4111-8111-111111111111", name: "Golfinho", path: "C:/repo", remotes: [] };

function setup(state: Partial<OfficeState> = {}) {
  const listeners = new Set<(s: Signal) => void>();
  const office: OfficeState = { projectId: project.id, layout: defaultLayout(), chats: {}, thinking: [], jobs: [], ...state };
  const request = vi.fn(async (r: Request) => {
    if (r.action === "officeState" || r.action === "officeRead") return office;
    if (r.action === "officeAsk") return { action: "encaminhar", to: "carla", reply: "Fala com a Carla!" };
    return null;
  });
  (window as any).golfinho = { request, subscribe: (l: any) => (listeners.add(l), () => listeners.delete(l)) };
  const onOpenTask = vi.fn();
  render(
    <ConfirmProvider>
      <OfficePane projects={[project]} initialProject="" onOpenTask={onOpenTask} />
    </ConfirmProvider>,
  );
  return { request, onOpenTask, signal: (s: Signal) => listeners.forEach((l) => l(s)) };
}

it("abre a conversa pela equipe, envia o pedido e mostra o caminho para a colega certa", async () => {
  const { request } = setup();
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "officeState", projectId: project.id }));
  fireEvent.click(screen.getByRole("button", { name: /Bruno · Programador/ }));
  expect(screen.getByRole("dialog", { name: "Bruno · Programador" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Pedido"), { target: { value: "Cria um logo" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({ action: "officeAsk", projectId: project.id, agentId: "bruno", text: "Cria um logo" }),
  );
  expect(await screen.findByText(/Vá até a mesa da Carla/)).toBeTruthy();
  // Chegando na Carla, ela já sabe do pedido.
  fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
  fireEvent.click(screen.getByRole("button", { name: /Carla · Designer/ }));
  expect(screen.getByText(/O Bruno disse que você vinha/)).toBeTruthy();
});

it("mostra o andamento ao vivo e a entrega com o link da tarefa", async () => {
  const { signal, onOpenTask } = setup();
  await screen.findByText(/Nenhum pedido ainda/);
  signal({
    kind: "office",
    state: {
      projectId: project.id,
      layout: defaultLayout(),
      chats: {},
      thinking: [],
      jobs: [
        {
          id: "j1", agentId: "bruno", agentName: "Bruno", title: "Corrigir login", request: "corrige", status: "entregue", activity: "",
          result: "**feito**", notes: ["ok"], taskId: "22222222-2222-4222-8222-222222222222", read: false,
          createdAt: new Date().toISOString(),
        },
      ],
    },
  });
  expect(await screen.findByText("Corrigir login")).toBeTruthy();
  expect(screen.getByText(/implementado, falta o commit/)).toBeTruthy();
});

it("o modo de edição mostra as ferramentas e salva a sala", async () => {
  const { request } = setup();
  await screen.findByText(/Nenhum pedido ainda/);
  fireEvent.click(screen.getByRole("button", { name: /Editar escritório/ }));
  expect(screen.getByRole("button", { name: "Nova mesa (agente)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Salvar escritório" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: "officeSaveLayout", projectId: project.id })),
  );
});

it("o telão mostra cada agente agora e o passo a passo de cada trabalho", async () => {
  setup({
    jobs: [
      {
        id: "j1", agentId: "ana", agentName: "Ana", title: "Analisar concorrentes", request: "analisa", status: "fazendo",
        activity: "WebSearch apps de agentes", result: "", notes: [], read: false, createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        log: [
          { at: new Date().toISOString(), who: "Chefe", kind: "pedido", text: "analisa" },
          { at: new Date().toISOString(), who: "Ana", kind: "ferramenta", text: "WebSearch apps de agentes" },
        ],
      },
    ],
  });
  fireEvent.click(await screen.findByRole("button", { name: /Telão/ }));
  const dialog = screen.getByRole("dialog", { name: "Telão" });
  expect(within(dialog).getAllByText(/WebSearch apps de agentes/).length).toBeGreaterThan(0);
  fireEvent.click(within(dialog).getByRole("tab", { name: "Linha do tempo" }));
  expect(within(dialog).getByText("analisa", { selector: ".office-timeline-text" })).toBeTruthy();
});

it("pedido de permissão do agente aparece na sala e é respondido dali", async () => {
  const { request } = setup({
    jobs: [
      {
        id: "j1", agentId: "bruno", agentName: "Bruno", title: "Corrigir login", request: "corrige", status: "fazendo",
        activity: "Rodando: npm test", taskId: "22222222-2222-4222-8222-222222222222",
        approval: { id: "ap1", tool: "Bash", text: "Rodando: npm test", canAlways: true },
        result: "", notes: [], read: false, createdAt: new Date().toISOString(),
      },
    ],
  });
  const bar = await screen.findByRole("alert");
  expect(within(bar).getByText(/Rodando: npm test/)).toBeTruthy();
  fireEvent.click(within(bar).getByRole("button", { name: "Permitir" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({ action: "officeDecide", projectId: project.id, jobId: "j1", behavior: "allow", always: false }),
  );
});

it("entrega de código mostra o que mudou e faz o commit pelo Escritório", async () => {
  const { request } = setup({
    jobs: [
      {
        id: "j1", agentId: "bruno", agentName: "Bruno", title: "Corrigir login", request: "corrige", status: "entregue",
        activity: "", taskId: "22222222-2222-4222-8222-222222222222", changed: [{ path: "src/auth.ts", kind: "modified" }],
        result: "Feito", notes: [], read: false, createdAt: new Date().toISOString(),
      },
    ],
  });
  await screen.findByText("Corrigir login");
  // O chefe começa no lugar dele, atrás da própria mesa: E abre as entregas.
  const room = screen.getByLabelText(/Escritório: ande/);
  await new Promise((r) => setTimeout(r, 60));
  fireEvent.keyDown(room, { key: "e" });
  const dialog = await screen.findByRole("dialog", { name: "Entregas" });
  // A entrega de código diz onde está e o que falta: o commit.
  expect(within(dialog).getByText(/ainda sem commit/)).toBeTruthy();
  expect(within(dialog).getByText("src/auth.ts")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: /Commitar alterações/ }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "officeCommit", projectId: project.id, jobId: "j1" }));
});

it("na mesa, plano espera a decisão do chefe e o botão Implementar manda fazer", async () => {
  const { request } = setup({
    jobs: [
      {
        id: "j1", agentId: "bruno", agentName: "Bruno", title: "Corrigir login", request: "corrige", status: "entregue",
        activity: "", stage: "plano", result: "O plano é ajustar o auth.", notes: ["Plano ok"], reviewedBy: "Eva",
        read: false, createdAt: new Date().toISOString(),
      },
    ],
  });
  await screen.findByText("Corrigir login");
  const room = screen.getByLabelText(/Escritório: ande/);
  await new Promise((r) => setTimeout(r, 60));
  fireEvent.keyDown(room, { key: "e" });
  const dialog = await screen.findByRole("dialog", { name: "Entregas" });
  expect(within(dialog).getByText(/nada foi alterado ainda/)).toBeTruthy();
  expect(within(dialog).getAllByText(/esperando sua decisão/).length).toBeGreaterThan(0);
  fireEvent.click(within(dialog).getByRole("button", { name: /Implementar/ }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "officeImplement", projectId: project.id, jobId: "j1" }));
});

it("trabalho em andamento tem Cancelar; o cancelado tem Tentar de novo", async () => {
  const at = new Date().toISOString();
  const { request } = setup({
    jobs: [
      {
        id: "j1", agentId: "bruno", agentName: "Bruno", title: "Corrigir login", request: "corrige", status: "fazendo",
        activity: "Editando", result: "", notes: [], read: false, createdAt: at, approved: true, rounds: 1, fixRequest: "- Falta o teste",
      },
      {
        id: "j2", agentId: "davi", agentName: "Davi", title: "Pesquisa", request: "pesquisa", status: "erro", activity: "", result: "",
        notes: [], read: false, createdAt: at, error: "Cancelado pelo chefe.", cancelled: true,
      },
    ],
  });
  await screen.findByText("Corrigir login");
  expect(screen.getByText(/Bruno corrigindo o que a revisão pediu \(volta 1 de 2\)/)).toBeTruthy();
  expect(screen.getByText(/Davi · cancelado/)).toBeTruthy();
  const jobs = document.querySelector(".office-jobs")!;
  fireEvent.click(within(jobs as HTMLElement).getByRole("button", { name: /Cancelar/ }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "officeCancel", projectId: project.id, jobId: "j1" }));
  fireEvent.click(within(jobs as HTMLElement).getByRole("button", { name: /Tentar de novo/ }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "officeRetry", projectId: project.id, jobId: "j2" }));
});
