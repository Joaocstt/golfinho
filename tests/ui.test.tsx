// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { Snapshot, Task, Signal } from "../src/shared/contracts";
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
function setup(tasks: Task[] = [], rejectCreate = false) {
  const request = vi.fn(async (r: any) => {
    if (r.action === "snapshot") return { ...snapshot, tasks };
    if (r.action === "createTask") {
      if (rejectCreate) throw new Error("Branch já existe");
      return { ...r.input, id: "new", status: "draft" };
    }
    if (r.action === "branches") return { current: "develop", branches: ["develop", "main"] };
    if (r.action === "review") return { files: [], overlaps: [], branch: "golfinho/a" };
    if (r.action === "terminal") return "";
    if (r.action === "tree")
      return r.path === ""
        ? { root: "task", truncated: false, entries: [{ name: "src", path: "src", kind: "directory" }] }
        : { root: "task", truncated: false, entries: [{ name: "a.ts", path: "src/a.ts", kind: "file" }] };
    if (r.action === "readTree") return "";
    if (r.action === "changes") return { "src/a.ts": "modified" };
    return [];
  });
  window.golfinho = {
    request,
    subscribe: (listener) => {
      signal = listener;
      return () => {};
    },
  };
  render(<App />);
  return request;
}
afterEach(cleanup);
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
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Revisar alterações" }));
  expect(confirm).toHaveBeenCalled();
  expect(request).not.toHaveBeenCalledWith({ action: "review", taskId: "edit" });
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
  act(() => signal?.({ kind: "changed" }));
  fireEvent.click(screen.getByRole("button", { name: "Ativar branch no repositório" }));
  expect(request).not.toHaveBeenCalledWith({ action: "activate", taskId: "edit" });
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
  confirm.mockRestore();
});
it("permite tentar novamente quando o workspace não carrega", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("Backend indisponível"))
    .mockResolvedValue(snapshot);
  window.golfinho = { request, subscribe: () => () => {} };
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }));
  expect(await screen.findByText("Projeto real")).toBeTruthy();
});

it("ativa branch encerrada somente por ação explícita", async () => {
  const request = setup([{ ...editableTask, status: "completed" }]);
  fireEvent.click(await screen.findByRole("button", { name: /Editar arquivo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Ativar branch no repositório" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "activate", taskId: "edit" }));
});
it("invalida revisão em mudança do backend", async () => {
  setup([editableTask]);
  fireEvent.click(await screen.findByRole("button", { name: /Editar arquivo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Revisar alterações" }));
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
  ["finish", "Concluir tarefa"],
] as const)("protege editor não salvo antes de %s", async (action, label) => {
  const request = setup([editableTask]);
  fireEvent.click(await screen.findByRole("button", { name: /Editar arquivo/ }));
  fireEvent.click(screen.getByRole("button", { name: "Arquivos" }));
  fireEvent.click(await screen.findByRole("button", { name: "src" }));
  fireEvent.click(await screen.findByRole("button", { name: "a.ts" }));
  fireEvent.click(await screen.findByRole("button", { name: "Editar conteúdo" }));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(confirm).toHaveBeenCalled();
  expect(request).not.toHaveBeenCalledWith({ action, taskId: "edit" });
  expect(screen.getByRole("button", { name: "Editar conteúdo" })).toBeTruthy();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action, taskId: "edit" }));
  expect(screen.queryByRole("button", { name: "Editar conteúdo" })).toBeNull();
  confirm.mockRestore();
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
