// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { Snapshot, Task, Signal, ChatHistoryItem } from "../src/shared/contracts";
// O terminal de shell depende de xterm e ResizeObserver, que o jsdom não tem.
vi.mock("../src/renderer/ShellPane", () => ({
  ShellPane: () => <div>Shell conectado</div>,
}));
vi.mock("../src/renderer/Editors", async () => {
  // A árvore de arquivos é real; só o editor Monaco e o terminal são substituídos.
  const actual = await vi.importActual<typeof import("../src/renderer/Editors")>(
    "../src/renderer/Editors",
  );
  return {
    ...actual,
    TerminalPane: () => <div>Terminal conectado</div>,
    DiffPane: () => <div>Diff</div>,
    FileEditor: ({ onDirty }: { onDirty: (dirty: boolean) => void }) => (
      <button onClick={() => onDirty(true)}>Editar conteúdo</button>
    ),
  };
});
import App from "../src/renderer/App";
const snapshot: Snapshot = {
  projects: [{ id: "p", name: "Projeto real", path: "/repo", remotes: ["origin"] }],
  tasks: [],
  sshPasswords: [],
  settings: {
    concurrency: 2,
    executables: { codex: "codex", claude: "claude", antigravity: "antigravity" },
    setup: {},
    ssh: [],
  },
  agents: [{ provider: "codex", label: "Codex", available: true, executable: "codex" }],
};
let signal: ((s: Signal) => void) | undefined;
function setup(tasks: Task[] = [], rejectCreate = false, chatHistory: Record<string, ChatHistoryItem[]> = {}) {
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = vi.fn();
  const request = vi.fn(async (r: any) => {
    if (r.action === "snapshot") return { ...snapshot, tasks };
    if (r.action === "createTask") {
      if (rejectCreate) throw new Error("Branch já existe");
      return { ...r.input, id: "new", status: "draft" };
    }
    if (r.action === "branches") return { current: "develop", branches: ["develop", "main"] };
    if (r.action === "review") return { files: [], overlaps: [], branch: "golfinho/a" };
    if (r.action === "terminal") return "";
    if (r.action === "chatHistory") return chatHistory[r.taskId] ?? [];
    if (r.action === "tree")
      return r.path === ""
        ? { root: "task", truncated: false, entries: [{ name: "src", path: "src", kind: "directory" }] }
        : { root: "task", truncated: false, entries: [{ name: "a.ts", path: "src/a.ts", kind: "file" }] };
    if (r.action === "readTree") return "";
    if (r.action === "changes") return { "src/a.ts": "modified" };
    return [];
  });
  const listeners = new Set<(s: Signal) => void>();
  signal = (s) => listeners.forEach((listener) => listener(s));
  window.golfinho = {
    getPathForFile: () => '',
    request,
    update:{status:async()=>({state:'unsupported'}),check:async()=>{},download:async()=>{},install:async()=>{},subscribe:()=>()=>{}},youtube:{show:async()=>{},hide:async()=>{},command:async()=>{},subscribe:()=>()=>{}},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  render(<App />);
  return request;
}
afterEach(cleanup);
// Responde à janela de confirmação do app (no lugar do window.confirm): true confirma, false cancela.
async function answer(ok: boolean) {
  const dialog = await screen.findByRole("alertdialog");
  const [cancel, confirm] = within(dialog).getAllByRole("button");
  fireEvent.click(ok ? confirm : cancel);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}
const noDialog = () => expect(screen.queryByRole("alertdialog")).toBeNull();
// O select de base é remontado quando as branches chegam; esperar a opção "atual"
// evita guardar referência ao nó antigo.
const baseCarregada = async () => {
  await screen.findByRole("option", { name: /atual/ });
  return screen.getByLabelText("Branch base") as HTMLSelectElement;
};
describe("interface de tarefas", () => {
  it("cria uma tarefa com os valores fornecidos", async () => {
    const request = setup();
    await screen.findByText("Projeto real");
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    // O formulário não tem mais título nem instruções: o título vira o nome da branch.
    fireEvent.change(screen.getByLabelText("Branch da tarefa"), {
      target: { value: "golfinho/login" },
    });
    await baseCarregada();
    fireEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        action: "createTask",
        input: expect.objectContaining({
          title: "",
          prompt: "",
          branch: "golfinho/login",
          projectId: "p",
        }),
      }),
    );
  });
  it("escolhe o agente pelos botões com ícone, com Codex como padrão", async () => {
    const request = setup();
    await screen.findByText("Projeto real");
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    const group = screen.getByRole("radiogroup", { name: "Agente" });
    expect(within(group).getByRole("radio", { checked: true }).textContent).toContain("Codex");
    fireEvent.click(within(group).getByRole("radio", { name: /claude/i }));
    expect(within(group).getByRole("radio", { checked: true }).textContent).toMatch(/claude/i);
    fireEvent.change(screen.getByLabelText("Branch da tarefa"), { target: { value: "golfinho/agente" } });
    await baseCarregada();
    fireEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        action: "createTask",
        input: expect.objectContaining({ provider: "claude", branch: "golfinho/agente" }),
      }),
    );
  });
  it("oferece a branch base lida do repositório, com a atual pré-selecionada", async () => {
    const request = setup();
    await screen.findByText("Projeto real");
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    expect(request).toHaveBeenCalledWith({ action: "branches", projectId: "p" });
    const base = await baseCarregada();
    expect(base.tagName).toBe("SELECT");
    expect(base.value).toBe("develop");
    expect([...base.options].map((o) => o.value)).toEqual(["develop", "main"]);
    fireEvent.change(screen.getByLabelText("Branch da tarefa"), {
      target: { value: "golfinho/login" },
    });
    fireEvent.change(base, { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        action: "createTask",
        input: expect.objectContaining({ base: "main" }),
      }),
    );
  });
  it("valida o nome da branch e cria a tarefa numa branch que já existe", async () => {
    const request = setup();
    await screen.findByText("Projeto real");
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    await baseCarregada();
    const create = screen.getByRole("button", { name: "Criar tarefa" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Branch da tarefa"), { target: { value: "minha tarefa" } });
    expect(screen.getByText("Sem espaços no nome da branch.")).toBeTruthy();
    expect(create.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Branch da tarefa"), { target: { value: "main" } });
    expect(screen.getByText(/Essa branch já existe/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Branch que já existe/ }));
    expect((screen.getByLabelText("Branch existente") as HTMLSelectElement).value).toBe("develop");
    fireEvent.change(screen.getByLabelText("Branch existente"), { target: { value: "main" } });
    expect(screen.getByText("main", { selector: "code" })).toBeTruthy();
    fireEvent.click(create);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        action: "createTask",
        input: expect.objectContaining({ branch: "main", base: "main", adopt: true }),
      }),
    );
  });
  it("mostra erros do backend", async () => {
    setup([], true);
    await screen.findByText("Projeto real");
    fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
    fireEvent.change(screen.getByLabelText("Branch da tarefa"), {
      target: { value: "golfinho/login" },
    });
    await baseCarregada();
    fireEvent.click(screen.getByRole("button", { name: "Criar tarefa" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveProperty("textContent", expect.stringContaining("Branch já existe"));
    expect(screen.getByRole("dialog").contains(alert)).toBe(true);
  });
  it("não permite concluir antes da revisão", async () => {
    setup([
      {
        id: "t",
        projectId: "p",
        title: "Tarefa pendente",
        prompt: "Executar",
        provider: "codex",
        branch: "golfinho/a",
        base: "main",
        remote: "origin",
        status: "running",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        branchCreated: true,
        baseCommit: "base-sha",
        published: false,
        error: null,
        timeoutMinutes: 30,
        reviewSummary: "",
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Tarefa pendente/ }));
    expect(screen.queryByRole("button", { name: "Concluir tarefa" })).toBeNull();
  });
  it("explica retomada de processo interrompido sem inventar sessão", async () => {
    setup([
      {
        id: "t",
        projectId: "p",
        title: "Interrompida",
        prompt: "Executar",
        provider: "antigravity",
        branch: "golfinho/a",
        base: "main",
        remote: "origin",
        status: "interrupted",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        branchCreated: true,
        baseCommit: "base-sha",
        published: false,
        error: "Sessão não recuperável",
        timeoutMinutes: 30,
        reviewSummary: "",
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Interrompida/ }));
    expect(await screen.findByText(/Sessão não recuperável/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Desmarcar aguardando" })).toBeNull();
    // Sem id de sessão descoberto, o app não promete retomada: é conversa nova.
    expect(await screen.findByRole("button", { name: "Colocar na fila" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retomar sessão" })).toBeNull();
  });
  it("oferece retomar quando há sessão descoberta na tarefa interrompida", async () => {
    setup([
      {
        id: "t",
        projectId: "p",
        title: "Interrompida",
        prompt: "Executar",
        provider: "codex",
        branch: "golfinho/a",
        base: "main",
        remote: "origin",
        status: "interrupted",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        branchCreated: true,
        baseCommit: "base-sha",
        published: false,
        error: null,
        timeoutMinutes: 30,
        reviewSummary: "",
        sessionId: "0199cf80-3b73-7252-9458-adfe7a905da5",
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /Interrompida/ }));
    expect(await screen.findByRole("button", { name: "Retomar sessão" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Colocar na fila" })).toBeNull();
  });
});

const editableTask: Task = {
  id: "edit",
  projectId: "p",
  title: "Editar arquivo",
  prompt: "Editar",
  provider: "codex",
  branch: "golfinho/edit",
  base: "main",
  remote: "origin",
  status: "review",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  branchCreated: true,
  baseCommit: "base",
  published: false,
  error: null,
  timeoutMinutes: 0,
  reviewSummary: "",
};
it("notifica aprovação no Chat de tarefa fechada e só navega ao abrir o pedido", async () => {
  const event = { type: "approval", id: "approval-1", toolName: "Bash", summary: "npm test", canAlwaysAllow: false } as const;
  const request = setup([editableTask, { ...editableTask, id: "other", title: "Outra tarefa", branch: "main" }], false, { other: [{ seq: 1, event }] });
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  const previousFocus = document.activeElement;
  act(() => signal?.({ kind: "chat", taskId: "other", seq: 1, event }));
  expect(screen.getByText("main precisa de permissão")).toBeTruthy();
  expect(document.activeElement).toBe(previousFocus);
  expect(screen.getByRole("region", { name: "Tarefa golfinho/edit" })).toBeTruthy();
  act(() => signal?.({ kind: "chat", taskId: "other", seq: 1, event }));
  expect(screen.getAllByRole("button", { name: "Abrir pedido de main no Chat" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Abrir pedido de main no Chat" }));
  const target = screen.getByRole("region", { name: "Tarefa main" });
  expect(await within(target).findByText("Permitir Bash?")).toBeTruthy();
  expect(within(target).getByRole("button", { name: "Chat" }).className).toContain("active");
  expect(screen.getByRole("tab", { name: "Workspace main" }).querySelector(".permission-indicator")).toBeTruthy();
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ action: "chatDecide" }));
  act(() => signal?.({ kind: "chat", taskId: "other", seq: 2, event: { type: "approval_resolved", id: "approval-1", behavior: "deny" } }));
  expect(screen.queryByText("main precisa de permissão")).toBeNull();
});
it("mantém o rascunho do chat ao trocar de aba", async () => {
  setup([editableTask]);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  const workspace = screen.getByRole("region", { name: "Tarefa golfinho/edit" });
  fireEvent.click(within(workspace).getByRole("button", { name: "Chat" }));
  const composer = await within(workspace).findByPlaceholderText(/Mensagem para Codex/);
  fireEvent.change(composer, { target: { value: "rascunho que não pode sumir" } });
  fireEvent.click(within(workspace).getByRole("button", { name: "Terminal" }));
  fireEvent.click(within(workspace).getByRole("button", { name: "Chat" }));
  expect((await within(workspace).findByPlaceholderText(/Mensagem para Codex/) as HTMLTextAreaElement).value)
    .toBe("rascunho que não pode sumir");
});
it("abre o campo do chat com altura para duas linhas", async () => {
  setup([editableTask]);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  const workspace = screen.getByRole("region", { name: "Tarefa golfinho/edit" });
  fireEvent.click(within(workspace).getByRole("button", { name: "Chat" }));
  const composer = await within(workspace).findByPlaceholderText(/Mensagem para Codex/) as HTMLTextAreaElement;
  expect(composer.style.height).toBe("48px");
});
it("notifica pergunta do Terminal em segundo plano e mantém a divisão ao abrir", async () => {
  setup([{ ...editableTask, status: "running" }, { ...editableTask, id: "other", title: "Outra tarefa", branch: "main", status: "running" }]);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  fireEvent.click(screen.getByRole("button", { name: "Outra tarefa" }));
  fireEvent.click(screen.getByRole("button", { name: "Abrir golfinho/edit ao lado" }));
  fireEvent.click(within(screen.getByRole("region", { name: "Tarefa main" })).getByRole("button", { name: "Diff" }));
  act(() => signal?.({ kind: "terminal", taskId: "other", offset: 0, data: "Would you like to run the following command?\r\n› 1. Yes, proceed (y)\r\n2. No" }));
  expect(within(screen.getByRole("region", { name: "Tarefa main" })).getByRole("button", { name: "Diff" }).className).toContain("active");
  fireEvent.click(screen.getByRole("button", { name: "Abrir pedido de main no Terminal" }));
  expect(screen.getByRole("separator", { name: "Divisão entre tarefas" })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Tarefa main" })).getByText("Terminal conectado")).toBeTruthy();
});
it("abrir pedido visível na divisão interna mantém a proteção do editor não salvo", async () => {
  setup([{ ...editableTask, status: "running" }]);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  fireEvent.click(screen.getByRole("button", { name: "Arquivos" }));
  fireEvent.dragStart(screen.getByRole("button", { name: "Terminal" }), { dataTransfer: { setData: vi.fn() } });
  const layer = document.querySelector(".drop-layer")!;
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperties(drop, { clientX: { value: 360 }, clientY: { value: 100 } });
  fireEvent(layer, drop);
  expect(screen.getByRole("separator", { name: "Divisão entre painéis" })).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "src" }));
  fireEvent.click(await screen.findByRole("button", { name: "a.ts" }));
  fireEvent.click(await screen.findByRole("button", { name: "Editar conteúdo" }));
  act(() => signal?.({ kind: "terminal", taskId: "edit", offset: 0, data: "Do you want to proceed?\n1. Yes\n2. No" }));
  fireEvent.click(screen.getByRole("button", { name: "Abrir pedido de golfinho/edit no Terminal" }));
  noDialog();
  fireEvent.click(screen.getByRole("button", { name: "Fechar aba golfinho/edit" }));
  await answer(false);
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
});
it("divide duas tarefas com abas e ações independentes", async () => {
  const request = setup([editableTask, { ...editableTask, id: "other", title: "Outra tarefa", branch: "main" }]);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  fireEvent.click(screen.getByRole("button", { name: "Outra tarefa" }));
  fireEvent.click(screen.getByRole("button", { name: "Abrir golfinho/edit ao lado" }));
  const left = screen.getByRole("region", { name: "Tarefa main" });
  const right = screen.getByRole("region", { name: "Tarefa golfinho/edit" });
  expect(within(left).getByText("Terminal conectado")).toBeTruthy();
  expect(within(right).getByText("Terminal conectado")).toBeTruthy();
  fireEvent.click(within(right).getByRole("button", { name: "Diff" }));
  expect(within(left).getByText("Terminal conectado")).toBeTruthy();
  fireEvent.click(within(right).getByRole("button", { name: "Carregar diff" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "review", taskId: "edit" }));
  fireEvent.click(within(left).getByRole("button", { name: "Colocar na fila" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "queue", taskId: "other" }));
  expect(within(right).getByText("Nenhuma alteração encontrada nesta branch.")).toBeTruthy();
  expect(request).not.toHaveBeenCalledWith({ action: "queue", taskId: "edit" });
});
it("mantém aba, arquivo e edição ao alternar tarefas e ao voltar da divisão", async () => {
  setup([editableTask, { ...editableTask, id: "other", title: "Outra tarefa", branch: "main" }]);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  fireEvent.click(screen.getByRole("button", { name: "Arquivos" }));
  fireEvent.click(await screen.findByRole("button", { name: "src" }));
  fireEvent.click(await screen.findByRole("button", { name: "a.ts" }));
  fireEvent.click(await screen.findByRole("button", { name: "Editar conteúdo" }));
  fireEvent.click(screen.getByRole("button", { name: "Outra tarefa" }));
  expect(screen.getByRole("region", { name: "Tarefa main" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Workspace golfinho/edit" }));
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Arquivos" }).className).toContain("active");
  noDialog();
  fireEvent.click(screen.getByRole("button", { name: "Abrir main ao lado" }));
  fireEvent.click(screen.getByRole("button", { name: "Exibir apenas esta tarefa" }));
  fireEvent.click(screen.getByRole("tab", { name: "Workspace golfinho/edit" }));
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Fechar aba golfinho/edit" }));
  await answer(false);
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
});
it("ajusta a divisória e volta à tarefa em foco sem fechar a outra aba", async () => {
  setup([editableTask, { ...editableTask, id: "other", title: "Outra tarefa", branch: "main" }]);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  fireEvent.click(screen.getByRole("button", { name: "Outra tarefa" }));
  fireEvent.click(screen.getByRole("button", { name: "Abrir golfinho/edit ao lado" }));
  const divider = screen.getByRole("separator", { name: "Divisão entre tarefas" });
  expect(divider.getAttribute("aria-valuenow")).toBe("50");
  fireEvent.keyDown(divider, { key: "ArrowRight" });
  expect(divider.getAttribute("aria-valuenow")).toBe("55");
  fireEvent.click(screen.getByRole("button", { name: "Exibir apenas esta tarefa" }));
  expect(screen.queryByRole("separator", { name: "Divisão entre tarefas" })).toBeNull();
  expect(screen.getByRole("region", { name: "Tarefa golfinho/edit" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Workspace main" })).toBeTruthy();
});
it("fechar uma tarefa da divisão mantém a outra e protege o editor não salvo", async () => {
  const request = setup([editableTask, { ...editableTask, id: "other", title: "Outra tarefa", branch: "main" }]);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  fireEvent.click(screen.getByRole("button", { name: "Outra tarefa" }));
  fireEvent.click(screen.getByRole("button", { name: "Abrir golfinho/edit ao lado" }));
  const right = screen.getByRole("region", { name: "Tarefa golfinho/edit" });
  fireEvent.click(within(right).getByRole("button", { name: "Arquivos" }));
  fireEvent.click(await within(right).findByRole("button", { name: "src" }));
  fireEvent.click(await within(right).findByRole("button", { name: "a.ts" }));
  fireEvent.click(await within(right).findByRole("button", { name: "Editar conteúdo" }));
  fireEvent.click(screen.getByRole("button", { name: "Fechar aba golfinho/edit" }));
  await answer(false);
  expect(within(right).getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Fechar aba golfinho/edit" }));
  await answer(true);
  expect(screen.queryByRole("region", { name: "Tarefa golfinho/edit" })).toBeNull();
  expect(screen.getByRole("region", { name: "Tarefa main" })).toBeTruthy();
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ action: "cancel" }));
});
it("respeita limites do backend nos formulários", async () => {
  setup();
  await screen.findByText("Projeto real");
  fireEvent.click(screen.getByRole("button", { name: "Nova tarefa" }));
  expect(screen.getByLabelText("Branch da tarefa").getAttribute("placeholder")).toBe(
    "golfinho/minha-tarefa",
  );
  expect(screen.getByLabelText("Encerrar se parado (minutos)").getAttribute("min")).toBe("0");
  fireEvent.click(screen.getByRole("button", { name: "Fechar janela" }));
  fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
  expect(screen.getByLabelText("Execuções simultâneas").getAttribute("max")).toBe("8");
});
it("configurações em abas: edita, mostra o rascunho e salva tudo junto", async () => {
  const request = setup();
  await screen.findByText("Projeto real");
  fireEvent.click(screen.getByRole("button", { name: "Configurações" }));
  const dialog = screen.getByRole("dialog", { name: "Configurações" });
  const save = within(dialog).getByRole("button", { name: "Salvar configurações" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Aumentar execuções simultâneas" }));
  fireEvent.click(within(dialog).getByRole("button", { name: /Agentes/ }));
  expect(within(dialog).getByText("Instalado")).toBeTruthy();
  expect(within(dialog).getAllByText("Não encontrado")).toHaveLength(2);
  fireEvent.change(within(dialog).getByLabelText("Executável claude"), { target: { value: " /opt/claude " } });
  fireEvent.click(within(dialog).getByRole("button", { name: /Memória/ }));
  fireEvent.click(within(dialog).getByRole("switch", { name: "Usar a memória do projeto nas tarefas" }));
  fireEvent.click(within(dialog).getByRole("button", { name: /Projetos/ }));
  fireEvent.change(within(dialog).getByLabelText("Setup de Projeto real"), { target: { value: "npm ci" } });
  expect(within(dialog).getByText("Alterações não salvas")).toBeTruthy();
  fireEvent.click(save);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({
      action: "settings",
      settings: {
        concurrency: 3,
        executables: { codex: "codex", claude: "/opt/claude", antigravity: "antigravity" },
        setup: { p: "npm ci" },
        ssh: [],
        memory: { enabled: false },
      },
    }),
  );
});
it("protege alterações não salvas ao fechar janela ou abrir revisão", async () => {
  const request = setup([editableTask]);
  fireEvent.click(await screen.findByRole("button", { name: /Editar arquivo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Arquivos" }));
  fireEvent.click(await screen.findByRole("button", { name: "src" }));
  fireEvent.click(await screen.findByRole("button", { name: "a.ts" }));
  fireEvent.click(await screen.findByRole("button", { name: "Editar conteúdo" }));
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Diff" }));
  await answer(false);
  expect(request).not.toHaveBeenCalledWith({ action: "review", taskId: "edit" });
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
  act(() => signal?.({ kind: "changed" }));
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
});
it("permite tentar novamente quando o workspace não carrega", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("Backend indisponível"))
    .mockResolvedValue(snapshot);
  window.golfinho = { request, getPathForFile: () => '', update:{status:async()=>({state:'unsupported'}),check:async()=>{},download:async()=>{},install:async()=>{},subscribe:()=>()=>{}},youtube:{show:async()=>{},hide:async()=>{},command:async()=>{},subscribe:()=>()=>{}}, subscribe: () => () => {} };
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }));
  expect(await screen.findByText("Projeto real")).toBeTruthy();
});

it("invalida revisão em mudança do backend", async () => {
  setup([editableTask]);
  fireEvent.click(await screen.findByRole("button", { name: /Editar arquivo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Diff" }));
  fireEvent.click(await screen.findByRole("button", { name: "Carregar diff" }));
  await screen.findByText("Nenhuma alteração encontrada nesta branch.");
  act(() => signal?.({ kind: "changed" }));
  expect(await screen.findByRole("button", { name: "Carregar diff" })).toBeTruthy();
});
const editorMock = vi.hoisted(() => ({
  value: "inicial",
  version: 1,
  change: () => {},
  dispose: vi.fn(),
}));
vi.mock("monaco-editor", () => ({
  languages: { getLanguages: () => [{ id: "typescript", extensions: [".ts"] }] },
  editor: {
    defineTheme: vi.fn(),
    createDiffEditor: vi.fn(() => ({ setModel() {}, dispose() {} })),
    createModel: vi.fn(() => ({ dispose() {} })),
    create: vi.fn(() => ({
      getValue: () => editorMock.value,
      getModel: () => ({ getVersionId: () => editorMock.version, dispose: editorMock.dispose }),
      onDidChangeModelContent: (listener: () => void) => {
        editorMock.change = listener;
        return { dispose: vi.fn() };
      },
      dispose: editorMock.dispose,
    })),
  },
}));
vi.mock("monaco-editor/editor/editor.worker.js?worker", () => ({ default: class {} }));
it("mantém dirty quando usuário edita durante salvamento IPC", async () => {
  const { FileEditor } =
    await vi.importActual<typeof import("../src/renderer/Editors")>("../src/renderer/Editors");
  let resolveSave: () => void = () => {};
  window.golfinho = {
    getPathForFile: () => '',
    update:{status:async()=>({state:'unsupported'}),check:async()=>{},download:async()=>{},install:async()=>{},subscribe:()=>()=>{}},youtube:{show:async()=>{},hide:async()=>{},command:async()=>{},subscribe:()=>()=>{}},
    request: vi.fn(async (r) => {
      if (r.action === "readTree") return "inicial";
      return new Promise<null>((resolve) => {
        resolveSave = () => resolve(null);
      });
    }),
    subscribe: () => () => {},
  };
  const dirty = vi.fn();
  render(<FileEditor taskId="edit" path="a.ts" readOnly={false} onDirty={dirty} onError={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Salvar arquivo" })).toHaveProperty("disabled", true),
  );
  await waitFor(() => expect(editorMock.change).not.toBeUndefined());
  act(() => {
    editorMock.value = "primeira";
    editorMock.version++;
    editorMock.change();
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar arquivo" }));
  act(() => {
    editorMock.value = "segunda";
    editorMock.version++;
    editorMock.change();
  });
  await act(async () => resolveSave());
  expect(screen.getByRole("button", { name: "Salvar arquivo" })).toHaveProperty("disabled", false);
  expect(dirty).toHaveBeenLastCalledWith(true);
});
const terminalMock = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  input: (_data: string) => {},
  write: vi.fn(),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    constructor(options: Record<string, unknown>) {
      terminalMock.options = options;
    }
    loadAddon() {}
    open() {}
    write(data: string) {
      terminalMock.write(data);
    }
    onData(listener: (data: string) => void) {
      terminalMock.input = listener;
      return { dispose: vi.fn() };
    }
    dispose() {}
  },
}));
vi.mock("@xterm/addon-search",()=>({SearchAddon:class{}}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
it.each([
  ["queue", "Colocar na fila"],
] as const)("protege editor não salvo antes de %s", async (action, label) => {
  const request = setup([editableTask]);
  fireEvent.click(await screen.findByRole("button", { name: /Editar arquivo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Arquivos" }));
  fireEvent.click(await screen.findByRole("button", { name: "src" }));
  fireEvent.click(await screen.findByRole("button", { name: "a.ts" }));
  fireEvent.click(await screen.findByRole("button", { name: "Editar conteúdo" }));
  fireEvent.click(screen.getByRole("button", { name: label }));
  await answer(false);
  expect(request).not.toHaveBeenCalledWith({ action, taskId: "edit" });
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: label }));
  await answer(true);
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action, taskId: "edit" }));
  expect(screen.queryByRole("button", { name: "Editar conteúdo" })).toBeNull();
});
it("filtra tarefas e navega pelas abas do workspace", async () => {
  setup([
    editableTask,
    { ...editableTask, id: "other", title: "Outra tarefa", branch: "golfinho/other" },
  ]);
  await screen.findByRole("button", { name: /Outra tarefa/ });
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar projetos e tarefas" }), {
    target: { value: "Outra" },
  });
  expect(screen.queryByRole("button", { name: "Editar arquivo" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Outra tarefa" }));
  expect(screen.getByRole("tab", { name: "Workspace golfinho/other" })).toHaveProperty(
    "ariaSelected",
    "true",
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar projetos e tarefas" }), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "Workspace golfinho/edit" }));
  expect(screen.getByRole("button", { name: "Fechar tarefa" })).toBeTruthy();
});
it("redimensiona navegação e oculta inspetor", async () => {
  setup();
  await screen.findByText("Projeto real");
  const separator = screen.getByRole("separator", { name: "Largura da navegação" });
  fireEvent.keyDown(separator, { key: "ArrowRight" });
  expect(separator.getAttribute("aria-valuenow")).toBe("280");
  fireEvent.click(screen.getByRole("button", { name: "Ocultar inspetor" }));
  expect(screen.queryByRole("complementary", { name: "Inspetor da tarefa" })).toBeNull();
  expect(screen.getByRole("button", { name: "Mostrar inspetor" })).toBeTruthy();
});

it("mostra o consumo em cards no painel, sem o painel lateral da tarefa", async () => {
  const request = setup([editableTask]);
  await screen.findByRole("button", { name: /Editar arquivo/ });
  expect(screen.queryByText("Limites de uso")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Painel de consumo" }));
  expect(await screen.findByRole("heading", { name: "Consumo" })).toBeTruthy();
  for (const provider of ["codex", "claude", "antigravity"])
    expect(request).toHaveBeenCalledWith({ action: "quota", provider, refresh: true });
  const cards = [...document.querySelectorAll(".usage-card strong")].map((n) => n.textContent);
  expect(cards).toEqual(["Codex", "Claude Code", "Antigravity"]);
});

it("destaca o que a tarefa alterou na árvore", async () => {
  const request = setup([editableTask]);
  fireEvent.click(await screen.findByRole("button", { name: /Editar arquivo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Arquivos" }));
  fireEvent.click(await screen.findByRole("button", { name: "src" }));
  const file = await screen.findByRole("button", { name: "a.ts" });
  expect(file.className).toContain("changed-modified");
  expect(file.getAttribute("title")).toBe("src/a.ts · modificado");
  fireEvent.click(file);
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "changes", taskId: "edit" }));
});
it("abre sessões avulsas pelo + e fecha cada uma sem mexer na tarefa", async () => {
  setup([editableTask]);
  fireEvent.click(await screen.findByRole("button", { name: /Editar arquivo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Nova sessão" }));
  // Dois botões "Shell": a aba fixa e o item do menu. Fica o último, o do menu.
  const shellItems = screen.getAllByRole("button", { name: "Shell" });
  fireEvent.click(shellItems[shellItems.length - 1]);
  expect(document.querySelectorAll(".session-tab")).toHaveLength(1);
  // Só o painel da sessão nova fica visível; o shell fixo continua montado e oculto.
  expect(document.querySelectorAll(".shell-slot:not([hidden])")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Fechar Shell" }));
  expect(document.querySelectorAll(".session-tab")).toHaveLength(0);
  expect(screen.getByRole("button", { name: /Editar arquivo/ })).toBeTruthy();
});
it("abre terminal geral pelo + da barra superior, sem tarefa", async () => {
  setup([]);
  await screen.findByRole("tab", { name: "Visão geral das tarefas" });
  fireEvent.click(screen.getByRole("button", { name: "Novo terminal geral" }));
  fireEvent.click(screen.getByRole("button", { name: "Shell" }));
  expect(document.querySelectorAll(".general-pane:not([hidden])")).toHaveLength(1);
  expect(document.querySelectorAll(".workspace-tab")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /Fechar Shell/ }));
  expect(document.querySelectorAll(".workspace-tab")).toHaveLength(0);
});
it("mostra no Chat a troca de agente, mantendo a conversa anterior visível", async () => {
  const history: ChatHistoryItem[] = [
    { seq: 1, event: { type: "user", text: "Corrija o teste" } },
    { seq: 2, event: { type: "agent_changed", from: "Claude Code", to: "Codex" } },
  ];
  setup([editableTask], false, { [editableTask.id]: history });
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  const workspace = screen.getByRole("region", { name: "Tarefa golfinho/edit" });
  fireEvent.click(within(workspace).getByRole("button", { name: "Chat" }));
  expect(await screen.findByText("Corrija o teste")).toBeTruthy();
  expect(screen.getByText(/Agente trocado de Claude Code para Codex/)).toBeTruthy();
});
it("seletor de agente envia a troca e fica desabilitado com a tarefa rodando", async () => {
  const originalAgents = snapshot.agents;
  snapshot.agents = [...originalAgents, { provider: "claude", label: "Claude Code", available: true, executable: "claude" }];
  try {
    const request = setup([editableTask]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
    const workspace = screen.getByRole("region", { name: "Tarefa golfinho/edit" });
    const picker = within(workspace).getByRole("button", { name: "Agente da tarefa" }) as HTMLButtonElement;
    expect(picker.textContent).toContain("Codex");
    expect(picker.disabled).toBe(false);
    fireEvent.click(picker);
    fireEvent.click(within(workspace).getByRole("option", { name: /Claude Code/ }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({ action: "setTaskAgent", taskId: editableTask.id, provider: "claude" }),
    );
  } finally {
    snapshot.agents = originalAgents;
  }
  cleanup();
  setup([{ ...editableTask, status: "running" }]);
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  const running = screen.getByRole("region", { name: "Tarefa golfinho/edit" });
  expect((within(running).getByRole("button", { name: "Agente da tarefa" }) as HTMLButtonElement).disabled).toBe(true);
});
it("o separador da troca mostra o contexto passado ao agente, recolhido", async () => {
  const history: ChatHistoryItem[] = [
    { seq: 1, event: { type: "user", text: "Corrija o teste" } },
    { seq: 2, event: { type: "agent_changed", from: "Claude Code", to: "Codex", handoff: "Pedido original:\nCorrija o teste" } },
  ];
  setup([editableTask], false, { [editableTask.id]: history });
  fireEvent.click(await screen.findByRole("button", { name: "Editar arquivo" }));
  const workspace = screen.getByRole("region", { name: "Tarefa golfinho/edit" });
  fireEvent.click(within(workspace).getByRole("button", { name: "Chat" }));
  const summary = await screen.findByText("Contexto passado a Codex");
  const details = summary.closest("details") as HTMLDetailsElement;
  expect(details).toBeTruthy();
  expect(details.open).toBe(false);
  expect(details.querySelector("pre")?.textContent).toContain("Pedido original:");
});
