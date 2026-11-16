// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { it, expect, vi, afterEach, beforeEach, describe } from "vitest";
import { FileTree } from "../src/renderer/FileTree";
import { canMove, followMove, stemLength, targetDir } from "../src/renderer/fileTreeOps";
import type { Request, TreeEntry } from "../src/shared/contracts";

const TASK = "6f1c1e8e-0d1a-4c55-9d38-7a3d2b6c1f00";
const LISTING: Record<string, TreeEntry[]> = {
  "": [
    { name: "src", path: "src", kind: "directory" },
    { name: "lib", path: "lib", kind: "directory" },
    { name: "README.md", path: "README.md", kind: "file" },
  ],
  src: [{ name: "a.ts", path: "src/a.ts", kind: "file" }],
  lib: [],
};
let calls: Request[] = [];
let answers: Partial<Record<Request["action"], unknown>> = {};
let root: "task" | "project" = "task";
beforeEach(() => {
  calls = [];
  answers = { clipboardFiles: [], fileDelete: true, filePath: "/abs/caminho" };
  root = "task";
  (window as unknown as { golfinho: unknown }).golfinho = {
    getPathForFile: (file: File) => `/fora/${file.name}`,
    request: vi.fn(async (r: Request) => {
      calls.push(r);
      if (r.action === "tree") return { root, entries: LISTING[r.path] ?? [], truncated: false };
      if (r.action === "changes") return {};
      if (r.action === "fileMove") return r.to;
      if (r.action === "fileCopy") return `${r.dir ? `${r.dir}/` : ""}copia`;
      if (r.action === "fileCreate") return r.path;
      if (r.action === "fileImport") return r.sources.map((s) => s.split("/").pop());
      const answer = answers[r.action];
      return typeof answer === "function" ? answer(r) : (answer ?? null);
    }),
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const sent = (action: Request["action"]) => calls.filter((c) => c.action === action);
async function tree(props: Partial<React.ComponentProps<typeof FileTree>> = {}) {
  const onOpen = vi.fn();
  const onMoved = vi.fn();
  const onError = vi.fn();
  render(<FileTree taskId={TASK} selected="" onOpen={onOpen} onMoved={onMoved} onError={onError} {...props} />);
  await screen.findByText("README.md");
  return { onOpen, onMoved, onError };
}
const row = (name: string) => screen.getByText(name).closest("button")!;
async function openFolder(name: string) {
  fireEvent.click(row(name));
  await waitFor(() => expect(sent("tree").some((c) => c.action === "tree" && c.path === name)).toBe(true));
}
function menu(name: string | null) {
  fireEvent.contextMenu(name ? row(name) : screen.getByRole("tree"));
  return (label: string) => fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^${label}`) }));
}

describe("contas de caminho", () => {
  it("decide destino, acompanha movimentos e protege a própria pasta", () => {
    expect(targetDir({ path: "src/a.ts", kind: "file" })).toBe("src");
    expect(targetDir({ path: "src", kind: "directory" })).toBe("src");
    expect(targetDir(null)).toBe("");
    expect(followMove("src/a.ts", "src", "lib/src")).toBe("lib/src/a.ts");
    expect(followMove("srcx/a.ts", "src", "lib")).toBe("srcx/a.ts");
    expect(followMove("src/a.ts", "src/a.ts", null)).toBeNull();
    expect(canMove("src/a.ts", "src")).toBe(false);
    expect(canMove("src", "src/sub")).toBe(false);
    expect(canMove("src/a.ts", "")).toBe(true);
    expect(stemLength("arquivo.test.ts", false)).toBe(12);
    expect(stemLength(".env", false)).toBe(4);
  });
});

describe("explorador da árvore", () => {
  it("mostra o menu de contexto completo", async () => {
    await tree();
    fireEvent.contextMenu(row("README.md"));
    expect(screen.getAllByRole("menuitem").map((b) => b.querySelector("span")!.textContent)).toEqual([
      "Novo arquivo",
      "Nova pasta",
      "Recortar",
      "Copiar",
      "Colar",
      "Duplicar",
      "Renomear",
      "Excluir",
      "Copiar caminho",
      "Copiar caminho relativo",
      "Revelar no gerenciador de arquivos",
    ]);
  });

  it("cria arquivo pelo menu, digitando o nome na árvore", async () => {
    const { onOpen } = await tree();
    menu("src")("Novo arquivo");
    const input = await screen.findByRole("textbox", { name: "Nome" });
    fireEvent.change(input, { target: { value: "novo.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(sent("fileCreate")).toEqual([{ action: "fileCreate", taskId: TASK, path: "src/novo.ts", kind: "file" }]));
    expect(onOpen).toHaveBeenCalledWith("src/novo.ts", true);
  });

  it("cria o arquivo que um plugin ensina, com a extensão e o conteúdo do modelo", async () => {
    const plugin = {
      key: "local.http-client",
      enabled: true,
      editors: [],
      panels: [],
      syntaxes: [],
      newFiles: [{ id: "http-file", title: "Arquivo HTTP", extension: ".http" }],
    };
    (window as unknown as { golfinho: Record<string, unknown> }).golfinho.plugins = {
      request: async (r: { action: string }) => (r.action === "list" ? [plugin] : r.action === "template" ? "GET https://x\n" : null),
      subscribe: () => () => {},
    };
    await tree();
    await waitFor(() => {
      fireEvent.contextMenu(row("src"));
      expect(screen.queryByRole("menuitem", { name: "Novo: Arquivo HTTP" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Novo: Arquivo HTTP" }));
    const input = (await screen.findByRole("textbox", { name: "Nome" })) as HTMLInputElement;
    expect(input.value).toBe("novo.http");
    fireEvent.change(input, { target: { value: "api" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(sent("saveFile")).toEqual([{ action: "saveFile", taskId: TASK, path: "src/api.http", content: "GET https://x\n" }]));
    expect(sent("fileCreate")).toEqual([{ action: "fileCreate", taskId: TASK, path: "src/api.http", kind: "file" }]);
  });

  it("Esc cancela a pasta nova sem criar nada", async () => {
    await tree();
    menu(null)("Nova pasta");
    fireEvent.keyDown(await screen.findByRole("textbox", { name: "Nome" }), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(sent("fileCreate")).toEqual([]);
  });

  it("renomeia com F2 e avisa o editor", async () => {
    const { onMoved } = await tree();
    fireEvent.click(row("README.md"));
    fireEvent.keyDown(row("README.md"), { key: "F2" });
    const input = (await screen.findByRole("textbox", { name: "Nome" })) as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6]);
    fireEvent.change(input, { target: { value: "LEIA.md" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith("README.md", "LEIA.md"));
    expect(sent("fileMove")).toEqual([{ action: "fileMove", taskId: TASK, from: "README.md", to: "LEIA.md" }]);
  });

  it("Ctrl+C e Ctrl+V copiam para a pasta escolhida", async () => {
    await tree();
    fireEvent.click(row("README.md"));
    fireEvent.keyDown(row("README.md"), { key: "c", ctrlKey: true });
    await waitFor(() => expect(sent("writeClipboard")).toHaveLength(1));
    fireEvent.click(row("lib"));
    fireEvent.keyDown(row("lib"), { key: "v", ctrlKey: true });
    await waitFor(() => expect(sent("fileCopy")).toEqual([{ action: "fileCopy", taskId: TASK, from: "README.md", dir: "lib" }]));
  });

  it("Ctrl+X e Ctrl+V movem, e o item recortado fica apagado até colar", async () => {
    await tree();
    await openFolder("src");
    fireEvent.click(row("a.ts"));
    fireEvent.keyDown(row("a.ts"), { key: "x", ctrlKey: true });
    await waitFor(() => expect(row("a.ts").className).toContain("tree-cut"));
    fireEvent.click(row("lib"));
    fireEvent.keyDown(row("lib"), { key: "v", ctrlKey: true });
    await waitFor(() => expect(sent("fileMove")).toEqual([{ action: "fileMove", taskId: TASK, from: "src/a.ts", to: "lib/a.ts" }]));
  });

  it("colar traz os arquivos copiados no gerenciador de arquivos", async () => {
    answers.clipboardFiles = ["/home/eu/foto.png", "/home/eu/docs"];
    await tree();
    menu("src")("Colar");
    await waitFor(() =>
      expect(sent("fileImport")).toEqual([
        { action: "fileImport", taskId: TASK, sources: ["/home/eu/foto.png", "/home/eu/docs"], dir: "src" },
      ]),
    );
  });

  it("duplica ao lado do original", async () => {
    await tree();
    menu("README.md")("Duplicar");
    await waitFor(() => expect(sent("fileCopy")).toEqual([{ action: "fileCopy", taskId: TASK, from: "README.md", dir: "" }]));
  });

  it("exclui só depois de confirmar, e pergunta de novo quando não há lixeira", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const { onMoved } = await tree();
    menu("README.md")("Excluir");
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(sent("fileDelete")).toEqual([]);
    answers.fileDelete = (r: { permanent?: boolean }) => Boolean(r.permanent);
    confirm.mockReturnValue(true);
    fireEvent.keyDown(row("README.md"), { key: "Delete" });
    await waitFor(() => expect(sent("fileDelete")).toHaveLength(2));
    expect(sent("fileDelete")[1]).toMatchObject({ path: "README.md", permanent: true });
    expect(confirm.mock.calls[2][0]).toContain("definitivamente");
    expect(onMoved).toHaveBeenCalledWith("README.md", null);
  });

  it("copia o caminho absoluto e o relativo", async () => {
    await tree();
    await openFolder("src");
    menu("a.ts")("Copiar caminho relativo");
    await waitFor(() => expect(sent("writeClipboard")).toEqual([{ action: "writeClipboard", text: "src/a.ts" }]));
    menu("a.ts")("Copiar caminho$");
    await waitFor(() => expect(sent("writeClipboard")[1]).toEqual({ action: "writeClipboard", text: "/abs/caminho" }));
    menu("a.ts")("Revelar");
    await waitFor(() => expect(sent("fileReveal")).toEqual([{ action: "fileReveal", taskId: TASK, path: "src/a.ts" }]));
  });

  it("arrastar dentro da árvore move para a pasta; de fora, copia", async () => {
    await tree();
    const data = new Map<string, string>();
    const dataTransfer = {
      types: [] as string[],
      files: [] as File[],
      setData: (type: string, value: string) => {
        data.set(type, value);
        dataTransfer.types = [...data.keys()];
      },
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(row("README.md"), { dataTransfer });
    fireEvent.dragOver(row("lib"), { dataTransfer });
    expect(row("lib").className).toContain("tree-drop");
    fireEvent.drop(row("lib"), { dataTransfer });
    await waitFor(() => expect(sent("fileMove")).toEqual([{ action: "fileMove", taskId: TASK, from: "README.md", to: "lib/README.md" }]));
    const outside = { types: ["Files"], files: [new File(["x"], "logo.svg")], getData: () => "", dropEffect: "" };
    fireEvent.drop(row("src"), { dataTransfer: outside });
    await waitFor(() =>
      expect(sent("fileImport")).toEqual([{ action: "fileImport", taskId: TASK, sources: ["/fora/logo.svg"], dir: "src" }]),
    );
  });

  it("no projeto somente leitura, só copiar caminho e revelar ficam disponíveis", async () => {
    root = "project";
    await tree();
    fireEvent.contextMenu(row("README.md"));
    const enabled = screen
      .getAllByRole("menuitem")
      .filter((b) => !(b as HTMLButtonElement).disabled)
      .map((b) => b.querySelector("span")!.textContent);
    expect(enabled).toEqual(["Copiar", "Copiar caminho", "Copiar caminho relativo", "Revelar no gerenciador de arquivos"]);
    act(() => {
      fireEvent.keyDown(row("README.md"), { key: "Delete" });
    });
    expect(sent("fileDelete")).toEqual([]);
  });
});
