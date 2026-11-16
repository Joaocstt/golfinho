// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PluginsPanel } from "../src/renderer/PluginsPanel";
import { pluginEditorFor, type PluginInfo } from "../src/renderer/plugins";

afterEach(cleanup);

const installed: PluginInfo = {
  key: "joaocstt.http-client",
  id: "http-client",
  publisher: "joaocstt",
  name: "HTTP Client",
  version: "0.1.0",
  description: "Requisições a partir de arquivos .http",
  path: "/dados/plugins/installed/joaocstt.http-client",
  source: { kind: "git", location: "https://github.com/joaocstt/http-client" },
  enabled: true,
  granted: ["storage:own"],
  editors: [{ id: "http-file", title: "HTTP Client", extensions: [".http", ".rest"], filenames: [] }],
  panels: [{ id: "http-client", title: "HTTP Client", icon: "globe" }],
  syntaxes: [],
  newFiles: [{ id: "http-file", title: "Arquivo HTTP", extension: ".http" }],
  settings: [],
  values: {},
  unsupported: ["panels (1)"],
};

function setup() {
  let list: PluginInfo[] = [];
  const request = vi.fn(async (r: { action: string; [k: string]: unknown }) => {
    if (r.action === "list") return list;
    if (r.action === "prepare")
      return {
        token: "11111111-1111-4111-8111-111111111111",
        key: "joaocstt.http-client",
        name: "HTTP Client",
        version: "0.1.0",
        description: "",
        publisher: "joaocstt",
        dev: false,
        runsCode: true,
        capabilities: [{ kind: "secrets:own", text: "Guardar segredos próprios no cofre do sistema" }],
        unsupported: ["panels (1)"],
        editors: ["HTTP Client (.http, .rest)"],
      };
    if (r.action === "install") {
      list = [installed];
      return installed;
    }
    return null;
  });
  (window as any).golfinho = { plugins: { request, subscribe: () => () => {} }, getPathForFile: () => "" };
  render(<PluginsPanel onClose={() => {}} />);
  return request;
}

it("instala do Git só depois de mostrar o que o plugin pede", async () => {
  const request = setup();
  fireEvent.click(screen.getByRole("button", { name: "Do Git" }));
  fireEvent.change(screen.getByLabelText("Link do repositório Git"), { target: { value: "https://github.com/joaocstt/http-client" } });
  fireEvent.click(screen.getByRole("button", { name: "Baixar" }));
  const approve = await screen.findByRole("dialog", { name: "Instalar HTTP Client" });
  expect(approve.textContent).toContain("roda código próprio");
  expect(approve.textContent).toContain("Guardar segredos próprios no cofre do sistema");
  expect(approve.textContent).toContain("Ainda sem efeito no Golfinho: panels (1)");
  expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ action: "install" }));
  fireEvent.click(screen.getByRole("button", { name: "Instalar e permitir" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ action: "install", token: "11111111-1111-4111-8111-111111111111" }));
  expect(await screen.findByText("joaocstt.http-client · de Git")).toBeTruthy();
});

it("arquivo .http abre no editor do plugin ativo", () => {
  expect(pluginEditorFor("api/teste.HTTP", [installed])?.editor.id).toBe("http-file");
  expect(pluginEditorFor("api/teste.ts", [installed])).toBeNull();
  expect(pluginEditorFor("a.http", [{ ...installed, enabled: false }])).toBeNull();
});
